/**
 * What a customer can pay with at the ATM: a token on a chain, as 1Click
 * knows it. The issuance server turns any of these into the banknote's
 * token in the bank's reserve (1Click quote). USDC, on any chain, is taken
 * at face value: the customer sends exactly the banknote's value
 * (apps/issuance/src/features/sales/face-value.ts).
 *
 * Asset ids and decimals checked against the live 1Click token list
 * (GET https://1click.chaindefuser.com/v0/tokens) on 2026-11-04.
 *
 * Shared by the ATM server (authoritative: it only accepts these ids) and
 * the kiosk page (which lists them as two choices: the network, then the
 * token on it).
 */

/** Which address format the chain uses: decides how a refund address is checked. */
export type AddressKind = 'evm' | 'solana' | 'near';

export type PaymentOption = {
  /** Short stable id the kiosk sends back, e.g. "usdc-base". */
  id: string;
  /** 1Click asset id: what the issuance server asks a quote for. */
  assetId: string;
  token: string;
  network: string;
  /** Decimals of the asset on its chain: to show the amount to send. */
  decimals: number;
  addressKind: AddressKind;
};

export const PAYMENT_OPTIONS: readonly PaymentOption[] = [
  {
    id: 'usdc-base',
    assetId: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near',
    token: 'USDC',
    network: 'Base',
    decimals: 6,
    addressKind: 'evm',
  },
  {
    id: 'usdc-arbitrum',
    assetId: 'nep141:arb-0xaf88d065e77c8cc2239327c5edb3a432268e5831.omft.near',
    token: 'USDC',
    network: 'Arbitrum',
    decimals: 6,
    addressKind: 'evm',
  },
  {
    id: 'usdc-ethereum',
    assetId: 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near',
    token: 'USDC',
    network: 'Ethereum',
    decimals: 6,
    addressKind: 'evm',
  },
  {
    id: 'usdc-solana',
    assetId: 'nep141:sol-5ce3bf3a31af18be40ba30f721101b4341690186.omft.near',
    token: 'USDC',
    network: 'Solana',
    decimals: 6,
    addressKind: 'solana',
  },
  {
    id: 'usdc-near',
    assetId: 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
    token: 'USDC',
    network: 'NEAR',
    decimals: 6,
    addressKind: 'near',
  },
  {
    id: 'eth-ethereum',
    assetId: 'nep141:eth.omft.near',
    token: 'ETH',
    network: 'Ethereum',
    decimals: 18,
    addressKind: 'evm',
  },
  {
    id: 'sol-solana',
    assetId: 'nep141:sol.omft.near',
    token: 'SOL',
    network: 'Solana',
    decimals: 9,
    addressKind: 'solana',
  },
];

export function findPaymentOption(id: string): PaymentOption | undefined {
  return PAYMENT_OPTIONS.find((option) => option.id === id);
}

/** The networks a customer can pay on, in the order of the list (each once). */
export function paymentNetworks(options: readonly PaymentOption[]): string[] {
  return [...new Set(options.map((option) => option.network))];
}

/** The tokens a customer can pay with on `network`, in the order of the list. */
export function optionsOnNetwork(options: readonly PaymentOption[], network: string): PaymentOption[] {
  return options.filter((option) => option.network === network);
}
