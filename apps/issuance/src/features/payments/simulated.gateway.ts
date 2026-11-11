import type { PaymentDetails, PaymentGateway, PaymentQuote, PaymentStatus, QuoteRequest } from './payment-gateway.port.ts';

/** A simulated deposit: its status, and what was refunded to the quote's refund destination. */
type SimulatedDeposit = { amountIn: bigint; status: PaymentStatus; refundedAmount: bigint; transactions: string[] };

/**
 * DEVELOPMENT ONLY: payments settled by hand (the /dev routes of the issuance server),
 * so the whole sale can run without real money, refunds included.
 */
export class SimulatedGateway implements PaymentGateway {
  readonly name = 'simulated payments';
  readonly simulated = true;
  private readonly deposits = new Map<string, SimulatedDeposit>();
  private counter = 0;

  async createQuote(request: QuoteRequest): Promise<PaymentQuote> {
    this.counter += 1;
    const depositAddress = `sim-deposit-${Date.now().toString(36)}-${this.counter}`;
    const amountIn = request.amount; // 1:1, no swap
    this.deposits.set(depositAddress, { amountIn, status: 'PENDING', refundedAmount: 0n, transactions: [] });
    return {
      depositAddress,
      amountIn: amountIn.toString(),
      originAsset: request.originAsset,
      deadline: request.deadline.toISOString(),
    };
  }

  async status(depositAddress: string): Promise<PaymentStatus> {
    return this.deposits.get(depositAddress)?.status ?? 'PENDING';
  }

  async details(depositAddress: string): Promise<PaymentDetails> {
    const deposit = this.deposits.get(depositAddress);
    if (!deposit) return { status: 'PENDING', refundedAmount: 0n, depositTransactions: [] };
    return { status: deposit.status, refundedAmount: deposit.refundedAmount, depositTransactions: [...deposit.transactions] };
  }

  /**
   * Settles a simulated deposit:
   *   SUCCESS   paid; `excess` is what was sent beyond the quote, refunded after the swap
   *   REFUNDED  the swap failed: everything that was sent is refunded
   */
  settle(depositAddress: string, outcome: 'SUCCESS' | 'REFUNDED', excess = 0n): void {
    const deposit = this.deposits.get(depositAddress);
    if (!deposit) throw new Error(`unknown simulated deposit ${depositAddress}`);
    deposit.status = outcome;
    deposit.refundedAmount = outcome === 'REFUNDED' ? deposit.amountIn + excess : excess;
    deposit.transactions = [`sim-tx-${depositAddress}`];
  }
}
