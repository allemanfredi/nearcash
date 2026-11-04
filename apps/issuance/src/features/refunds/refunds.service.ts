/**
 * Sending refunds back to the address the payment came from.
 *
 * When the customer gave no refund address, 1Click refunds into the bank's
 * reserve: a failed swap, a payment after the deadline, or what was paid
 * beyond the quote. The reserve sends it back. Rules, each enforced here and
 * covered by test/refunds.service.test.ts:
 *  R1. Only sales without the customer's own refund address: those are
 *      refunded by 1Click directly, the bank never touches them.
 *  R2. A refund goes back only to the address that paid, on the chain it
 *      came from, in the asset that was paid. When that address can't be
 *      told for sure, an operator decides.
 *  R3. Each refund is sent at most once: the attempt is recorded before it
 *      starts, and one whose outcome is unknown (an error while sending, a
 *      restart) stops that sale's refunds until an operator has checked.
 *  R4. A refund too small to cover the cost of sending it back is kept by
 *      the bank, and recorded as kept.
 * A sale is watched until `watchHours` after its deadline: 1Click refunds
 * after the deadline, and a late payment can arrive any time.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock.ts';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway.port.ts';
import type { SaleRecord } from '../sales/sale-record.ts';
import { SALE_REPOSITORY, type SaleRepository } from '../sales/sale-repository.port.ts';
import type { ReturnedRefund } from './refund-record.ts';
import { REFUND_REPOSITORY, type RefundRepository } from './refund-repository.port.ts';
import { REFUND_SENDER, type RefundOutcome, type RefundSender } from './refund-sender.port.ts';
import { SENDER_FINDER, type SenderFinder } from './sender-finder.port.ts';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger('Refunds');
  /** True while a sweep runs: sweeps never overlap (rule R3 relies on it). */
  private sweeping = false;

  constructor(
    @Inject(SALE_REPOSITORY) private readonly sales: SaleRepository,
    @Inject(REFUND_REPOSITORY) private readonly refunds: RefundRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(SENDER_FINDER) private readonly senders: SenderFinder,
    @Inject(REFUND_SENDER) private readonly refundSender: RefundSender,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ISSUANCE_CONFIG) private readonly config: Pick<IssuanceConfig, 'refunds'>,
  ) {}

  /** One pass over the watched sales. A problem with one sale never stops the others. */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      for (const sale of this.sales.list()) {
        if (!this.watched(sale)) continue;
        try {
          await this.checkSale(sale);
        } catch (error) {
          // Reading the payment or the chain failed: nothing was sent, try again next sweep.
          this.logger.warn(`sale ${sale.id}: refunds not checked (${message(error)})`);
        }
      }
    } finally {
      this.sweeping = false;
    }
  }

  /** The refunds recorded for a sale. */
  refundsOf(saleId: string): ReturnedRefund[] {
    return this.refunds.get(saleId);
  }

  private watched(sale: SaleRecord): boolean {
    if (sale.refundTo) return false; // R1
    const until = new Date(sale.deadline).getTime() + this.config.refunds.watchHours * 3_600_000;
    return this.clock.now().getTime() <= until;
  }

  private async checkSale(sale: SaleRecord): Promise<void> {
    const refunds = this.refunds.get(sale.id);

    // R3: an attempt still "sending" here was cut short (the server stopped): outcome unknown.
    const interrupted = refunds.find((refund) => refund.state === 'sending');
    if (interrupted) {
      this.update(sale.id, refunds, interrupted, {
        state: 'needs-operator',
        note: 'interrupted while sending: check the reserve before sending it again',
      });
      this.operator(sale.id, `a refund of ${interrupted.amount} was interrupted while sending`);
      return;
    }
    if (refunds.some((refund) => refund.state === 'needs-operator')) return; // waiting for an operator

    // What 1Click refunded to the reserve so far, minus what was already handled.
    const payment = await this.gateway.details(sale.depositAddress);
    const handled = refunds.reduce((sum, refund) => sum + BigInt(refund.amount), 0n);
    const pending = payment.refundedAmount - handled;
    if (pending <= 0n) return;

    // R2: back to the address that paid, or to an operator.
    const sender = await this.senders.findSender({
      originAsset: sale.originAsset,
      depositAddress: sale.depositAddress,
      transactions: payment.depositTransactions,
    });
    if (!sender) {
      this.refunds.put(sale.id, [
        ...refunds,
        { amount: pending.toString(), state: 'needs-operator', note: 'the sending address could not be determined', at: this.now() },
      ]);
      this.operator(sale.id, `a refund of ${pending} came in, but who paid can't be told for sure`);
      return;
    }

    // R3: record the attempt before making it.
    const attempt: ReturnedRefund = { amount: pending.toString(), state: 'sending', sender, at: this.now() };
    this.refunds.put(sale.id, [...refunds, attempt]);

    let outcome: RefundOutcome;
    try {
      outcome = await this.refundSender.send({ asset: sale.originAsset, amount: pending, recipient: sender });
    } catch (error) {
      outcome = { kind: 'manual', reason: `outcome unknown (${message(error)}): check before sending it again` };
    }

    switch (outcome.kind) {
      case 'sent':
        this.update(sale.id, refunds, attempt, { state: 'sent', reference: outcome.reference });
        this.logger.log(`sale ${sale.id}: refund of ${pending} sent back to ${sender} (${outcome.reference})`);
        break;
      case 'too-small': // R4
        this.update(sale.id, refunds, attempt, { state: 'kept', note: outcome.reason });
        this.logger.log(`sale ${sale.id}: refund of ${pending} kept, too small to send back (${outcome.reason})`);
        break;
      case 'not-sent':
        // Nothing left the reserve: forget the attempt, the next sweep tries again.
        this.refunds.put(sale.id, refunds);
        this.logger.warn(`sale ${sale.id}: refund of ${pending} not sent yet (${outcome.reason}), retrying later`);
        break;
      case 'manual':
        this.update(sale.id, refunds, attempt, { state: 'needs-operator', note: outcome.reason });
        this.operator(sale.id, `a refund of ${pending} to ${sender} must be sent by hand: ${outcome.reason}`);
        break;
    }
  }

  /**
   * Saves the sale's refunds with `refund` changed: in its place when it is
   * one of `refunds`, at the end when it is the new attempt.
   */
  private update(saleId: string, refunds: ReturnedRefund[], refund: ReturnedRefund, change: Partial<ReturnedRefund>): void {
    const updated = { ...refund, ...change, at: this.now() };
    const list = refunds.includes(refund)
      ? refunds.map((candidate) => (candidate === refund ? updated : candidate))
      : [...refunds, updated];
    this.refunds.put(saleId, list);
  }

  private operator(saleId: string, text: string): void {
    this.logger.warn(`OPERATOR: sale ${saleId}: ${text}`);
  }

  private now(): string {
    return this.clock.now().toISOString();
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
