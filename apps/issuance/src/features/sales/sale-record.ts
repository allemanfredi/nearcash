import type { Sale } from '@nearcash/core';

/** Everything the issuance server remembers about a sale. */
export type SaleRecord = Sale & {
  /**
   * The customer's refund address on the origin chain, when they gave one
   * (1Click refunds it directly). Absent: refunds go into the reserve, which
   * sends them back to the address the payment came from (features/refunds,
   * which keeps its own records).
   */
  refundTo?: string;
  createdAt: string;
  /** Set once, the first time a card is presented for this payment. */
  card?: {
    authPublicKey: string; // compressed hex
    fundsPublicKey: string; // compressed hex
    accountId: string; // the card's FAR account (Ethereum address of F)
    issuedAt: number; // 00:00 UTC of the issue day
  };
  /** True as soon as a transfer to the card has been attempted. */
  fundingStarted?: boolean;
  /** Reference of the completed reserve → card transfer. */
  fundingReference?: string;
  /** The MPC-signed certificate, hex. */
  certificate?: string;
};

/** What ATMs may see of a sale: no refund address, no card data. */
export function toPublicSale(record: SaleRecord): Sale {
  return {
    id: record.id,
    status: record.status,
    amount: record.amount,
    symbol: record.symbol,
    decimals: record.decimals,
    depositAddress: record.depositAddress,
    originAsset: record.originAsset,
    amountIn: record.amountIn,
    deadline: record.deadline,
  };
}
