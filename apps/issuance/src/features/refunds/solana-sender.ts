import { jsonRpc } from './json-rpc.ts';

type TokenBalance = { mint?: string; owner?: string; uiTokenAmount?: { amount?: string } };
type Instruction = { program?: string; parsed?: { type?: string; info?: { source?: string; destination?: string } } };
type ParsedTransaction = {
  meta?: {
    err?: unknown;
    preTokenBalances?: TokenBalance[];
    postTokenBalances?: TokenBalance[];
    innerInstructions?: { instructions?: Instruction[] }[];
  };
  transaction?: { message?: { instructions?: Instruction[] } };
};

/**
 * Who paid a deposit address on Solana (getTransaction, jsonParsed):
 *   a token (SPL)   the owner whose balance of a token fell, in a transaction
 *                   where the deposit address's balance of that token rose
 *                   (from the token balances before and after: right whatever
 *                   program made the transfer)
 *   SOL             the source of a system-program transfer to the deposit address
 * Returns the one sender of all the transactions, or null.
 */
export async function findSolanaSender(
  rpcUrl: string,
  native: boolean,
  depositAddress: string,
  transactions: readonly string[],
): Promise<string | null> {
  const senders = new Set<string>();

  for (const signature of transactions) {
    const transaction = await jsonRpc<ParsedTransaction | null>(rpcUrl, 'getTransaction', [
      signature,
      { encoding: 'jsonParsed', maxSupportedTransactionVersion: 0, commitment: 'finalized' },
    ]);
    if (!transaction?.meta || transaction.meta.err) continue; // a failed transaction moved nothing
    const found = native ? solSenders(transaction, depositAddress) : tokenSenders(transaction, depositAddress);
    for (const sender of found) senders.add(sender);
  }
  return senders.size === 1 ? [...senders][0]! : null;
}

function solSenders(transaction: ParsedTransaction, depositAddress: string): string[] {
  const instructions = [
    ...(transaction.transaction?.message?.instructions ?? []),
    ...(transaction.meta?.innerInstructions ?? []).flatMap((inner) => inner.instructions ?? []),
  ];
  return instructions.flatMap((instruction) => {
    const info = instruction.parsed?.info;
    const isTransfer = instruction.program === 'system' && instruction.parsed?.type?.startsWith('transfer');
    return isTransfer && info?.destination === depositAddress && info.source ? [info.source] : [];
  });
}

function tokenSenders(transaction: ParsedTransaction, depositAddress: string): string[] {
  // Change of every (owner, mint) balance in the transaction.
  const change = new Map<string, { owner: string; mint: string; delta: bigint }>();
  const add = (balance: TokenBalance, sign: 1n | -1n) => {
    if (!balance.owner || !balance.mint) return;
    const key = `${balance.owner} ${balance.mint}`;
    const entry = change.get(key) ?? { owner: balance.owner, mint: balance.mint, delta: 0n };
    entry.delta += sign * BigInt(balance.uiTokenAmount?.amount ?? '0');
    change.set(key, entry);
  };
  for (const balance of transaction.meta?.preTokenBalances ?? []) add(balance, -1n);
  for (const balance of transaction.meta?.postTokenBalances ?? []) add(balance, 1n);

  const received = new Set([...change.values()].filter((entry) => entry.owner === depositAddress && entry.delta > 0n).map((entry) => entry.mint));
  return [...change.values()]
    .filter((entry) => received.has(entry.mint) && entry.owner !== depositAddress && entry.delta < 0n)
    .map((entry) => entry.owner);
}
