/**
 * Sending a refund from the reserve back to the address the payment came
 * from, on its own chain and in its own asset.
 */

export type RefundReturn = {
  /** 1Click asset id: the asset that was paid, and that goes back. */
  asset: string;
  /** Smallest unit of `asset`. */
  amount: bigint;
  /** The address the payment came from. */
  recipient: string;
};

/**
 *   sent        on its way; `reference` identifies it
 *   too-small   it would cost more to send back than it is worth: kept (rule R4)
 *   not-sent    nothing left the reserve (e.g. no quote now): safe to try again later
 *   manual      it can't be sent automatically: an operator must
 * A thrown error means the outcome is unknown: an operator must check (rule R3).
 */
export type RefundOutcome =
  | { kind: 'sent'; reference: string }
  | { kind: 'too-small'; reason: string }
  | { kind: 'not-sent'; reason: string }
  | { kind: 'manual'; reason: string };

export interface RefundSender {
  readonly name: string;
  send(refund: RefundReturn): Promise<RefundOutcome>;
}

/** Injection token of the RefundSender. */
export const REFUND_SENDER = Symbol('REFUND_SENDER');
