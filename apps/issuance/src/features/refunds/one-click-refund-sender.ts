import { type OneClickClient, OneClickError } from '../payments/one-click.client.ts';
import type { Nep413Payload, Reserve } from '../reserve/reserve.port.ts';
import type { RefundOutcome, RefundReturn, RefundSender } from './refund-sender.port.ts';

/** How 1Click says an amount can't pay for its own transfer ("Amount is too low…", "…at least…"). */
const TOO_SMALL = /too low|too small|at least|minimum/i;
/** How long the return quote stays valid: the reserve pays it straight away. */
const QUOTE_MINUTES = 30;

type QuoteAnswer = { quote?: { depositAddress?: string; amountOut?: string } };
type GeneratedIntent = { intent?: { standard?: string; payload?: Nep413Payload } };

/**
 * Sends a refund from the reserve back to the customer through 1Click: a
 * quote from FAR (depositType CONFIDENTIAL_INTENTS) to the sender on the
 * origin chain (recipientType DESTINATION_CHAIN), the same asset in and out.
 * EXACT_INPUT: the whole refund goes in, the network fee comes off what
 * arrives. If 1Click refuses the amount as too low, or nothing would arrive,
 * the refund is too small to send back (rule R4).
 *
 * FAR takes no direct token transfers: the reserve pays the quote with a
 * transfer intent that 1Click prepares (generate-intent), the reserve signs
 * (NEP-413) and 1Click submits (submit-intent).
 *
 * NOT TESTED against FAR yet: confidential quotes need the partner key.
 */
export class OneClickRefundSender implements RefundSender {
  readonly name = '1Click from the FAR reserve';
  private readonly client: OneClickClient;
  private readonly reserve: Reserve;
  private readonly reserveAccountId: string;
  /** The kind of account the reserve is: CONFIDENTIAL_INTENTS for FAR. */
  private readonly reserveAccountType: string;

  constructor(client: OneClickClient, reserve: Reserve, reserveAccountId: string, reserveAccountType = 'CONFIDENTIAL_INTENTS') {
    this.client = client;
    this.reserve = reserve;
    this.reserveAccountId = reserveAccountId;
    this.reserveAccountType = reserveAccountType;
  }

  async send(refund: RefundReturn): Promise<RefundOutcome> {
    // 1. The quote. Nothing has moved yet: any failure can be retried later.
    let quote: QuoteAnswer['quote'];
    try {
      ({ quote } = await this.client.call<QuoteAnswer>('POST', '/v0/quote', {
        dry: false,
        swapType: 'EXACT_INPUT',
        slippageTolerance: 100,
        originAsset: refund.asset,
        depositType: this.reserveAccountType,
        destinationAsset: refund.asset,
        amount: refund.amount.toString(),
        recipient: refund.recipient,
        recipientType: 'DESTINATION_CHAIN',
        // If this return fails too, the money comes back to the reserve.
        refundTo: this.reserveAccountId,
        refundType: this.reserveAccountType,
        deadline: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
      }));
    } catch (error) {
      if (error instanceof OneClickError && error.status === 400 && TOO_SMALL.test(error.apiMessage)) {
        return { kind: 'too-small', reason: error.apiMessage };
      }
      return { kind: 'not-sent', reason: errorText(error) };
    }
    if (!quote?.depositAddress) return { kind: 'not-sent', reason: '1Click quote without a deposit address' };
    if (!quote.amountOut || !/^[0-9]+$/.test(quote.amountOut) || BigInt(quote.amountOut) === 0n) {
      return { kind: 'too-small', reason: 'nothing would arrive after the network fee' };
    }

    // 2. The transfer intent, signed by the reserve. Still nothing has moved.
    let signed;
    try {
      const { intent } = await this.client.call<GeneratedIntent>('POST', '/v0/generate-intent', {
        type: 'swap_transfer',
        standard: 'nep413',
        signerId: this.reserveAccountId,
        depositAddress: quote.depositAddress,
      });
      if (intent?.standard !== 'nep413' || !intent.payload) throw new Error('1Click did not prepare a NEP-413 intent');
      signed = await this.reserve.signIntent(intent.payload);
    } catch (error) {
      return { kind: 'not-sent', reason: errorText(error) };
    }

    // 3. Submitted: from here the money may move, so an error is not caught
    //    (its outcome is unknown, and the refunds service stops for an operator).
    const { intentHash } = await this.client.call<{ intentHash: string }>('POST', '/v0/submit-intent', {
      type: 'swap_transfer',
      signedData: signed,
    });
    return { kind: 'sent', reference: intentHash };
  }
}

function errorText(error: unknown): string {
  return error instanceof OneClickError ? error.apiMessage : error instanceof Error ? error.message : String(error);
}
