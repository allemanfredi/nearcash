/**
 * The 1Click request the issuance server sends, checked against the API's documented
 * and observed rules (no network: fetch is stubbed).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OneClickGateway, mapOneClickStatus, paymentDetailsFromStatus } from '../src/features/payments/one-click.gateway.ts';

afterEach(() => vi.unstubAllGlobals());

describe('OneClickGateway', () => {
  it('asks for a confidential deposit of exactly the banknote value into the reserve, with the partner key; a customer refund address is refunded on the origin chain', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ quote: { depositAddress: '0xdeposit', amountIn: '5050923', deadline: '2026-11-03T18:00:00Z' } })),
    );
    vi.stubGlobal('fetch', fetchMock);

    const gateway = new OneClickGateway({ apiKey: 'partner-jwt' });
    const quote = await gateway.createQuote({
      originAsset: 'nep141:base-usdc',
      destinationAsset: 'imt:bank:nep141:usdc',
      amountOut: 5_000_000n,
      recipient: 'reserve.far',
      refund: { kind: 'customer', address: '0xuser' },
      deadline: new Date('2026-11-03T18:00:00Z'),
    });

    expect(quote).toMatchObject({ depositAddress: '0xdeposit', amountIn: '5050923' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://1click.chaindefuser.com/v0/quote');
    expect((init.headers as Record<string, string>)['X-API-Key']).toBe('partner-jwt');
    expect(JSON.parse(String(init.body))).toMatchObject({
      dry: false,
      swapType: 'EXACT_OUTPUT', // the reserve receives exactly the banknote value
      amount: '5000000',
      recipient: 'reserve.far',
      recipientType: 'CONFIDENTIAL_INTENTS', // the value the live API lists for FAR deposits
      refundTo: '0xuser',
      refundType: 'ORIGIN_CHAIN', // a failed swap goes back to the customer's address, never to a card
      depositType: 'ORIGIN_CHAIN',
    });
  });

  it('without a customer refund address, refunds go into the reserve (the same kind of account as the recipient)', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ quote: { depositAddress: '0xdeposit', amountIn: '1' } })));
    vi.stubGlobal('fetch', fetchMock);
    await new OneClickGateway({ apiKey: 'partner-jwt' }).createQuote({
      originAsset: 'nep141:base-usdc',
      destinationAsset: 'imt:bank:nep141:usdc',
      amountOut: 5_000_000n,
      recipient: 'reserve.far',
      refund: { kind: 'reserve' },
      deadline: new Date('2026-11-03T18:00:00Z'),
    });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ refundTo: 'reserve.far', refundType: 'CONFIDENTIAL_INTENTS' });
  });

  it('a dry-run check sends dry: true and needs no deposit address', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ quote: { amountIn: '5050923' } })));
    vi.stubGlobal('fetch', fetchMock);
    const result = await new OneClickGateway({}).checkQuote({
      originAsset: 'a',
      destinationAsset: 'b',
      amountOut: 1n,
      recipient: 'r',
      refund: { kind: 'reserve' },
      deadline: new Date(),
    });
    expect(result.amountIn).toBe('5050923');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).dry).toBe(true);
  });

  it('surfaces the API error text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{"message":"User authentication is required for confidential intent quotes"}', { status: 401 })),
    );
    await expect(
      new OneClickGateway({}).createQuote({
        originAsset: 'a',
        destinationAsset: 'b',
        amountOut: 1n,
        recipient: 'r',
        refund: { kind: 'reserve' },
        deadline: new Date(),
      }),
    ).rejects.toThrow(/User authentication is required/);
  });
});

describe('1Click statuses', () => {
  it('only an explicit SUCCESS counts as paid', () => {
    expect(mapOneClickStatus('SUCCESS')).toBe('SUCCESS');
    expect(mapOneClickStatus('REFUNDED')).toBe('REFUNDED');
    expect(mapOneClickStatus('FAILED')).toBe('FAILED');
    for (const inFlight of ['PENDING_DEPOSIT', 'KNOWN_DEPOSIT_TX', 'PROCESSING', 'INCOMPLETE_DEPOSIT', '']) {
      expect(mapOneClickStatus(inFlight)).toBe('PENDING');
    }
  });
});

describe('1Click payment details', () => {
  it('reads the refunded amount and the deposit transactions', () => {
    expect(
      paymentDetailsFromStatus({
        status: 'SUCCESS',
        swapDetails: { refundedAmount: '49077', originChainTxHashes: [{ hash: '0xabc' }, { hash: '0xdef' }] },
      }),
    ).toEqual({ status: 'SUCCESS', refundedAmount: 49077n, depositTransactions: ['0xabc', '0xdef'] });
  });

  it('nothing refunded when the field is missing, null or not a number', () => {
    expect(paymentDetailsFromStatus({ status: 'PENDING_DEPOSIT' })).toEqual({ status: 'PENDING', refundedAmount: 0n, depositTransactions: [] });
    expect(paymentDetailsFromStatus({ status: 'SUCCESS', swapDetails: { refundedAmount: null } }).refundedAmount).toBe(0n);
    expect(paymentDetailsFromStatus({ status: 'SUCCESS', swapDetails: { refundedAmount: '0.5' } }).refundedAmount).toBe(0n);
  });
});
