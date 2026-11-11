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
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { systemClock } from '../src/common/clock.ts';
import { DomainError } from '../src/common/domain-error.ts';
import type { IssuanceConfig } from '../src/config/issuance-config.ts';
import { CertificatesService } from '../src/features/certificates/certificates.service.ts';
import type { QuoteRequest } from '../src/features/payments/payment-gateway.port.ts';
import { SimulatedGateway } from '../src/features/payments/simulated.gateway.ts';
import { SalesService } from '../src/features/sales/sales.service.ts';
import { JsonFileSaleRepository } from '../src/features/sales/json-file-sale.repository.ts';
import { CountingReserve, TEN, TestAuthority, bornCard, cardKeys } from './fakes.ts';

/** Only the settings the sales rules read. */
const CONFIG = { reserveAccountId: 'bank-reserve.far', paymentWindowMinutes: 30 } as IssuanceConfig;

function setup(
  options: {
    salesFile?: string;
    signer?: CertificateSigner;
    reserve?: CountingReserve;
    birthCertificates?: IssuanceConfig['birthCertificates'];
  } = {},
) {
  const gateway = new SimulatedGateway();
  const reserve = options.reserve ?? new CountingReserve();
  const repository = new JsonFileSaleRepository(options.salesFile);
  const certificates = new CertificatesService(new TestAuthority(options.signer), {
    birthCertificates: options.birthCertificates ?? 'required',
  });
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
      { amount: TEN, recipient: 'bank-reserve.far', refund: { kind: 'customer', address: '0xuser' } },
      { amount: TEN, recipient: 'bank-reserve.far', refund: { kind: 'reserve' } },
    ]);
    // The refund address is remembered (it tells the refunds feature to stay out), never shown to ATMs.
    expect(repository.get(withAddress.id)?.refundTo).toBe('0xuser');
    expect(repository.get(withoutAddress.id)?.refundTo).toBeUndefined();
    expect(JSON.stringify(withAddress)).not.toContain('0xuser');
  });

  it('USDC is taken at face value (the bank pays the conversion); any other token, the customer pays it', async () => {
    const usdc = {
      ethereum: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
      base: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    };
    const gateway = new SimulatedGateway();
    const quotes: QuoteRequest[] = [];
    const createQuote = gateway.createQuote.bind(gateway);
    gateway.createQuote = async (request) => {
      quotes.push(request);
      return createQuote(request);
    };
    // The reserve holds USDC on Ethereum, as NEARCASH_RESERVE_TOKEN says.
    const config = { ...CONFIG, reserveTokenId: usdc.ethereum } as IssuanceConfig;
    const certificates = new CertificatesService(new TestAuthority(), { birthCertificates: 'required' });
    const sales = new SalesService(new JsonFileSaleRepository(undefined), gateway, new CountingReserve(), certificates, systemClock, config);

    await sales.createSale({ amount: TEN, originAsset: usdc.base }); // another USDC
    await sales.createSale({ amount: TEN, originAsset: usdc.ethereum }); // the reserve's own token
    await sales.createSale({ amount: TEN, originAsset: 'nep141:eth.omft.near' }); // ETH: its price moves
    expect(quotes.map((quote) => [quote.destinationAsset, quote.conversionPaidBy])).toEqual([
      [usdc.ethereum, 'bank'],
      [usdc.ethereum, 'bank'],
      [usdc.ethereum, 'customer'],
    ]);
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

    const { keys, birth } = bornCard();
    const certificate = decodeCertificate(await context.sales.issue(sale.id, keys, birth));

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
    const { keys, birth } = bornCard();
    const first = await context.sales.issue(sale.id, keys, birth);
    const again = await context.sales.issue(sale.id, keys, birth);
    expect(bytesToHex(again)).toBe(bytesToHex(first));
    expect(context.reserve.calls).toBe(1);
  });

  it('a second card cannot use the same payment', async () => {
    const context = setup();
    const sale = await paidSale(context);
    const first = bornCard();
    await context.sales.issue(sale.id, first.keys, first.birth);
    const second = bornCard();
    await expectDomainError(context.sales.issue(sale.id, second.keys, second.birth), 'conflict');
    expect(context.reserve.calls).toBe(1);
  });

  it('concurrent requests for one sale fund the card once', async () => {
    const context = setup();
    const sale = await paidSale(context);
    const { keys, birth } = bornCard();
    await Promise.all([context.sales.issue(sale.id, keys, birth), context.sales.issue(sale.id, keys, birth), context.sales.issue(sale.id, keys, birth)]);
    expect(context.reserve.calls).toBe(1);
  });

  it('survives a restart: a used payment stays used', async () => {
    const salesFile = join(mkdtempSync(join(tmpdir(), 'nearcash-issuance-')), 'sales.json');
    const before = setup({ salesFile });
    const sale = await paidSale(before);
    const { keys, birth } = bornCard();
    const certificate = await before.sales.issue(sale.id, keys, birth);

    const after = setup({ salesFile }); // a new process reading the same file
    expect(bytesToHex(await after.sales.issue(sale.id, keys, birth))).toBe(bytesToHex(certificate));
    await expectDomainError(after.sales.issue(sale.id, cardKeys()), 'conflict');
  });
});

describe('only cards the bank made (birth certificates)', () => {
  it('a card without a birth certificate is refused before anything is bound or funded', async () => {
    const context = setup();
    const sale = await paidSale(context);
    await expectDomainError(context.sales.issue(sale.id, cardKeys()), 'invalid-request');
    expect(context.repository.get(sale.id)?.card).toBeUndefined();
    expect(context.reserve.calls).toBe(0);
    // The sale is still there for a card the bank made.
    const card = bornCard();
    expect(verifyCertificateSignature(decodeCertificate(await context.sales.issue(sale.id, card.keys, card.birth)))).toBe(true);
  });

  it('a chip born with another production key is refused', async () => {
    const context = setup();
    const sale = await paidSale(context);
    const forged = bornCard(secp256k1.utils.randomSecretKey()); // not the bank's production key
    await expect(context.sales.issue(sale.id, forged.keys, forged.birth)).rejects.toThrow(/production key/);
    expect(context.reserve.calls).toBe(0);
  });

  it("keys the chip did not sign are refused (another card's birth)", async () => {
    const context = setup();
    const sale = await paidSale(context);
    await expect(context.sales.issue(sale.id, cardKeys(), bornCard().birth)).rejects.toThrow(/did not sign these keys/);
    expect(context.reserve.calls).toBe(0);
  });

  it('the birth reaches the signer (the issuer contract checks it again)', async () => {
    const seen: unknown[] = [];
    const recordingSigner: CertificateSigner = {
      name: 'recording',
      publicKey: () => DEV_ISSUER_SIGNER.publicKey(),
      sign: async (request) => {
        seen.push(request.birth);
        return DEV_ISSUER_SIGNER.sign(request);
      },
    };
    const context = setup({ signer: recordingSigner });
    const sale = await paidSale(context);
    const card = bornCard();
    await context.sales.issue(sale.id, card.keys, card.birth);
    expect(seen).toEqual([card.birth]);
  });

  it('skipped for demos (NEARCASH_SKIP_BIRTH): a card never born is issued', async () => {
    const context = setup({ birthCertificates: 'skipped' });
    const sale = await paidSale(context);
    expect(verifyCertificateSignature(decodeCertificate(await context.sales.issue(sale.id, cardKeys())))).toBe(true);
  });
});

describe('never funding twice', () => {
  it('stops for a manual check when a transfer was interrupted', async () => {
    const reserve = new CountingReserve();
    reserve.failNext = true;
    const context = setup({ reserve });
    const sale = await paidSale(context);
    const { keys, birth } = bornCard();

    await expect(context.sales.issue(sale.id, keys, birth)).rejects.toThrow(/relay timeout/);
    // The outcome of that transfer is unknown: do not send another one.
    await expectDomainError(context.sales.issue(sale.id, keys, birth), 'needs-operator');
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
    const { keys, birth } = bornCard();

    await expect(context.sales.issue(sale.id, keys, birth)).rejects.toThrow(/MPC timeout/);
    const certificate = decodeCertificate(await context.sales.issue(sale.id, keys, birth));
    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect(context.reserve.calls).toBe(1);
  });
});
