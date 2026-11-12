import { CardError, CardState, NearCashCard, cardStateName } from '@nearcash/core';
import type { Cassette } from './hardware.ports.ts';
import type { PcscReaders } from './pcsc-readers.ts';

/**
 * The cassette with a real NFC reader in the turret, the hopper of blank
 * cards behind it.
 *
 * With the servos (`load` given), the reader is empty between sales: once a
 * sale is paid, nextBlankCard() has the pusher put the bottom card of the
 * hopper into the reader, waits for the reader to see it, and checks it.
 * Without them, an operator puts the card on the reader by hand, before the
 * sale.
 *
 * A card can become a banknote only when it is a blank NearCash card: the
 * applet answers (its contacts touch the chip), the card is EMPTY and, unless
 * a demo skips it, has a birth certificate (docs/protocol.md §5.8). Asked
 * before every sale and by the screen: a card left in the reader that isn't
 * one (a sale that failed, a banknote not taken) puts the ATM out of service
 * until it is taken out; a blank one left there is used by the next sale.
 * A loaded card that isn't one is found only after the payment: the sale
 * fails, for the operator to refund.
 */
export class PcscCassette implements Cassette {
  readonly name: string;
  readonly dummy = false;
  private readonly readers: PcscReaders;
  /** A blank card must have a birth certificate (false only for demos: NEARCASH_SKIP_BIRTH). */
  private readonly requireBirth: boolean;
  /** The servos' load (the pusher puts the next card into the reader); undefined: an operator does it. */
  private readonly load: (() => Promise<void>) | undefined;
  /** After a load, how long the reader has to see the card (and, if needed, to power it again). */
  private readonly arrivalMs: number;

  constructor(
    readers: PcscReaders,
    readerName: string | undefined,
    requireBirth = true,
    load?: () => Promise<void>,
    arrivalMs = CARD_ARRIVAL_MS,
  ) {
    this.readers = readers;
    this.requireBirth = requireBirth;
    this.load = load;
    this.arrivalMs = arrivalMs;
    this.name = readerName ? `PC/SC NFC reader "${readerName}"` : 'PC/SC NFC reader';
  }

  async unavailableReason(): Promise<string | null> {
    const choice = this.readers.choose();
    if (!choice.ok) return choice.reason;
    // With the servos an empty reader is how it should be: the card is loaded once paid.
    if (this.load && !choice.cardPresent && !choice.cardMute) return null;
    return this.problemWithCard();
  }

  async nextBlankCard(): Promise<NearCashCard> {
    const choice = this.readers.choose();
    if (this.load && choice.ok && !choice.cardPresent && !choice.cardMute) await this.loadCard();
    const problem = await this.problemWithCard();
    if (problem) throw new Error(problem);
    // Bound to this card: if it leaves the reader, the sale fails instead of
    // writing to whatever card is put there next.
    return new NearCashCard(this.readers.transportToCurrentCard());
  }

  /**
   * The pusher puts the next card into the reader. Then waits for the reader
   * to see it; a card PC/SC marked MUTE (powered while still on its way in)
   * is powered again where it is now (PcscReaders.wakeCard).
   */
  private async loadCard(): Promise<void> {
    await this.load!();
    const arrived = await waitFor(() => {
      const choice = this.readers.choose();
      return choice.ok && (choice.cardPresent || choice.cardMute);
    }, this.arrivalMs);
    if (!arrived) throw new Error('no card reached the NFC reader after the pusher\'s stroke: is the hopper empty?');
    const choice = this.readers.choose();
    if (choice.ok && choice.cardMute) {
      await this.readers.wakeCard().catch(() => {}); // still mute: problemWithCard() says so
      await waitFor(() => {
        const now = this.readers.choose();
        return now.ok && now.cardPresent;
      }, this.arrivalMs);
    }
  }

  /** Why the card in the reader can't become a banknote (none there, not blank…), or null when it can. */
  private async problemWithCard(): Promise<string | null> {
    const choice = this.readers.choose();
    if (!choice.ok) return choice.reason;
    if (choice.cardMute) {
      return `a card is in the NFC reader (${choice.name}) but does not answer: its contacts don't reach the chip (it stopped short?). Take it out`;
    }
    if (!choice.cardPresent) return `no blank card at the NFC reader (${choice.name})`;
    if (choice.heldElsewhere) return `another program holds the card at the reader (${choice.name})`;

    // SELECT + INFO: harmless for a card in the middle of a sale (each
    // applet command stands on its own, and the reader sends one APDU at a time).
    const card = new NearCashCard(this.readers.transportToCurrentCard());
    try {
      await card.select();
    } catch (error) {
      return error instanceof CardError
        ? `the card at the reader is not a NearCash banknote (SELECT: ${error.message})`
        : `the card at the reader does not answer (${error instanceof Error ? error.message : String(error)})`;
    }
    const info = await card.info();
    if (info.state !== CardState.EMPTY) {
      return `the card at the reader is not blank (it is ${cardStateName(info.state)}): take it away and put a blank one`;
    }
    // The issuance server refuses a card the bank did not make: refuse it
    // here, before the customer pays (the issuance server checks the signatures).
    if (this.requireBirth && !(await card.readBirth())) {
      return 'the blank card at the reader has no birth certificate: give it one first (pnpm card:birth)';
    }
    return null;
  }
}

/** After a load: the reader sees the card in well under a second; 3 s leaves room for PC/SC to power it. */
const CARD_ARRIVAL_MS = 3_000;

/** Checks `condition` every 50 ms, up to `ms`: true as soon as it holds, false if it never did. */
async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  for (let waited = 0; ; waited += 50) {
    if (condition()) return true;
    if (waited >= ms) return false;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
