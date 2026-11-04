import type { RefundOutcome, RefundReturn, RefundSender } from './refund-sender.port.ts';

/**
 * DEVELOPMENT ONLY: pretends to send refunds back. A refund no larger than
 * `networkFee` (smallest unit) is "too small", like a real one that couldn't
 * pay for its own transfer.
 */
export class SimulatedRefundSender implements RefundSender {
  readonly name = 'simulated refunds';
  /** What was "sent", for tests and logs. */
  readonly sent: RefundReturn[] = [];
  private readonly networkFee: bigint;

  constructor(networkFee: bigint) {
    this.networkFee = networkFee;
  }

  async send(refund: RefundReturn): Promise<RefundOutcome> {
    if (refund.amount <= this.networkFee) {
      return { kind: 'too-small', reason: `no more than the simulated network fee (${this.networkFee})` };
    }
    this.sent.push(refund);
    return { kind: 'sent', reference: `sim-refund-${this.sent.length}` };
  }
}
