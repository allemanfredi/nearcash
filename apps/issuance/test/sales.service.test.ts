/**
 * The selling rules (SalesService), built directly with test doubles through
 * its constructor — the same dependencies Nest injects.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  type CertificateSigner,
  DEV_ISSUER_SIGNER,
  bytesToHex,
  decodeCertificate,
  ethereumAddress,
  issueDay,
  verifyCertificateSignature,
} from '@nearcash/core';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/common/clock.ts';
import { DomainError } from '../src/common/domain-error.ts';
import type { IssuanceConfig } from '../src/config/issuance-config.ts';
import { CertificatesService } from '../src/features/certificates/certificates.service.ts';
import { SimulatedGateway } from '../src/features/payments/simulated.gateway.ts';
import { SalesService } from '../src/features/sales/sales.service.ts';
import { JsonFileSaleRepository } from '../src/features/sales/json-file-sale.repository.ts';
import { CountingReserve, TEN, TestAuthority, cardKeys } from './fakes.ts';

/** Only the settings the sales rules read. */
const CONFIG = { reserveAccountId: 'bank-reserve.far', paymentWindowMinutes: 30 } as IssuanceConfig;

function setup(options: { salesFile?: string; signer?: CertificateSigner; reserve?: CountingReserve } = {}) {
  const gateway = new SimulatedGateway();
  const reserve = options.reserve ?? new CountingReserve();
  const repository = new JsonFileSaleRepository(options.salesFile);
  const certificates = new CertificatesService(new TestAuthority(options.signer));
  const sales = new SalesService(repository, gateway, reserve, certificates, systemClock, CONFIG);
  return { sales, gateway, reserve, repository };
}

async function paidSale(context: ReturnType<typeof setup>) {
  const sale = await context.sales.createSale({ amount: TEN, originAsset: 'base:usdc', refundTo: '0xuser' });
  context.gateway.settle(sale.depositAddress, 'SUCCESS');
  return sale;
}

function expectDomainError(promise: Promise<unknown>, kind: DomainError['kind']) {
  return expect(promise).rejects.toSatisfy((error: unknown) => error instanceof DomainError && error.kind === kind);
}

describe('selling a banknote', () => {
  it('only allowed denominations can be sold', async () => {
    const { sales } = setup();
    await expectDomainError(sales.createSale({ amount: 123n, originAsset: 'base:usdc', refundTo: '0xuser' }), 'invalid-request');
  });

  it('the quote pays the reserve exactly the banknote value; refunds go to the customer’s address, or into the reserve', async () => {
    const { sales, gateway, repository } = setup();
    const quotes: unknown[] = [];
    const createQuote = gateway.createQuote.bind(gateway);
    gateway.createQuote = async (request) => {
      quotes.push(request);
      return createQuote(request);
    };
    const withAddress = await sales.createSale({ amount: TEN, originAsset: 'base:usdc', refundTo: '0xuser' });
    const withoutAddress = await sales.createSale({ amount: TEN, originAsset: 'base:usdc' });
    expect(quotes).toMatchObject([
      { amountOut: TEN, recipient: 'bank-reserve.far', refund: { kind: 'customer', address: '0xuser' } },
      { amountOut: TEN, recipient: 'bank-reserve.far', refund: { kind: 'reserve' } },
    ]);
    // The refund address is remembered (it tells the refunds feature to stay out), never shown to ATMs.
    expect(repository.get(withAddress.id)?.refundTo).toBe('0xuser');
    expect(repository.get(withoutAddress.id)?.refundTo).toBeUndefined();
    expect(JSON.stringify(withAddress)).not.toContain('0xuser');
  });

  it('no payment, no banknote — and the card is not bound to the sale', async () => {
    const context = setup();
    const sale = await context.sales.createSale({ amount: TEN, originAsset: 'base:usdc', refundTo: '0xuser' });
    expect(sale.status).toBe('AWAITING_PAYMENT');
    await expectDomainError(context.sales.issue(sale.id, cardKeys()), 'payment-required');
    expect(context.repository.get(sale.id)?.card).toBeUndefined();
    expect(context.reserve.calls).toBe(0);
  });

  it('a paid sale funds the card inside the reserve and returns a valid certificate', async () => {
    const context = setup();
    const sale = await paidSale(context);
    expect((await context.sales.getSale(sale.id)).status).toBe('PAID');

    const keys = cardKeys();
    const certificate = decodeCertificate(await context.sales.issue(sale.id, keys));

    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect(certificate.amount).toBe(TEN);
    expect(certificate.issuedAt).toBe(issueDay()); // the day, not the time of purchase
    expect(context.reserve.inner.cards.get(ethereumAddress(keys.fundsPublicKey))).toBe(TEN);
    expect((await context.sales.getSale(sale.id)).status).toBe('ISSUED');
  });

  it('a refunded payment never gives a banknote', async () => {
    const context = setup();
    const sale = await context.sales.createSale({ amount: TEN, originAsset: 'base:usdc', refundTo: '0xuser' });
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    expect((await context.sales.getSale(sale.id)).status).toBe('REFUNDED');
    await expectDomainError(context.sales.issue(sale.id, cardKeys()), 'payment-required');
  });

  it('an unknown sale is not found', async () => {
    const { sales } = setup();
    await expectDomainError(sales.getSale('nope'), 'not-found');
  });
});

describe('one payment, one card', () => {
  it('the same card gets the same certificate again, funded once', async () => {
    const context = setup();
    const sale = await paidSale(context);
    const keys = cardKeys();
    const first = await context.sales.issue(sale.id, keys);
    const again = await context.sales.issue(sale.id, keys);
    expect(bytesToHex(again)).toBe(bytesToHex(first));
    expect(context.reserve.calls).toBe(1);
  });

  it('a second card cannot use the same payment', async () => {
    const context = setup();
    const sale = await paidSale(context);
    await context.sales.issue(sale.id, cardKeys());
    await expectDomainError(context.sales.issue(sale.id, cardKeys()), 'conflict');
    expect(context.reserve.calls).toBe(1);
  });

  it('concurrent requests for one sale fund the card once', async () => {
    const context = setup();
    const sale = await paidSale(context);
    const keys = cardKeys();
    await Promise.all([context.sales.issue(sale.id, keys), context.sales.issue(sale.id, keys), context.sales.issue(sale.id, keys)]);
    expect(context.reserve.calls).toBe(1);
  });

  it('survives a restart: a used payment stays used', async () => {
    const salesFile = join(mkdtempSync(join(tmpdir(), 'nearcash-issuance-')), 'sales.json');
    const before = setup({ salesFile });
    const sale = await paidSale(before);
    const keys = cardKeys();
    const certificate = await before.sales.issue(sale.id, keys);

    const after = setup({ salesFile }); // a new process reading the same file
    expect(bytesToHex(await after.sales.issue(sale.id, keys))).toBe(bytesToHex(certificate));
    await expectDomainError(after.sales.issue(sale.id, cardKeys()), 'conflict');
  });
});

describe('never funding twice', () => {
  it('stops for a manual check when a transfer was interrupted', async () => {
    const reserve = new CountingReserve();
    reserve.failNext = true;
    const context = setup({ reserve });
    const sale = await paidSale(context);
    const keys = cardKeys();

    await expect(context.sales.issue(sale.id, keys)).rejects.toThrow(/relay timeout/);
    // The outcome of that transfer is unknown: do not send another one.
    await expectDomainError(context.sales.issue(sale.id, keys), 'needs-operator');
    expect(reserve.calls).toBe(1);
  });

  it('if signing fails after funding, a retry signs without funding again', async () => {
    let failures = 1;
    const flakySigner: CertificateSigner = {
      name: 'flaky MPC',
      publicKey: () => DEV_ISSUER_SIGNER.publicKey(),
      sign: async (request) => {
        if (failures-- > 0) throw new Error('MPC timeout');
        return DEV_ISSUER_SIGNER.sign(request);
      },
    };
    const context = setup({ signer: flakySigner });
    const sale = await paidSale(context);
    const keys = cardKeys();

    await expect(context.sales.issue(sale.id, keys)).rejects.toThrow(/MPC timeout/);
    const certificate = decodeCertificate(await context.sales.issue(sale.id, keys));
    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect(context.reserve.calls).toBe(1);
  });
});
