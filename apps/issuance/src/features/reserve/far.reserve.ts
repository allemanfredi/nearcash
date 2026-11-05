import type { OneClickClient } from '../payments/one-click.client.ts';
import { type OneClickStatus, mapOneClickStatus } from '../payments/one-click.gateway.ts';
import { type FarAccount, ReserveKey } from './reserve-key.ts';
import { signReservePayment, submitReservePayment } from './reserve-payment.ts';
import type { CardFunding, Nep413Payload, Reserve, SignedNep413 } from './reserve.port.ts';

/** How long a funding quote stays valid: the reserve pays it straight away. */
const QUOTE_MINUTES = 30;

type QuoteAnswer = { quote?: { depositAddress?: string; amountOut?: string; minAmountOut?: string } };

/** 1Click gave a final answer other than SUCCESS (refunded, failed): no point asking again. */
class TransferNotSettled extends Error {}

/**
 * The reserve inside FAR (NEAR Confidential Intents): every payment lands in
 * its account, and it sends the value of each banknote to the card's own
 * account, with a transfer from FAR to FAR made through 1Click:
 *
 *   1. quote     FAR → FAR, the same token, the card as recipient; it must
 *                deliver the whole amount (no fee), or the card is not funded;
 *   2. intent    1Click prepares the transfer, the reserve checks and signs it;
 *   3. submit    1Click executes it;
 *   4. settled   1Click reports SUCCESS.
 *
 * Nothing moves before step 3. Only the partner key is needed (FAR's own
 * relay is invite-only). Inside FAR tokens are held as IMT ids
 * ("imt:<treasury>:<asset id>"); 1Click names them by the asset id.
 */
export class FarReserve implements Reserve {
  readonly name = 'FAR reserve (transfers through 1Click)';
  private readonly key: ReserveKey;
  private readonly account: FarAccount;
  private readonly client: OneClickClient;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(account: FarAccount, client: OneClickClient, timing: { pollMs?: number; timeoutMs?: number } = {}) {
    this.key = new ReserveKey(account);
    this.account = account;
    this.client = client;
    this.pollMs = timing.pollMs ?? 2_000;
    this.timeoutMs = timing.timeoutMs ?? 120_000;
  }

  async fundCard(funding: CardFunding): Promise<string> {
    // 1. The quote.
    const { quote } = await this.client.call<QuoteAnswer>('POST', '/v0/quote', this.cardQuote(funding, false));
    if (!quote?.depositAddress) throw new Error('1Click quote without a deposit address');
    // The certificate says the card holds the whole amount: refuse any fee.
    if (quote.minAmountOut !== funding.amount.toString()) {
      throw new Error(`1Click would deliver at least ${quote.minAmountOut} of ${funding.amount} to the card: not funded`);
    }

    // 2–3. The transfer intent, checked, signed and submitted.
    const signed = await signReservePayment(this.client, this, this.account, {
      depositAddress: quote.depositAddress,
      tokenId: funding.tokenId,
      amount: funding.amount,
    });
    const intentHash = await submitReservePayment(this.client, signed);

    // 4. Settled.
    await this.waitUntilSettled(quote.depositAddress);
    return intentHash;
  }

  async signIntent(payload: Nep413Payload): Promise<SignedNep413> {
    return this.key.sign(payload);
  }

  /**
   * For `pnpm issuance:check`: a dry-run quote of a transfer to a card,
   * without moving anything. Resolves if it would deliver the whole amount.
   */
  async checkCardTransfer(tokenId: string, amount: bigint): Promise<void> {
    // A placeholder card account (an Ethereum address, as every card's is).
    const funding = { cardAccountId: '0x1111111111111111111111111111111111111111', tokenId, amount };
    const { quote } = await this.client.call<QuoteAnswer>('POST', '/v0/quote', this.cardQuote(funding, true));
    if (quote?.minAmountOut !== amount.toString()) throw new Error(`a card would receive at least ${quote?.minAmountOut} of ${amount}`);
  }

  /** FAR → FAR, the same token: from the reserve to the card; if it fails, back to the reserve. */
  private cardQuote(funding: CardFunding, dry: boolean) {
    return {
      dry,
      swapType: 'EXACT_INPUT',
      slippageTolerance: 0,
      originAsset: funding.tokenId,
      depositType: 'CONFIDENTIAL_INTENTS',
      destinationAsset: funding.tokenId,
      amount: funding.amount.toString(),
      recipient: funding.cardAccountId,
      recipientType: 'CONFIDENTIAL_INTENTS',
      refundTo: this.account.reserveAccountId,
      refundType: 'CONFIDENTIAL_INTENTS',
      deadline: new Date(Date.now() + QUOTE_MINUTES * 60_000).toISOString(),
    };
  }

  /**
   * Waits for 1Click to report the transfer done. The intent is already
   * submitted, so a failed status request is retried until the timeout; any
   * other outcome throws, and the sale waits for an operator (rule 4 of the
   * sales service: a card is never funded twice).
   */
  private async waitUntilSettled(depositAddress: string): Promise<void> {
    const giveUpAt = Date.now() + this.timeoutMs;
    let last = 'no answer yet';
    for (;;) {
      try {
        const { status } = await this.client.call<OneClickStatus>('GET', `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
        last = status ?? 'no status';
        const mapped = mapOneClickStatus(last);
        if (mapped === 'SUCCESS') return;
        if (mapped !== 'PENDING') throw new TransferNotSettled(`1Click reports ${last} for the transfer to the card (deposit ${depositAddress})`);
      } catch (error) {
        if (error instanceof TransferNotSettled) throw error;
        last = error instanceof Error ? error.message : String(error); // the status request failed: ask again
      }
      if (Date.now() >= giveUpAt) {
        throw new Error(`the transfer to the card is not settled after ${this.timeoutMs / 1000} s (last: ${last}; deposit ${depositAddress})`);
      }
      await new Promise((resolve) => setTimeout(resolve, this.pollMs));
    }
  }
}
