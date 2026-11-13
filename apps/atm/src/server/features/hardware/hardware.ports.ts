/**
 * The ATM's hardware, as the server sees it:
 *  - the cassette: a stack of BLANK cards (the hopper) in front of an NFC
 *    reader. Once a sale is paid, the next card goes into the reader and the
 *    server talks to it;
 *  - the dispenser: the servos. It loads the next card into the reader (the
 *    pusher), and hands the written card out (the turret).
 *
 * The cassette is the NFC reader (PcscCassette, NEARCASH_CASSETTE=pcsc), the
 * printed dummy reader (DummyReader, NEARCASH_CASSETTE=dummy: no chip, the
 * card comes out blank), or none at all (NoCardReader: the ATM is out of
 * service). The dispenser is the two servos (ServoDispenser,
 * NEARCASH_DISPENSER=servos), or only logs (SimulatedDispenser). For
 * development (`pnpm local`), both can be the card emulator, the real applet
 * in jCardSim (EmulatedCassette, EmulatedDispenser: card-emulator.ts).
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
   * Why no banknote can be made right now (no reader, a card left in it…), or
   * null when it can. Asked before a sale starts, so the ATM doesn't take a
   * payment it already knows it can't turn into a banknote.
   */
  unavailableReason(): Promise<string | null>;
  /**
   * The next blank card, at the reader and ready to talk to: loaded from the
   * hopper first when the reader is empty and the servos can load one.
   */
  nextBlankCard(): Promise<NearCashCard>;
}

export interface Dispenser {
  readonly name: string;
  /** True when load() really brings a card (the servos); false: an operator puts it on the reader. */
  readonly loadsCards: boolean;
  /**
   * Loads the next card: the pusher puts the bottom card of the hopper into
   * the reader and comes home. Resolves once it has; whether a card did
   * arrive, the reader tells.
   */
  load(): Promise<void>;
  /** Hands out the card in the reader: resolves once the customer can take it. */
  dispense(): Promise<void>;
}

/** Injection tokens. */
export const CASSETTE = Symbol('CASSETTE');
export const DISPENSER = Symbol('DISPENSER');
