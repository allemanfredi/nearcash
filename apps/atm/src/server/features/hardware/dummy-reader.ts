import type { NearCashCard } from '@nearcash/core';
import type { Cassette } from './hardware.ports.ts';

/**
 * The cassette with the printed dummy reader in the turret
 * (NEARCASH_CASSETTE=dummy, `pnpm atm:demo --dummy-reader`): the whole sale
 * and the mechanics can be tested before the NFC reader arrives.
 *
 * The dummy holds a card where the reader would, but has no contacts: there
 * is no chip to talk to, so it is always "available" (it can't tell whether
 * a card is there) and the sale issues nothing. Once paid, the card comes out
 * blank and the sale stays PAID at the issuance server (SaleSessionService).
 */
export class DummyReader implements Cassette {
  readonly name = 'dummy reader (printed: cards come out blank)';
  readonly dummy = true;

  async unavailableReason(): Promise<null> {
    return null;
  }

  async nextBlankCard(): Promise<NearCashCard> {
    throw new Error('the dummy reader has no contacts: no card can be written');
  }
}
