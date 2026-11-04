/**
 * Which chain a 1Click asset lives on, read from its id, and the token
 * contract when the id names one. The ids customers pay with
 * (packages/kiosk-api/src/payment-options.ts):
 *
 *   nep141:base-0x8335….omft.near   USDC on Base       → evm, base, token 0x8335…
 *   nep141:arb-0xaf88….omft.near    USDC on Arbitrum   → evm, arbitrum, token 0xaf88…
 *   nep141:eth-0xa0b8….omft.near    USDC on Ethereum   → evm, ethereum, token 0xa0b8…
 *   nep141:eth.omft.near            ETH                → evm, ethereum, native coin
 *   nep141:sol-5ce3….omft.near      USDC on Solana     → solana, a token (the id holds a hash, not the mint)
 *   nep141:sol.omft.near            SOL                → solana, native coin
 *   nep141:17208628…33a1            USDC on NEAR       → near, token contract 17208628…33a1
 *
 * Tokens bridged from other chains are "<chain>[-<address>].omft.near";
 * anything else is a token on NEAR itself.
 */

export type EvmChain = 'base' | 'arbitrum' | 'ethereum';

export type OriginChain =
  /** `token`: the ERC-20 contract (lowercase), or null for the chain's native coin. */
  | { kind: 'evm'; chain: EvmChain; token: string | null }
  | { kind: 'solana'; native: boolean }
  /** `token`: the NEP-141 contract account. */
  | { kind: 'near'; token: string };

const EVM_PREFIXES: Record<string, EvmChain> = { base: 'base', arb: 'arbitrum', eth: 'ethereum' };

/** The chain of a 1Click asset id, or null for one we can't read (an operator handles its refunds). */
export function originChainOf(assetId: string): OriginChain | null {
  const contract = /^nep141:(.+)$/.exec(assetId)?.[1];
  if (!contract) return null;

  const bridged = /^([a-z0-9]+)(?:-(.+))?\.omft\.near$/.exec(contract);
  if (!bridged) return { kind: 'near', token: contract };

  const [, prefix, address] = bridged;
  if (prefix === 'sol') return { kind: 'solana', native: address === undefined };
  const chain = prefix ? EVM_PREFIXES[prefix] : undefined;
  if (!chain) return null;
  if (address !== undefined && !/^0x[0-9a-fA-F]{40}$/.test(address)) return null;
  return { kind: 'evm', chain, token: address?.toLowerCase() ?? null };
}
