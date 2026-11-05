/**
 * Sending a refund back through 1Click from the FAR reserve (fetch stubbed:
 * the requests are checked against the 1Click API specification), and the
 * reserve's NEP-413 signature, checked independently of the SDK that makes it.
 */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import type * as NearApi from 'near-api-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneClickClient } from '../src/features/payments/one-click.client.ts';
import { OneClickRefundSender } from '../src/features/refunds/one-click-refund-sender.ts';
import { SimulatedRefundSender } from '../src/features/refunds/simulated-refund-sender.ts';
import { ReserveKey } from '../src/features/reserve/reserve-key.ts';
import type { Nep413Payload } from '../src/features/reserve/reserve.port.ts';
import { SimulatedReserve } from '../src/features/reserve/simulated.reserve.ts';

afterEach(() => vi.unstubAllGlobals());

// near-api-js through CommonJS, as the reserve's key loads it.
const near = createRequire(import.meta.url)('near-api-js') as typeof NearApi;

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
/** The intent 1Click prepares for a refund: the reserve pays the return quote's deposit address. */
function transferIntent(change: { receiver?: string; token?: string; amount?: string; signer?: string; recipient?: string } = {}): Nep413Payload {
  const transfer = {
    intent: 'transfer',
    receiver_id: change.receiver ?? 'return-deposit',
    // Inside FAR the token is an IMT id: "imt:<treasury>:<asset id>".
    tokens: { [change.token ?? `imt:treasury:${USDC_BASE}`]: change.amount ?? '5000' },
  };
  return {
    message: JSON.stringify({ deadline: '2026-11-04T13:00:00Z', intents: [transfer], signer_id: change.signer ?? 'reserve.far' }),
    nonce: Buffer.alloc(32, 7).toString('base64'),
    recipient: change.recipient ?? 'intents.far',
  };
}
const PAYLOAD = transferIntent();

/** Answers 1Click by path, recording every request body. */
function stubOneClick(answers: Record<string, () => Response>) {
  const requests: { path: string; body: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      requests.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return answers[path]?.() ?? new Response('{"message":"unexpected"}', { status: 500 });
    }),
  );
  return requests;
}

function sender() {
  return new OneClickRefundSender(new OneClickClient({ apiKey: 'partner-jwt' }), new SimulatedReserve(), {
    reserveAccountId: 'reserve.far',
    contractId: 'intents.far',
  });
}

describe('a refund sent back through 1Click', () => {
  it('quotes FAR → the sender on the origin chain, has the reserve sign 1Click’s intent, submits it', async () => {
    const requests = stubOneClick({
      '/v0/quote': () => new Response(JSON.stringify({ quote: { depositAddress: 'return-deposit', amountOut: '4900' } })),
      '/v0/generate-intent': () => new Response(JSON.stringify({ intent: { standard: 'nep413', payload: PAYLOAD }, correlationId: 'c' })),
      '/v0/submit-intent': () => new Response(JSON.stringify({ intentHash: 'INTENT', correlationId: 'c' })),
    });

    const outcome = await sender().send({ asset: USDC_BASE, amount: 5_000n, recipient: '0xpayer' });
    expect(outcome).toEqual({ kind: 'sent', reference: 'INTENT' });

    expect(requests.map((request) => request.path)).toEqual(['/v0/quote', '/v0/generate-intent', '/v0/submit-intent']);
    expect(requests[0]!.body).toMatchObject({
      dry: false,
      swapType: 'EXACT_INPUT', // the whole refund goes in; the fee comes off what arrives
      originAsset: USDC_BASE,
      destinationAsset: USDC_BASE, // the same asset that was paid
      amount: '5000',
      depositType: 'CONFIDENTIAL_INTENTS', // paid from the FAR reserve
      recipient: '0xpayer',
      recipientType: 'DESTINATION_CHAIN', // on the chain the payment came from
      refundTo: 'reserve.far', // if this fails too, back to the reserve
      refundType: 'CONFIDENTIAL_INTENTS',
    });
    expect(requests[1]!.body).toEqual({ type: 'swap_transfer', standard: 'nep413', signerId: 'reserve.far', depositAddress: 'return-deposit' });
    expect(requests[2]!.body).toEqual({
      type: 'swap_transfer',
      signedData: { standard: 'nep413', payload: PAYLOAD, public_key: 'ed25519:simulated-reserve', signature: 'ed25519:simulated' },
    });
  });

  it('too small: 1Click refuses the amount as too low, or nothing would arrive after the fee', async () => {
    stubOneClick({ '/v0/quote': () => new Response('{"message":"Amount is too low for bridge, try at least 1000000"}', { status: 400 }) });
    expect(await sender().send({ asset: USDC_BASE, amount: 3n, recipient: '0xpayer' })).toEqual({
      kind: 'too-small',
      reason: 'Amount is too low for bridge, try at least 1000000',
    });

    stubOneClick({ '/v0/quote': () => new Response(JSON.stringify({ quote: { depositAddress: 'd', amountOut: '0' } })) });
    expect((await sender().send({ asset: USDC_BASE, amount: 3n, recipient: '0xpayer' })).kind).toBe('too-small');
  });

  it('a failure before submitting moved nothing (not-sent: try again); a failure while submitting is thrown (unknown)', async () => {
    stubOneClick({ '/v0/quote': () => new Response('{"message":"service unavailable"}', { status: 503 }) });
    expect(await sender().send({ asset: USDC_BASE, amount: 5_000n, recipient: '0xpayer' })).toEqual({ kind: 'not-sent', reason: 'service unavailable' });

    stubOneClick({
      '/v0/quote': () => new Response(JSON.stringify({ quote: { depositAddress: 'return-deposit', amountOut: '4900' } })),
      '/v0/generate-intent': () => new Response(JSON.stringify({ intent: { standard: 'nep413', payload: PAYLOAD } })),
      '/v0/submit-intent': () => new Response('{"message":"timeout"}', { status: 504 }),
    });
    await expect(sender().send({ asset: USDC_BASE, amount: 5_000n, recipient: '0xpayer' })).rejects.toThrow(/timeout/);
  });
});

describe('the reserve signs only the transfer it agreed to', () => {
  const quote = () => new Response(JSON.stringify({ quote: { depositAddress: 'return-deposit', amountOut: '4900' } }));
  const tampered: [string, Nep413Payload][] = [
    ['another receiver', transferIntent({ receiver: 'attacker.near' })],
    ['a larger amount', transferIntent({ amount: '5000000' })],
    ['another token', transferIntent({ token: 'imt:treasury:nep141:wrap.near' })],
    ['another signer', transferIntent({ signer: 'someone-else.far' })],
    ['another contract', transferIntent({ recipient: 'intents.near' })],
  ];
  for (const [what, payload] of tampered) {
    it(`an intent with ${what} is not signed, nor submitted`, async () => {
      const requests = stubOneClick({
        '/v0/quote': quote,
        '/v0/generate-intent': () => new Response(JSON.stringify({ intent: { standard: 'nep413', payload } })),
      });
      const outcome = await sender().send({ asset: USDC_BASE, amount: 5_000n, recipient: '0xpayer' });
      expect(outcome.kind).toBe('not-sent');
      expect(outcome.kind === 'not-sent' && outcome.reason).toMatch(/unexpected intent/);
      expect(requests.map((request) => request.path)).not.toContain('/v0/submit-intent');
    });
  }

  it('two intents in one message are not signed either', async () => {
    const two = JSON.parse(PAYLOAD.message) as { intents: unknown[] };
    two.intents.push(two.intents[0]);
    stubOneClick({
      '/v0/quote': quote,
      '/v0/generate-intent': () => new Response(JSON.stringify({ intent: { standard: 'nep413', payload: { ...PAYLOAD, message: JSON.stringify(two) } } })),
    });
    expect((await sender().send({ asset: USDC_BASE, amount: 5_000n, recipient: '0xpayer' })).kind).toBe('not-sent');
  });
});

describe('simulated refunds', () => {
  it('anything up to the simulated network fee is too small', async () => {
    const simulated = new SimulatedRefundSender(1_000n);
    expect((await simulated.send({ asset: 'a', amount: 1_000n, recipient: 'r' })).kind).toBe('too-small');
    expect(await simulated.send({ asset: 'a', amount: 1_001n, recipient: 'r' })).toEqual({ kind: 'sent', reference: 'sim-refund-1' });
  });
});

describe('the FAR reserve signs 1Click’s intent exactly (NEP-413)', () => {
  it('a valid ed25519 signature of the NEP-413 hash of the payload, by the reserve’s key', async () => {
    const keyPair = near.KeyPair.fromRandom('ed25519');
    const key = new ReserveKey({ reserveAccountId: 'reserve.far', reservePrivateKey: keyPair.toString() as `ed25519:${string}` });

    const signed = await key.sign(PAYLOAD);
    expect(signed.standard).toBe('nep413');
    expect(signed.payload).toEqual(PAYLOAD); // the payload is passed on untouched
    expect(signed.public_key).toBe(keyPair.getPublicKey().toString());

    // NEP-413: sha256(borsh(u32 2^31 + 413) ‖ borsh({message, nonce[32], recipient, callbackUrl: None})).
    const string = (text: string) => {
      const bytes = Buffer.from(text, 'utf8');
      const length = Buffer.alloc(4);
      length.writeUInt32LE(bytes.length);
      return Buffer.concat([length, bytes]);
    };
    const tag = Buffer.alloc(4);
    tag.writeUInt32LE(2 ** 31 + 413);
    const hash = createHash('sha256')
      .update(Buffer.concat([tag, string(PAYLOAD.message), Buffer.from(PAYLOAD.nonce, 'base64'), string(PAYLOAD.recipient), Buffer.from([0])]))
      .digest();
    const signature = near.utils.serialize.base_decode(signed.signature.replace(/^ed25519:/, ''));
    expect(keyPair.verify(hash, signature)).toBe(true);
  });
});
