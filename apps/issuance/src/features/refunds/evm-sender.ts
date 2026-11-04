import { jsonRpc } from './json-rpc.ts';

/** topic0 of the ERC-20 event Transfer(address indexed from, address indexed to, uint256 value). */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

type Receipt = { status?: string; logs?: { address?: string; topics?: string[] }[] };
type Transaction = { from?: string; to?: string | null };

/**
 * Who paid a deposit address on an EVM chain (Base, Arbitrum, Ethereum):
 *   a token (ERC-20)   the `from` of the token's Transfer events to the deposit
 *                      address (also right for smart-contract wallets, which
 *                      pay through a contract call)
 *   the native coin    the `from` of a transaction sent straight to it
 * Returns the one sender of all the transactions (lowercase), or null.
 */
export async function findEvmSender(
  rpcUrl: string,
  token: string | null,
  depositAddress: string,
  transactions: readonly string[],
): Promise<string | null> {
  const deposit = depositAddress.toLowerCase();
  const senders = new Set<string>();

  for (const hash of transactions) {
    if (token) {
      const receipt = await jsonRpc<Receipt | null>(rpcUrl, 'eth_getTransactionReceipt', [hash]);
      if (!receipt || receipt.status !== '0x1') continue; // a failed transaction moved nothing
      for (const log of receipt.logs ?? []) {
        const topics = log.topics ?? [];
        if (log.address?.toLowerCase() !== token || topics[0] !== TRANSFER_TOPIC || topics.length < 3) continue;
        if (addressFromTopic(topics[2]!) === deposit) senders.add(addressFromTopic(topics[1]!));
      }
    } else {
      const transaction = await jsonRpc<Transaction | null>(rpcUrl, 'eth_getTransactionByHash', [hash]);
      if (transaction?.from && transaction.to?.toLowerCase() === deposit) senders.add(transaction.from.toLowerCase());
    }
  }
  return senders.size === 1 ? [...senders][0]! : null;
}

/** An indexed address topic is the address left-padded to 32 bytes. */
function addressFromTopic(topic: string): string {
  return `0x${topic.slice(-40)}`.toLowerCase();
}
