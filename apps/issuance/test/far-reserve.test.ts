/**
 * The FAR reserve: funding a card is a transfer from FAR to FAR made through
 * 1Click (fetch stubbed: the requests follow the 1Click API specification
 * and what the live API answered in a dry run), and the settings it needs.
 */
import { createRequire } from 'node:module';
import type * as NearApi from 'near-api-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigurationError, type IssuanceConfig, issuanceConfigFromEnvironment } from '../src/config/issuance-config.ts';
import { CertificatesService } from '../src/features/certificates/certificates.service.ts';
import { OneClickClient } from '../src/features/payments/one-click.client.ts';
import { SimulatedGateway } from '../src/features/payments/simulated.gateway.ts';
import { FarReserve } from '../src/features/reserve/far.reserve.ts';
import { ReserveKey } from '../src/features/reserve/reserve-key.ts';
import { assetIdOf } from '../src/features/reserve/reserve-payment.ts';
import type { CardFunding, Nep413Payload, Reserve, SignedNep413 } from '../src/features/reserve/reserve.port.ts';
import { SimulatedReserve } from '../src/features/reserve/simulated.reserve.ts';
import { JsonFileSaleRepository } from '../src/features/sales/json-file-sale.repository.ts';
import { SalesService } from '../src/features/sales/sales.service.ts';
import { systemClock } from '../src/common/clock.ts';
import { TEN, TestAuthority, bornCard } from './fakes.ts';

afterEach(() => vi.unstubAllGlobals());

const near = createRequire(import.meta.url)('near-api-js') as typeof NearApi;

/** USDC as 1Click names it. */
const USDC = 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const CARD = '0x' + 'c'.repeat(40);
const DEPOSIT = 'f084da86f67d743cb1c097905acf487c957095734732c581c1d7116a7b31522d';

/** A reserve with a real key: its account is the key's implicit account, as in production. */
function farReserve(timing = { pollMs: 1, timeoutMs: 1_000 }) {
  const keyPair = near.KeyPair.fromRandom('ed25519');
  const account = Buffer.from(keyPair.getPublicKey().data).toString('hex');
  const reserve = new FarReserve(
    { contractId: 'intents.far', reserveAccountId: account, reservePrivateKey: keyPair.toString() as `ed25519:${string}` },
    new OneClickClient({ apiKey: 'partner-jwt' }),
    timing,
  );
  return { reserve, account, publicKey: keyPair.getPublicKey().toString() };
}

/** The intent 1Click prepares (shape copied from a live generate-intent answer). */
function transferIntent(signer: string, amount = TEN.toString()): Nep413Payload {
  return {
    message: JSON.stringify({
      deadline: '2026-11-08T13:53:48.904Z',
      intents: [{ intent: 'transfer', receiver_id: DEPOSIT, tokens: { [`imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`]: amount } }],
      signer_id: signer,
    }),
    nonce: 'Vij2xgDhEPMXACoAuE4W5hgHMguLJYJXWxTgPGZaQAU=',
    recipient: 'intents.far',
  };
}

/** Answers 1Click by path (each answer may change call after call), recording every request. */
function stubOneClick(answers: Record<string, () => Response>) {
  const requests: { method: string; path: string; headers: Record<string, string>; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      requests.push({
        method: init?.method ?? 'GET',
        path,
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return answers[path]?.() ?? new Response('{"message":"unexpected"}', { status: 500 });
    }),
  );
  return requests;
}

const json = (body: unknown, status = 200) => () => new Response(JSON.stringify(body), { status });
const quote = (minAmountOut = TEN.toString()) => json({ quote: { depositAddress: DEPOSIT, amountOut: minAmountOut, minAmountOut } });
/** /v0/status answering the given statuses one after the other (the last one repeats). */
function statuses(...answers: (string | Error)[]) {
  let call = 0;
  return () => {
    const answer = answers[Math.min(call++, answers.length - 1)]!;
    return answer instanceof Error ? new Response('{"message":"bad gateway"}', { status: 502 }) : new Response(JSON.stringify({ status: answer }));
  };
}

describe('funding a card from the FAR reserve, through 1Click', () => {
  it('quotes FAR → FAR (same token, the card as recipient), signs exactly 1Click’s transfer, submits it and waits for SUCCESS', async () => {
    const { reserve, account, publicKey } = farReserve();
    const requests = stubOneClick({
      '/v0/quote': quote(),
      '/v0/generate-intent': json({ intent: { standard: 'nep413', payload: transferIntent(account) } }),
      '/v0/submit-intent': json({ intentHash: 'INTENT' }),
      '/v0/status': statuses('PENDING_DEPOSIT', 'PROCESSING', 'SUCCESS'),
    });

    expect(await reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).toBe('INTENT');

    expect(requests.map((request) => request.path)).toEqual([
      '/v0/quote',
      '/v0/generate-intent',
      '/v0/submit-intent',
      '/v0/status',
      '/v0/status',
      '/v0/status',
    ]);
    // Every call carries the partner key, and nothing else.
    for (const request of requests) {
      expect(request.headers['X-API-Key']).toBe('partner-jwt');
      expect(request.headers.Authorization).toBeUndefined();
    }
    expect(requests[0]!.body).toMatchObject({
      dry: false,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 0,
      originAsset: USDC,
      depositType: 'CONFIDENTIAL_INTENTS', // from the reserve, inside FAR
      destinationAsset: USDC, // the same token
      amount: TEN.toString(),
      recipient: CARD,
      recipientType: 'CONFIDENTIAL_INTENTS', // to the card, inside FAR
      refundTo: account, // if it fails, back to the reserve
      refundType: 'CONFIDENTIAL_INTENTS',
    });
    expect(requests[1]!.body).toEqual({ type: 'swap_transfer', standard: 'nep413', signerId: account, depositAddress: DEPOSIT });
    const submitted = requests[2]!.body as { type: string; signedData: SignedNep413 };
    expect(submitted.type).toBe('swap_transfer');
    expect(submitted.signedData).toMatchObject({ standard: 'nep413', payload: transferIntent(account), public_key: publicKey });
  });

  it('a quote that would take a fee from the card is refused before anything is signed', async () => {
    const { reserve } = farReserve();
    const requests = stubOneClick({ '/v0/quote': quote('9990000') });
    await expect(reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).rejects.toThrow(/not funded/);
    expect(requests.map((request) => request.path)).toEqual(['/v0/quote']);
  });

  it('an intent that is not the agreed transfer is not signed, nor submitted', async () => {
    const { reserve, account } = farReserve();
    const requests = stubOneClick({
      '/v0/quote': quote(),
      '/v0/generate-intent': json({ intent: { standard: 'nep413', payload: transferIntent(account, '20000000') } }),
    });
    await expect(reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).rejects.toThrow(/unexpected intent/);
    expect(requests.map((request) => request.path)).not.toContain('/v0/submit-intent');
  });

  it('a refunded or failed transfer throws: the sale then waits for an operator', async () => {
    for (const outcome of ['REFUNDED', 'FAILED']) {
      const { reserve, account } = farReserve();
      stubOneClick({
        '/v0/quote': quote(),
        '/v0/generate-intent': json({ intent: { standard: 'nep413', payload: transferIntent(account) } }),
        '/v0/submit-intent': json({ intentHash: 'INTENT' }),
        '/v0/status': statuses('PROCESSING', outcome),
      });
      await expect(reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).rejects.toThrow(`1Click reports ${outcome}`);
    }
  });

  it('after submitting, a failed status request is asked again; a transfer that never settles throws', async () => {
    const { reserve, account } = farReserve();
    const answers = {
      '/v0/quote': quote(),
      '/v0/generate-intent': json({ intent: { standard: 'nep413', payload: transferIntent(account) } }),
      '/v0/submit-intent': json({ intentHash: 'INTENT' }),
    };
    stubOneClick({ ...answers, '/v0/status': statuses(new Error('502'), 'SUCCESS') });
    expect(await reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).toBe('INTENT');

    const slow = farReserve({ pollMs: 1, timeoutMs: 20 });
    stubOneClick({
      ...answers,
      '/v0/generate-intent': json({ intent: { standard: 'nep413', payload: transferIntent(slow.account) } }),
      '/v0/status': statuses('PROCESSING'),
    });
    await expect(slow.reserve.fundCard({ cardAccountId: CARD, tokenId: USDC, amount: TEN })).rejects.toThrow(/not settled/);
  });

  it('the live check makes only a dry-run quote', async () => {
    const { reserve } = farReserve();
    const requests = stubOneClick({ '/v0/quote': json({ quote: { amountOut: TEN.toString(), minAmountOut: TEN.toString() } }) });
    await reserve.checkCardTransfer(USDC, TEN);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.body).toMatchObject({ dry: true, depositType: 'CONFIDENTIAL_INTENTS', recipientType: 'CONFIDENTIAL_INTENTS' });
  });
});

describe('the reserve’s key', () => {
  it('an implicit account must be the one of its key', () => {
    const keyPair = near.KeyPair.fromRandom('ed25519');
    expect(() => new ReserveKey({ reserveAccountId: 'a'.repeat(64), reservePrivateKey: keyPair.toString() as `ed25519:${string}` })).toThrow(
      /not the one of NEARCASH_RESERVE_PRIVATE_KEY/,
    );
  });

  it('FAR’s IMT ids name the same asset as 1Click', () => {
    expect(assetIdOf(`imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${USDC}`)).toBe(USDC);
    expect(assetIdOf(USDC)).toBe(USDC);
  });
});

describe('the settings for FAR', () => {
  const base = { NEARCASH_ATM_TOKENS: 'atm-duomo:secret-1', NEARCASH_SIGNER: 'dev' };
  const far = { NEARCASH_RESERVE: 'far', NEARCASH_RESERVE_ACCOUNT: 'a'.repeat(64), NEARCASH_RESERVE_PRIVATE_KEY: 'ed25519:x' };

  it('the FAR reserve needs only its account, its key and the 1Click partner key (no relay)', () => {
    const config = issuanceConfigFromEnvironment({ ...base, ...far, NEARCASH_1CLICK_API_KEY: 'partner-jwt' });
    expect(config.reserve).toEqual({
      kind: 'far',
      far: { contractId: 'intents.far', reserveAccountId: 'a'.repeat(64), reservePrivateKey: 'ed25519:x' },
    });
    expect(config.payments.oneClick).toEqual({ apiKey: 'partner-jwt', baseUrl: undefined, recipientType: 'CONFIDENTIAL_INTENTS' });
  });

  it('anything on FAR without the partner key stops at startup', () => {
    expect(() => issuanceConfigFromEnvironment({ ...base, ...far })).toThrow(ConfigurationError);
    expect(() => issuanceConfigFromEnvironment({ ...base, NEARCASH_PAYMENTS: '1click' })).toThrow(/NEARCASH_1CLICK_API_KEY/);
    // Public Intents and simulated payments need no key.
    expect(() => issuanceConfigFromEnvironment({ ...base, NEARCASH_PAYMENTS: '1click', NEARCASH_1CLICK_RECIPIENT_TYPE: 'INTENTS' })).not.toThrow();
    expect(() => issuanceConfigFromEnvironment(base)).not.toThrow();
  });

  it('NEARCASH_RESERVE_TOKEN: the token the reserve receives and sends to cards', () => {
    expect(issuanceConfigFromEnvironment({ ...base, NEARCASH_RESERVE_TOKEN: USDC }).reserveTokenId).toBe(USDC);
    expect(issuanceConfigFromEnvironment(base).reserveTokenId).toBeUndefined();
  });
});

describe('the sales service with NEARCASH_RESERVE_TOKEN', () => {
  /** Records what each card is funded with. */
  class RecordingReserve implements Reserve {
    readonly name = 'recording reserve';
    readonly fundings: CardFunding[] = [];
    async fundCard(funding: CardFunding): Promise<string> {
      this.fundings.push(funding);
      return 'funded';
    }
    signIntent(payload: Nep413Payload): Promise<SignedNep413> {
      return new SimulatedReserve().signIntent(payload);
    }
  }

  it('the quote asks for that token, and the card is funded with it; the certificate keeps the banknote’s', async () => {
    const gateway = new SimulatedGateway();
    const quotes: { destinationAsset: string }[] = [];
    const createQuote = gateway.createQuote.bind(gateway);
    gateway.createQuote = async (request) => {
      quotes.push(request);
      return createQuote(request);
    };
    const reserve = new RecordingReserve();
    const config = { reserveAccountId: 'reserve.far', paymentWindowMinutes: 30, reserveTokenId: USDC } as IssuanceConfig;
    const sales = new SalesService(new JsonFileSaleRepository(undefined), gateway, reserve, new CertificatesService(new TestAuthority(), { birthCertificates: 'required' }), systemClock, config);

    const sale = await sales.createSale({ amount: TEN, originAsset: 'base:usdc' });
    gateway.settle(sale.depositAddress, 'SUCCESS');
    const card = bornCard();
    await sales.issue(sale.id, card.keys, card.birth);

    expect(quotes[0]!.destinationAsset).toBe(USDC);
    expect(reserve.fundings[0]!.tokenId).toBe(USDC);
  });
});
