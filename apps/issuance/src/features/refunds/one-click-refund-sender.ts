import { type OneClickClient, OneClickError } from '../payments/one-click.client.ts';
import { type ReserveAccount, signReservePayment, submitReservePayment } from '../reserve/reserve-payment.ts';
import type { Reserve, SignedNep413 } from '../reserve/reserve.port.ts';
import type { RefundOutcome, RefundReturn, RefundSender } from './refund-sender.port.ts';

/** How 1Click says an amount can't pay for its own transfer ("Amount is too low…", "…at least…"). */
const TOO_SMALL = /too low|too small|at least|minimum/i;
/** How long the return quote stays valid: the reserve pays it straight away. */
const QUOTE_MINUTES = 30;

type QuoteAnswer = { quote?: { depositAddress?: string; amountOut?: string } };

/**
 * Sends a refund from the reserve back to the customer through 1Click: a
 * quote from FAR (depositType CONFIDENTIAL_INTENTS) to the sender on the
 * origin chain (recipientType DESTINATION_CHAIN), the same asset in and out.
 * EXACT_INPUT: the whole refund goes in, the network fee comes off what
 * arrives. If 1Click refuses the amount as too low, or nothing would arrive,
 * the refund is too small to send back (rule R4).
 *
 * The reserve pays the quote as it funds cards (reserve/reserve-payment.ts):
 * 1Click prepares the transfer intent, the reserve checks and signs it, and
 * 1Click submits it.
 *
 * NOT TESTED against FAR with real money yet.
 */
export class OneClickRefundSender implements RefundSender {
  readonly name = '1Click from the FAR reserve';
  private readonly client: OneClickClient;
  private readonly reserve: Reserve;
  private readonly account: ReserveAccount;

  constructor(client: OneClickClient, reserve: Reserve, account: ReserveAccount) {
    this.client = client;
    this.reserve = reserve;
    this.account = account;
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
        depositType: 'CONFIDENTIAL_INTENTS',
        destinationAsset: refund.asset,
        amount: refund.amount.toString(),
        recipient: refund.recipient,
        recipientType: 'DESTINATION_CHAIN',
        // If this return fails too, the money comes back to the reserve.
        refundTo: this.account.reserveAccountId,
        refundType: 'CONFIDENTIAL_INTENTS',
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

    // 2. The transfer intent, checked and signed by the reserve. Still nothing has moved.
    let signed: SignedNep413;
    try {
      signed = await signReservePayment(this.client, this.reserve, this.account, {
        depositAddress: quote.depositAddress,
        tokenId: refund.asset,
        amount: refund.amount,
      });
    } catch (error) {
      return { kind: 'not-sent', reason: errorText(error) };
    }

    // 3. Submitted: from here the money may move, so an error is not caught
    //    (its outcome is unknown, and the refunds service stops for an operator).
    const intentHash = await submitReservePayment(this.client, signed);
    return { kind: 'sent', reference: intentHash };
  }
}

function errorText(error: unknown): string {
  return error instanceof OneClickError ? error.apiMessage : error instanceof Error ? error.message : String(error);
}
