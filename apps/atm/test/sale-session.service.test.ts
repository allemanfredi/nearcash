/**
 * The ATM's sale logic (SaleSessionService), built directly with test
 * doubles through its constructor — the same dependencies Nest injects.
 * A whole issuance on a real card waits for the NFC reader and the cards.
 */
import { DEV_ISSUER } from '@nearcash/core';
import type { StartRequest } from '@nearcash/kiosk-api';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../src/server/common/domain-error.ts';
import { CatalogService } from '../src/server/features/catalog/catalog.service.ts';
import { SaleSessionService } from '../src/server/features/sales/sale-session.service.ts';
import { BANKNOTE, CountingCassette, CountingDispenser, EVM_ADDRESS, FakeIssuance, RecordingLog, waitUntil } from './fakes.ts';

function setup(options: { graceMs?: number } = {}) {
  const issuance = new FakeIssuance();
  const cassette = new CountingCassette();
  const dispenser = new CountingDispenser();
  const log = new RecordingLog();
  const sessions = new SaleSessionService(
    issuance,
    cassette,
    dispenser,
    [DEV_ISSUER],
    new CatalogService(issuance, cassette),
    { pollMs: 5, graceMs: options.graceMs ?? 60_000 },
    log,
  );
  return { sessions, issuance, cassette, dispenser, log };
}

/** No refund address: refunds go back to the sender (the default). */
const REQUEST: StartRequest = {
  amount: BANKNOTE.amount.toString(),
  paymentOptionId: 'usdc-base',
  pin: '2468',
};

function expectDomainError(promise: Promise<unknown>, kind: DomainError['kind']) {
  return expect(promise).rejects.toSatisfy((error: unknown) => error instanceof DomainError && error.kind === kind);
}

describe('what the screen offers', () => {
  it('lists the banknotes from the issuance server and the payment options', async () => {
    const { issuance, cassette } = setup();
    const view = await new CatalogService(issuance, cassette).setup();
    expect(view.banknotes).toEqual([{ amount: BANKNOTE.amount.toString(), value: '0.01', symbol: 'ETH', label: '0.01 ETH' }]);
    expect(view.paymentOptions.map((option) => option.id)).toContain('usdc-base');
    expect(view.simulatedPayments).toBe(true);
    expect(view.outOfService).toBeNull();
  });

  it('out of service (no card reader): the screen is told why, and no sale starts, so nobody pays', async () => {
    const { sessions, issuance, cassette } = setup();
    cassette.unavailable = 'no card reader is connected';
    expect((await new CatalogService(issuance, cassette).setup()).outOfService).toBe('no card reader is connected');
    await expectDomainError(sessions.start(REQUEST), 'unavailable');
    expect(issuance.created).toHaveLength(0);
  });
});

describe('starting a sale', () => {
  it('asks the issuance server for a quote in the chosen asset; refunds go back to the sender', async () => {
    const { sessions, issuance } = setup();
    const view = await sessions.start(REQUEST);
    expect(view.stage).toBe('awaiting_payment');
    expect(view.banknote).toBe('0.01 ETH');
    expect(view.payment.network).toBe('Base');
    expect(view.payment.refundTo).toBeNull();
    expect(issuance.created).toEqual([
      { amount: BANKNOTE.amount, originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near' },
    ]);
  });

  it('passes on a refund address when the customer gives one (paying from an exchange)', async () => {
    const { sessions, issuance } = setup();
    const view = await sessions.start({ ...REQUEST, refundTo: EVM_ADDRESS });
    expect(view.payment.refundTo).toBe(EVM_ADDRESS);
    expect(issuance.created[0]?.refundTo).toBe(EVM_ADDRESS);
  });

  it('refuses what it can’t sell, and never asks the issuance server', async () => {
    const { sessions, issuance } = setup();
    await expectDomainError(sessions.start({ ...REQUEST, amount: '123' }), 'invalid-request');
    await expectDomainError(sessions.start({ ...REQUEST, paymentOptionId: 'doge-moon' }), 'invalid-request');
    await expectDomainError(sessions.start({ ...REQUEST, refundTo: '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed' }), 'invalid-request'); // bad checksum
    await expectDomainError(sessions.start({ ...REQUEST, paymentOptionId: 'usdc-solana', refundTo: EVM_ADDRESS }), 'invalid-request'); // EVM address for Solana
    await expectDomainError(sessions.start({ ...REQUEST, pin: '12' }), 'invalid-request');
    await expectDomainError(sessions.start({ ...REQUEST, pin: '12a4' }), 'invalid-request');
    expect(issuance.created).toHaveLength(0);
  });

  it('sells one banknote at a time', async () => {
    const { sessions } = setup();
    await sessions.start(REQUEST);
    await expectDomainError(sessions.start(REQUEST), 'conflict');
  });

  it('never shows the PIN', async () => {
    const { sessions } = setup();
    const view = await sessions.start({ ...REQUEST, pin: '97531' });
    expect(JSON.stringify(view)).not.toContain('97531');
    expect(JSON.stringify(sessions.view())).not.toContain('97531');
  });
});

describe('a sale that ends without a banknote', () => {
  it('expired: the screen says so, and the ATM is free again after finish()', async () => {
    const { sessions, issuance, cassette } = setup();
    await sessions.start(REQUEST);
    issuance.setStatus(issuance.firstSaleId(), 'EXPIRED');
    await waitUntil(() => sessions.view()?.stage === 'expired');
    expect((cassette as CountingCassette).taken).toBe(0);
    sessions.finish();
    expect(sessions.view()).toBeNull();
    await sessions.start(REQUEST); // a new sale can begin
  });

  it('refunded: the money went back, no card is touched', async () => {
    const { sessions, issuance, cassette } = setup();
    await sessions.start(REQUEST);
    issuance.setStatus(issuance.firstSaleId(), 'REFUNDED');
    await waitUntil(() => sessions.view()?.stage === 'refunded');
    expect((cassette as CountingCassette).taken).toBe(0);
  });

  it('cancelled, then paid anyway: no banknote is made, the operator is told', async () => {
    const { sessions, issuance, cassette, log } = setup();
    await sessions.start(REQUEST);
    expect(sessions.cancel().stage).toBe('cancelled');
    issuance.setStatus(issuance.firstSaleId(), 'PAID');
    await waitUntil(() => log.includes('paid after it was cancelled'));
    expect((cassette as CountingCassette).taken).toBe(0);
    expect(issuance.issued).toBe(0);
  });

  it('a sale in progress can be neither finished nor cancelled twice', async () => {
    const { sessions } = setup();
    await sessions.start(REQUEST);
    expect(() => sessions.finish()).toThrow(DomainError);
    sessions.cancel();
    expect(() => sessions.cancel()).toThrow(DomainError);
  });

  it('issuance server unreachable until well past the deadline: failed, for the operator', async () => {
    const { sessions, issuance, log } = setup({ graceMs: 0 });
    issuance.paymentWindowMs = 0; // the deadline is now
    issuance.unreachable = true;
    await sessions.start(REQUEST);
    await waitUntil(() => sessions.view()?.stage === 'failed');
    expect(log.includes('OPERATOR')).toBe(true);
  });

  it('a card problem after payment: failed, and nothing is dispensed', async () => {
    const { sessions, dispenser } = setup();
    await sessions.start(REQUEST);
    await sessions.simulatePayment(); // the test cassette is empty: nextBlankCard throws
    await waitUntil(() => sessions.view()?.stage === 'failed');
    expect(sessions.view()?.problem).toMatch(/cassette empty/);
    expect(dispenser.dispensed).toBe(0);
  });
});

describe('the dummy reader (testing the sale and the mechanics before the NFC reader arrives)', () => {
  it('the screen is told, and the ATM sells', async () => {
    const { issuance, cassette } = setup();
    cassette.dummy = true;
    const view = await new CatalogService(issuance, cassette).setup();
    expect(view.dummyReader).toBe(true);
    expect(view.outOfService).toBeNull();
  });

  it('paid: nothing is issued and the card is handed out blank; the sale stays PAID at the issuance server', async () => {
    const { sessions, issuance, cassette, dispenser, log } = setup();
    cassette.dummy = true;
    await sessions.start(REQUEST);
    await sessions.simulatePayment();
    await waitUntil(() => sessions.view()?.stage === 'dispensed');
    expect(cassette.taken).toBe(0); // no card is asked for: there is no chip to talk to
    expect(issuance.issued).toBe(0); // no funding, no certificate
    expect(issuance.sales.get(issuance.firstSaleId())?.status).toBe('PAID');
    expect(dispenser.dispensed).toBe(1);
    expect(log.includes('DUMMY READER')).toBe(true);
    expect(log.includes('no money moved')).toBe(true);
  });

  it('real payments: the operator is told to refund the money, which stays in the reserve', async () => {
    const { sessions, issuance, cassette, log } = setup();
    cassette.dummy = true;
    issuance.simulatedPayments = false;
    await sessions.start(REQUEST);
    issuance.setStatus(issuance.firstSaleId(), 'PAID');
    await waitUntil(() => sessions.view()?.stage === 'dispensed');
    expect(log.includes('OPERATOR: the sale stays PAID at the issuance server, refund')).toBe(true);
  });

  it('the servos fail: failed, with their reason, for the operator', async () => {
    const { sessions, cassette, dispenser, log } = setup();
    cassette.dummy = true;
    dispenser.failure = new Error('the servos stopped before the card was out (no PWM)');
    await sessions.start(REQUEST);
    await sessions.simulatePayment();
    await waitUntil(() => sessions.view()?.stage === 'failed');
    expect(sessions.view()?.problem).toMatch(/no PWM/);
    expect(log.includes('OPERATOR')).toBe(true);
  });
});

describe('simulated payments', () => {
  it('are refused when the issuance server takes real payments', async () => {
    const { sessions, issuance } = setup();
    issuance.simulatedPayments = false;
    await sessions.start(REQUEST);
    await expectDomainError(sessions.simulatePayment(), 'not-found');
  });
});
