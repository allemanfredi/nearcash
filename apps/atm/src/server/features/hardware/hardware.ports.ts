/**
 * The ATM's hardware, as the server sees it:
 *  - the cassette: a stack of BLANK cards in front of an NFC reader. The
 *    server talks to the card at the reader, then the dispenser pushes it out;
 *  - the dispenser: moves the written card to the customer's tray.
 *
 * The cassette is the NFC reader (PcscCassette, NEARCASH_CASSETTE=pcsc), the
 * printed dummy reader (DummyReader, NEARCASH_CASSETTE=dummy: no chip, the
 * card comes out blank), or none at all (NoCardReader: the ATM is out of
 * service). The dispenser is the two servos (ServoDispenser,
 * NEARCASH_DISPENSER=servos), or only logs (SimulatedDispenser).
 */
import type { NearCashCard } from '@nearcash/core';

export interface Cassette {
  readonly name: string;
  /**
   * True for the printed dummy reader: it holds a card but has no contacts,
   * so nothing can be written. The sale then issues nothing and hands the
   * card out blank (SaleSessionService), and nextBlankCard is never asked.
   */
  readonly dummy: boolean;
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
  /** Hands the card out: resolves once the customer can take it. */
  dispense(): Promise<void>;
}

/** Injection tokens. */
export const CASSETTE = Symbol('CASSETTE');
export const DISPENSER = Symbol('DISPENSER');
