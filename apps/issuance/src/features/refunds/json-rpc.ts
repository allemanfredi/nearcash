/** A JSON-RPC 2.0 call (EVM, Solana and NEAR nodes all speak it); throws on a transport or RPC error. */
export async function jsonRpc<T>(url: string, method: string, params: unknown): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method} at ${url} failed (${response.status})`);
  const json = (await response.json()) as { result?: T; error?: unknown };
  if (json.error !== undefined) throw new Error(`${method} at ${url} failed: ${JSON.stringify(json.error)}`);
  return json.result as T;
}
