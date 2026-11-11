/**
 * How a customer pays for a banknote: a quote whose recipient is the bank's
 * reserve, and its status. Only the issuance server asks for quotes and
 * reads their status: an ATM can never claim a payment.
 */

/** Where and what the customer must send. */
export type PaymentQuote = {
  depositAddress: string;
  /** Amount to send, smallest unit of the origin asset. */
  amountIn: string;
  originAsset: string;
  /** ISO time after which an unpaid quote is refunded. */
  deadline: string;
};

/** Only SUCCESS means the reserve received the money. */
export type PaymentStatus = 'PENDING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';

/**
 * Where the payment gateway sends a refund (a failed swap, a payment after
 * the deadline, or what was paid beyond the quote):
 *   customer  straight to the address the customer gave, on the chain they
 *             paid from (customers paying from an exchange give one)
 *   reserve   into the bank's reserve, which sends it back to the address
 *             the payment came from (features/refunds)
 */
export type RefundDestination = { kind: 'customer'; address: string } | { kind: 'reserve' };

export type QuoteRequest = {
  /** 1Click asset id the customer pays with, e.g. "nep141:base-0x833589….omft.near" (USDC on Base). */
  originAsset: string;
  /** Asset the reserve must receive: the banknote's token. */
  destinationAsset: string;
  /** The banknote's value, smallest unit of the reserve's token. */
  amount: bigint;
  /**
   * Who pays the conversion into the reserve's token:
   *   customer  the reserve receives exactly `amount`; the customer is asked
   *             a little more: the conversion, plus a margin in case the
   *             price moves (the unused part is refunded)
   *   bank      the customer sends exactly `amount`, in a token worth the
   *             same as the reserve's (USDC on another chain); the reserve
   *             receives what the conversion leaves, and adds the rest from
   *             its own balance when it funds the card
   */
  conversionPaidBy: 'customer' | 'bank';
  /** The bank's reserve account inside FAR. */
  recipient: string;
  refund: RefundDestination;
  deadline: Date;
};

/** What the gateway knows about a deposit, beyond its status: what the refunds feature needs. */
export type PaymentDetails = {
  status: PaymentStatus;
  /** Origin asset refunded so far (smallest unit): failed swap, late payment, or paid beyond the quote. */
  refundedAmount: bigint;
  /** Hashes of the transactions that paid the deposit address, on the origin chain. */
  depositTransactions: string[];
};

export interface PaymentGateway {
  readonly name: string;
  /** True for the development stand-in: payments can be settled by hand. */
  readonly simulated: boolean;
  createQuote(request: QuoteRequest): Promise<PaymentQuote>;
  status(depositAddress: string): Promise<PaymentStatus>;
  details(depositAddress: string): Promise<PaymentDetails>;
}

/** Injection token of the PaymentGateway. */
export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
