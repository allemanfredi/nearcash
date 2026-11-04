/**
 * Who paid a deposit: the address a refund goes back to (rule R2). Read
 * from the origin chain itself, from the transactions that paid the
 * deposit address.
 */

export type Deposit = {
  /** 1Click asset id that was paid, e.g. "nep141:base-0x833589….omft.near". */
  originAsset: string;
  depositAddress: string;
  /** Hashes of the transactions that paid it, on the origin chain. */
  transactions: string[];
};

export interface SenderFinder {
  readonly name: string;
  /**
   * The one address that paid the deposit, or null when it can't be told
   * for sure (unknown chain, no transaction found, several senders): then
   * an operator decides.
   */
  findSender(deposit: Deposit): Promise<string | null>;
}

/** Injection token of the SenderFinder. */
export const SENDER_FINDER = Symbol('SENDER_FINDER');
