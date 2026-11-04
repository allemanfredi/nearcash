/**
 * What the refunds feature remembers: per sale, each refund the reserve
 * received and what became of it. Kept apart from the sale records, so the
 * sales and the refunds never overwrite each other's data.
 */

/**
 *   sending          the return was started: still "sending" after a restart
 *                    means its outcome is unknown, and an operator must check
 *   sent             handed to 1Click, on its way back to the sender
 *   kept             too small to cover the cost of sending it back (rule R4)
 *   needs-operator   it can't be sent automatically (see `note`)
 */
export type ReturnState = 'sending' | 'sent' | 'kept' | 'needs-operator';

export type ReturnedRefund = {
  /** Smallest unit of the sale's origin asset. */
  amount: string;
  state: ReturnState;
  /** The address the payment came from, where the refund goes. */
  sender?: string;
  /** Reference of the return (the 1Click intent hash). */
  reference?: string;
  note?: string;
  /** ISO time of the last change. */
  at: string;
};

export type SaleRefunds = { saleId: string; refunds: ReturnedRefund[] };
