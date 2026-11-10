import { CardError, CardState, NearCashCard, cardStateName } from '@nearcash/core';
import type { Cassette } from './hardware.ports.ts';
import type { PcscReaders } from './pcsc-readers.ts';

/**
 * The cassette with a real NFC reader: the blank card the pusher slid onto
 * the reader (or, until the pusher is wired, the card an operator put there).
 *
 * The ATM is available only when that card is a blank NearCash banknote
 * (the applet answers and the card is EMPTY): it never takes a payment it
 * can't turn into a banknote. Asked before every sale and by the screen, so
 * a card that was just written (ISSUED) puts the ATM out of service until
 * it is taken away and a blank one takes its place.
 */
export class PcscCassette implements Cassette {
  readonly name: string;
  readonly dummy = false;
  private readonly readers: PcscReaders;

  constructor(readers: PcscReaders, readerName: string | undefined) {
    this.readers = readers;
    this.name = readerName ? `PC/SC NFC reader "${readerName}"` : 'PC/SC NFC reader';
  }

  async unavailableReason(): Promise<string | null> {
    const choice = this.readers.choose();
    if (!choice.ok) return choice.reason;
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
    return null;
  }

  async nextBlankCard(): Promise<NearCashCard> {
    const reason = await this.unavailableReason();
    if (reason) throw new Error(reason);
    // Bound to this card: if it leaves the reader, the sale fails instead of
    // writing to whatever card is put there next.
    return new NearCashCard(this.readers.transportToCurrentCard());
  }
}
