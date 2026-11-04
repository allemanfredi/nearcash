/**
 * The bank's reserve inside FAR: where customers' payments land, and where
 * the issuance server takes the value of each banknote from. Funding a card
 * is a private transfer inside FAR (reserve → the card's own account), so
 * nobody outside FAR can see which payment funded which card.
 */

export type CardFunding = {
  /** The card's account in FAR: the Ethereum address of its key F. */
  cardAccountId: string;
  tokenId: string;
  amount: bigint;
};

/**
 * An intent that 1Click prepared for the reserve to sign (NEP-413: the
 * NEAR message-signing standard): how the reserve pays a 1Click quote from
 * inside FAR, e.g. the quote that sends a refund back to a customer.
 */
export type Nep413Payload = { message: string; nonce: string; recipient: string; callbackUrl?: string | null };

/** The same intent signed by the reserve's key: what 1Click's submit-intent takes. */
export type SignedNep413 = { standard: 'nep413'; payload: Nep413Payload; public_key: string; signature: string };

export interface Reserve {
  readonly name: string;
  /** Moves `amount` to the card's account and resolves once settled; returns a reference. */
  fundCard(funding: CardFunding): Promise<string>;
  /** Signs an intent prepared by 1Click as the reserve's account (it signs exactly the payload given). */
  signIntent(payload: Nep413Payload): Promise<SignedNep413>;
}

/** Injection token of the Reserve. */
export const RESERVE = Symbol('RESERVE');
