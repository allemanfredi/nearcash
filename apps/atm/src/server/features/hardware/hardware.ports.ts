/**
 * The ATM's hardware, as the server sees it:
 *  - the cassette: a stack of BLANK cards in front of an NFC reader. The
 *    server talks to the card at the reader, then the dispenser pushes it out;
 *  - the dispenser: moves the written card to the customer's tray.
 *
 * Until the NFC reader and the cards arrive, the cassette is NoCardReader
 * (the ATM is out of service) and the dispenser only logs. The Raspberry Pi
 * adapters (a PC/SC NFC reader, the dispenser motor on the GPIO pins) come
 * with the hardware.
 */
import type { NearCashCard } from '@nearcash/core';

export interface Cassette {
  readonly name: string;
  /**
   * Why no banknote can be made right now (no reader, no blank cards…), or
   * null when it can. Asked before a sale starts: the ATM never takes a
   * payment it can't turn into a banknote.
   */
  unavailableReason(): Promise<string | null>;
  /** The next blank card, at the reader and ready to talk to. */
  nextBlankCard(): Promise<NearCashCard>;
}

export interface Dispenser {
  readonly name: string;
  /** Pushes the card at the reader out to the tray. */
  dispense(): Promise<void>;
}

/** Injection tokens. */
export const CASSETTE = Symbol('CASSETTE');
export const DISPENSER = Symbol('DISPENSER');
