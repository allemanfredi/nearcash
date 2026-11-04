import type { RefundOutcome, RefundSender } from './refund-sender.port.ts';

/**
 * When refunds can't be sent automatically (real payments, but the reserve
 * isn't in FAR, so nothing can sign for it): every refund goes to an operator.
 */
export class ManualRefundSender implements RefundSender {
  readonly name = 'operator (by hand)';
  private readonly reason: string;

  constructor(reason: string) {
    this.reason = reason;
  }

  async send(): Promise<RefundOutcome> {
    return { kind: 'manual', reason: this.reason };
  }
}
