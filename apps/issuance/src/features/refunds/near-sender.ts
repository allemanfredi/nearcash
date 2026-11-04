import { jsonRpc } from './json-rpc.ts';

type IndexedTransactions = { txns?: { signer_account_id?: string }[] };
type TransactionResult = { receipts_outcome?: { outcome?: { executor_id?: string; logs?: string[] } }[] };
type FtTransferEvent = { standard?: string; event?: string; data?: { old_owner_id?: string; new_owner_id?: string }[] };

/**
 * Who paid a deposit address on NEAR. A NEAR node finds a transaction only
 * together with its signer, so the signer comes first from an indexer
 * (NearBlocks). Then the transaction's NEP-141 `ft_transfer` events, logged
 * by the token contract, name the account the tokens came from
 * (`old_owner_id`): the right one even when the signer paid through a contract.
 * Returns the one sender of all the transactions, or null.
 */
export async function findNearSender(
  rpcUrl: string,
  indexerUrl: string,
  token: string,
  depositAddress: string,
  transactions: readonly string[],
): Promise<string | null> {
  const senders = new Set<string>();

  for (const hash of transactions) {
    const indexed = await getJson<IndexedTransactions>(`${indexerUrl.replace(/\/+$/, '')}/v1/txns/${encodeURIComponent(hash)}`);
    const signer = indexed.txns?.[0]?.signer_account_id;
    if (!signer) continue;

    const result = await jsonRpc<TransactionResult>(rpcUrl, 'tx', { tx_hash: hash, sender_account_id: signer, wait_until: 'FINAL' });
    for (const receipt of result.receipts_outcome ?? []) {
      // Only events logged by the token contract itself count.
      if (receipt.outcome?.executor_id !== token) continue;
      for (const log of receipt.outcome.logs ?? []) {
        for (const transfer of ftTransfers(log)) {
          if (transfer.new_owner_id === depositAddress && transfer.old_owner_id) senders.add(transfer.old_owner_id);
        }
      }
    }
  }
  return senders.size === 1 ? [...senders][0]! : null;
}

/** The transfers in an "EVENT_JSON:{…}" log line of a NEP-141 contract. */
function ftTransfers(log: string): NonNullable<FtTransferEvent['data']> {
  if (!log.startsWith('EVENT_JSON:')) return [];
  try {
    const event = JSON.parse(log.slice('EVENT_JSON:'.length)) as FtTransferEvent;
    return event.standard === 'nep141' && event.event === 'ft_transfer' ? (event.data ?? []) : [];
  } catch {
    return [];
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`GET ${url} failed (${response.status})`);
  return (await response.json()) as T;
}
