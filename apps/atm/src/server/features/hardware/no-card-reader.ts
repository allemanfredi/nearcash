import type { NearCashCard } from '@nearcash/core';
import type { Cassette } from './hardware.ports.ts';

/**
 * The cassette when the ATM has no NFC reader (NEARCASH_CASSETTE=none): it
 * has no blank card to give, and says so, so the ATM shows "out of service"
 * instead of taking a payment it can't turn into a banknote.
 */
export class NoCardReader implements Cassette {
  readonly name = 'no card reader connected';
  readonly dummy = false;
  private static readonly REASON = 'no card reader is connected: no banknote can be made';

  async unavailableReason(): Promise<string> {
    return NoCardReader.REASON;
  }

  async nextBlankCard(): Promise<NearCashCard> {
    throw new Error(NoCardReader.REASON);
  }
}
