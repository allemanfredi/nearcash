/**
 * Which payments the bank takes at face value: the customer sends exactly
 * the banknote's amount, and the bank pays the conversion into the
 * reserve's token. The kiosk then asks for "1 USDC", not "1.010224 USDC".
 *
 * USDC on the chains customers pay from, as 1Click names each one inside
 * NEAR Intents (asset ids checked against GET /v0/tokens on 2026-11-04, the
 * same as packages/kiosk-api/src/payment-options.ts). They are different
 * tokens, but each is worth one dollar and has 6 decimals: one unit of any
 * of them pays one unit of a USDC banknote. Converting one into another
 * cost about 0.02 % on 2026-11-11 (1Click dry-run quotes).
 */
export const USDC = {
  ethereum: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
  base: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
  arbitrum: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
  solana: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
  near: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
} as const;

const USDC_ASSETS: ReadonlySet<string> = new Set(Object.values(USDC));

/**
 * True when a customer paying with `paidAsset` sends exactly the banknote's
 * amount: it is the reserve's own token, or both are USDC. Anything else
 * (ETH, SOL) has a price that moves: 1Click prices it, and the customer
 * pays the conversion.
 */
export function payableAtFaceValue(paidAsset: string, reserveAsset: string): boolean {
  return paidAsset === reserveAsset || (USDC_ASSETS.has(paidAsset) && USDC_ASSETS.has(reserveAsset));
}
