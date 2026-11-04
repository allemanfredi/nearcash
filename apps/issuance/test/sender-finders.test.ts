/**
 * Telling who paid a deposit, on each chain customers pay from. No network:
 * fetch is stubbed with the shapes the nodes answer (EVM, Solana and NEAR
 * JSON-RPC, NearBlocks).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChainSenderFinder } from '../src/features/refunds/chain-sender-finder.ts';
import { originChainOf } from '../src/features/refunds/origin-chain.ts';

afterEach(() => vi.unstubAllGlobals());

const RPC = {
  base: 'https://base.example',
  arbitrum: 'https://arbitrum.example',
  ethereum: 'https://ethereum.example',
  solana: 'https://solana.example',
  near: 'https://near.example',
  nearIndexer: 'https://nearblocks.example',
};
const finder = new ChainSenderFinder(RPC);

/** Answers JSON-RPC calls by method (and plain GETs by URL), recording them. */
function stubNetwork(answers: { rpc?: Record<string, (params: unknown) => unknown>; get?: Record<string, unknown> }) {
  const calls: { url: string; method?: string; params?: unknown }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const { method, params } = JSON.parse(String(init.body)) as { method: string; params: unknown };
        calls.push({ url, method, params });
        const answer = answers.rpc?.[method];
        if (!answer) return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { message: 'unexpected' } }));
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: answer(params) }));
      }
      calls.push({ url });
      return url in (answers.get ?? {}) ? new Response(JSON.stringify(answers.get![url])) : new Response('not found', { status: 404 });
    }),
  );
  return calls;
}

describe('the chain of a 1Click asset', () => {
  it('reads the chain and the token from the asset id', () => {
    expect(originChainOf('nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near')).toEqual({
      kind: 'evm',
      chain: 'base',
      token: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    });
    expect(originChainOf('nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near')).toMatchObject({ chain: 'arbitrum' });
    expect(originChainOf('nep141:eth.omft.near')).toEqual({ kind: 'evm', chain: 'ethereum', token: null });
    expect(originChainOf('nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near')).toEqual({ kind: 'solana', native: false });
    expect(originChainOf('nep141:sol.omft.near')).toEqual({ kind: 'solana', native: true });
    expect(originChainOf('nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1')).toEqual({
      kind: 'near',
      token: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    });
  });

  it('an id it can’t read gives no chain (an operator handles those refunds)', () => {
    expect(originChainOf('nep141:btc.omft.near')).toBeNull();
    expect(originChainOf('nep245:v2_1.omni.hot.tg:56_11111111111111111111')).toBeNull();
    expect(originChainOf('nep141:base-notanaddress.omft.near')).toBeNull();
  });
});

describe('EVM', () => {
  const USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
  const DEPOSIT = '0x1111111111111111111111111111111111111111';
  const PAYER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';
  const pad = (address: string) => `0x${'0'.repeat(24)}${address.slice(2)}`;
  const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

  it('a token: the `from` of the token’s Transfer to the deposit address', async () => {
    const calls = stubNetwork({
      rpc: {
        eth_getTransactionReceipt: () => ({
          status: '0x1',
          logs: [
            // Another token's transfer in the same transaction: ignored.
            { address: '0x9999999999999999999999999999999999999999', topics: [TRANSFER, pad('0x2222222222222222222222222222222222222222'), pad(DEPOSIT)] },
            { address: USDC, topics: [TRANSFER, pad(PAYER), pad(DEPOSIT)] },
          ],
        }),
      },
    });
    const sender = await finder.findSender({
      originAsset: `nep141:base-${USDC}.omft.near`,
      depositAddress: DEPOSIT,
      transactions: ['0xhash'],
    });
    expect(sender).toBe(PAYER);
    expect(calls).toEqual([{ url: RPC.base, method: 'eth_getTransactionReceipt', params: ['0xhash'] }]);
  });

  it('the native coin: the `from` of a transaction sent straight to the deposit address', async () => {
    stubNetwork({ rpc: { eth_getTransactionByHash: () => ({ from: PAYER.toUpperCase().replace('0X', '0x'), to: DEPOSIT }) } });
    expect(await finder.findSender({ originAsset: 'nep141:eth.omft.near', depositAddress: DEPOSIT, transactions: ['0xhash'] })).toBe(PAYER);
  });

  it('no answer when two different addresses paid, or the transaction failed', async () => {
    let call = 0;
    stubNetwork({
      rpc: {
        eth_getTransactionReceipt: () => {
          call += 1;
          const from = call === 1 ? PAYER : '0x3333333333333333333333333333333333333333';
          return { status: '0x1', logs: [{ address: USDC, topics: [TRANSFER, pad(from), pad(DEPOSIT)] }] };
        },
      },
    });
    const deposit = { originAsset: `nep141:base-${USDC}.omft.near`, depositAddress: DEPOSIT, transactions: ['0xa', '0xb'] };
    expect(await finder.findSender(deposit)).toBeNull();

    stubNetwork({ rpc: { eth_getTransactionReceipt: () => ({ status: '0x0', logs: [] }) } });
    expect(await finder.findSender({ ...deposit, transactions: ['0xa'] })).toBeNull();
  });
});

describe('Solana', () => {
  const DEPOSIT = 'DepositAddress1111111111111111111111111111111';
  const PAYER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM';
  const MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

  it('a token: the owner whose balance fell, when the deposit address’s balance rose', async () => {
    stubNetwork({
      rpc: {
        getTransaction: () => ({
          meta: {
            err: null,
            preTokenBalances: [
              { mint: MINT, owner: PAYER, uiTokenAmount: { amount: '20000000' } },
              { mint: MINT, owner: DEPOSIT, uiTokenAmount: { amount: '0' } },
            ],
            postTokenBalances: [
              { mint: MINT, owner: PAYER, uiTokenAmount: { amount: '9900000' } },
              { mint: MINT, owner: DEPOSIT, uiTokenAmount: { amount: '10100000' } },
            ],
          },
        }),
      },
    });
    const sender = await finder.findSender({
      originAsset: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
      depositAddress: DEPOSIT,
      transactions: ['signature'],
    });
    expect(sender).toBe(PAYER);
  });

  it('SOL: the source of a system transfer to the deposit address', async () => {
    stubNetwork({
      rpc: {
        getTransaction: () => ({
          meta: { err: null, innerInstructions: [] },
          transaction: {
            message: {
              instructions: [{ program: 'system', parsed: { type: 'transfer', info: { source: PAYER, destination: DEPOSIT, lamports: 1 } } }],
            },
          },
        }),
      },
    });
    expect(await finder.findSender({ originAsset: 'nep141:sol.omft.near', depositAddress: DEPOSIT, transactions: ['signature'] })).toBe(PAYER);
  });
});

describe('NEAR', () => {
  const USDC = '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
  const DEPOSIT = 'a'.repeat(64);

  it('the signer from NearBlocks, then the token’s ft_transfer event names who the tokens came from', async () => {
    const event = (oldOwner: string, newOwner: string) =>
      `EVENT_JSON:${JSON.stringify({ standard: 'nep141', version: '1.0.0', event: 'ft_transfer', data: [{ old_owner_id: oldOwner, new_owner_id: newOwner, amount: '1' }] })}`;
    const calls = stubNetwork({
      get: { 'https://nearblocks.example/v1/txns/HASH': { txns: [{ signer_account_id: 'alice.near' }] } },
      rpc: {
        tx: () => ({
          receipts_outcome: [
            // The same event logged by another contract: not the token, ignored.
            { outcome: { executor_id: 'fake-token.near', logs: [event('mallory.near', DEPOSIT)] } },
            { outcome: { executor_id: USDC, logs: [event('alice-wallet.near', DEPOSIT)] } },
          ],
        }),
      },
    });
    const sender = await finder.findSender({ originAsset: `nep141:${USDC}`, depositAddress: DEPOSIT, transactions: ['HASH'] });
    expect(sender).toBe('alice-wallet.near');
    expect(calls[1]).toMatchObject({ url: RPC.near, method: 'tx', params: { tx_hash: 'HASH', sender_account_id: 'alice.near' } });
  });
});
