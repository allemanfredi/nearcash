import { OneClickClient, type OneClickConnection } from './one-click.client.ts';
import type { PaymentDetails, PaymentGateway, PaymentQuote, PaymentStatus, QuoteRequest } from './payment-gateway.port.ts';

/**
 * The real 1Click API (docs.near-intents.org, 1Click API).
 *
 * Deposits into FAR use `recipientType: "CONFIDENTIAL_INTENTS"` (checked
 * against the live API: it lists DESTINATION_CHAIN, INTENTS,
 * CONFIDENTIAL_INTENTS). Confidential quotes are invite-only: they require
 * a partner key from the Defuse team, sent as X-API-Key; without it the API
 * answers "User authentication is required for confidential intent quotes".
 *
 * Refunds: 1Click wants the refund address when the quote is made, before
 * anyone has paid. If the customer gave one, refunds go there on the origin
 * chain (ORIGIN_CHAIN). Otherwise they go into the reserve, the same kind of
 * account as the recipient, and the refunds feature sends them back to the
 * address the payment came from.
 */
export class OneClickGateway implements PaymentGateway {
  readonly name = '1Click';
  readonly simulated = false;
  private readonly client: OneClickClient;
  private readonly recipientType: string;
  private readonly slippageBasisPoints: number;

  constructor(options: OneClickConnection & { recipientType?: string; slippageBasisPoints?: number }) {
    this.client = new OneClickClient(options);
    this.recipientType = options.recipientType ?? 'CONFIDENTIAL_INTENTS';
    this.slippageBasisPoints = options.slippageBasisPoints ?? 100;
  }

  async createQuote(request: QuoteRequest): Promise<PaymentQuote> {
    const quote = await this.quote(request, false);
    if (!quote.depositAddress) throw new Error('1Click quote without deposit address');
    return { ...quote, depositAddress: quote.depositAddress };
  }

  /**
   * A dry-run quote: checks route, price and permissions without creating a
   * deposit address (used by `pnpm issuance:check`).
   */
  async checkQuote(request: QuoteRequest): Promise<{ amountIn: string }> {
    return this.quote(request, true);
  }

  private async quote(request: QuoteRequest, dry: boolean): Promise<Omit<PaymentQuote, 'depositAddress'> & { depositAddress?: string }> {
    const refund =
      request.refund.kind === 'customer'
        ? { refundTo: request.refund.address, refundType: 'ORIGIN_CHAIN' }
        : { refundTo: request.recipient, refundType: this.recipientType };
    const body = {
      dry,
      // customer: the reserve receives exactly the banknote's value; the
      //   customer is asked for it plus the conversion and the margin.
      // bank: the customer sends exactly the banknote's value; the margin
      //   caps what the reserve can lose on the conversion (a bigger price
      //   move fails the swap, and 1Click refunds the customer).
      swapType: request.conversionPaidBy === 'bank' ? 'EXACT_INPUT' : 'EXACT_OUTPUT',
      slippageTolerance: this.slippageBasisPoints,
      originAsset: request.originAsset,
      depositType: 'ORIGIN_CHAIN',
      destinationAsset: request.destinationAsset,
      amount: request.amount.toString(),
      // A refund never goes to a card: to the customer, or to the reserve.
      ...refund,
      recipient: request.recipient,
      recipientType: this.recipientType,
      deadline: request.deadline.toISOString(),
    };
    const json = await this.client.call<{ quote?: { depositAddress?: string; amountIn?: string } }>(
      'POST',
      '/v0/quote',
      body,
    );
    const quote = json.quote;
    if (!quote?.amountIn) throw new Error(`unexpected 1Click quote: ${JSON.stringify(json)}`);
    return {
      depositAddress: quote.depositAddress,
      amountIn: quote.amountIn,
      originAsset: request.originAsset,
      // The deadline we asked for, not the quote's `deadline`: that one is
      // when the deposit address stops working (3 days later, seen on
      // 2026-11-10). Ours is when 1Click starts refunding: a deposit not
      // swapped by then came back as QUOTE_EXPIRED right after it.
      deadline: request.deadline.toISOString(),
    };
  }

  async status(depositAddress: string): Promise<PaymentStatus> {
    return (await this.details(depositAddress)).status;
  }

  async details(depositAddress: string): Promise<PaymentDetails> {
    const json = await this.client.call<OneClickStatus>('GET', `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    return paymentDetailsFromStatus(json);
  }
}

/** The part of GET /v0/status the issuance server reads. */
export type OneClickStatus = {
  status?: string;
  swapDetails?: {
    refundedAmount?: string | null;
    originChainTxHashes?: { hash?: string }[];
  };
};

export function paymentDetailsFromStatus(json: OneClickStatus): PaymentDetails {
  const refunded = json.swapDetails?.refundedAmount;
  return {
    status: mapOneClickStatus(json.status ?? ''),
    refundedAmount: refunded && /^[0-9]+$/.test(refunded) ? BigInt(refunded) : 0n,
    depositTransactions: (json.swapDetails?.originChainTxHashes ?? []).flatMap((tx) => (tx.hash ? [tx.hash] : [])),
  };
}

/**
 * 1Click statuses → ours. Anything still in flight (PENDING_DEPOSIT,
 * KNOWN_DEPOSIT_TX, PROCESSING, INCOMPLETE_DEPOSIT…) is PENDING: only an
 * explicit SUCCESS lets a banknote be created.
 */
export function mapOneClickStatus(status: string): PaymentStatus {
  switch (status) {
    case 'SUCCESS':
      return 'SUCCESS';
    case 'REFUNDED':
      return 'REFUNDED';
    case 'FAILED':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}
