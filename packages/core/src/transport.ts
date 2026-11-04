/**
 * How bytes reach a card.
 *
 * The protocol code (card.ts) only needs "send this APDU, give me the
 * answer". Each environment provides that differently:
 *  - the iOS wallet app: Core NFC (in Swift, ios/NearCashWallet/Card);
 *  - the ATM: the NFC reader on the Raspberry Pi (to be written once the
 *    reader and the cards are here).
 */

export interface CardTransport {
  /**
   * Sends one command APDU and resolves with the full response:
   * response data followed by the two status bytes SW1 SW2.
   */
  transmit(command: Uint8Array): Promise<Uint8Array>;
}
