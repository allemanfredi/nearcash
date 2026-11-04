/**
 * Issuance (docs/protocol.md §9): how a blank card becomes a banknote.
 *
 *   prepareCard()        ATM:  the card creates A and F; we learn its account
 *   …the issuance server funds that account inside FAR and has MPC sign the certificate…
 *   writeCertificate()   ATM:  store the certificate, set the holder's PIN,
 *                              then check the card exactly as a receiver would
 *
 * The ATM never signs anything: see sale.ts for the whole sale.
 * personalizeCard() does both halves in one place, for tests and dev tools.
 */
import type { CardKeys, NearCashCard } from './card.ts';
import { type Certificate, decodeCertificate, issueCertificate, issueDay } from './certificate.ts';
import { ethereumAddress } from './eth.ts';
import { CardState, cardStateName } from './protocol.ts';
import type { CertificateSigner } from './signer.ts';
import { type TrustedIssuer, checkBanknote } from './verify.ts';

/** What a banknote is worth and where its funds live. */
export type Denomination = {
  /** Value in the token's smallest unit. */
  amount: bigint;
  decimals: number;
  tokenId: string;
  symbol: string;
  /** Intents/FAR contract holding the funds. */
  contractId: string;
};

/** A card whose keys exist but which is not a banknote yet. */
export type PreparedCard = {
  keys: CardKeys;
  /** Intents account id of the card (Ethereum address of F): fund this. */
  accountId: string;
};

/** Step 1: the card generates its keys. Only works on a blank (EMPTY) card. */
export async function prepareCard(card: NearCashCard): Promise<PreparedCard> {
  await card.select();
  const info = await card.info();
  if (info.state !== CardState.EMPTY) {
    throw new Error(`cannot issue: card is ${cardStateName(info.state)}, expected EMPTY`);
  }
  const keys = await card.generateKeys();
  return { keys, accountId: ethereumAddress(keys.fundsPublicKey) };
}

/**
 * Step 3 (after the funds have been deposited): have the certificate signed
 * — by the NEAR MPC network for real banknotes — store it, set the holder's
 * first PIN, and verify the result.
 *
 * Call it only once the deposit to `prepared.accountId` is confirmed, with
 * the amount actually received: the signature is what every wallet trusts.
 */
export async function personalizeCard(
  card: NearCashCard,
  prepared: PreparedCard,
  denomination: Denomination,
  pin: string,
  signer: CertificateSigner,
  issuedAt: number = issueDay(),
): Promise<Certificate> {
  const certificate = await issueCertificate(
    {
      authPublicKey: prepared.keys.authPublicKey,
      fundsPublicKey: prepared.keys.fundsPublicKey,
      amount: denomination.amount,
      decimals: denomination.decimals,
      issuedAt,
      tokenId: denomination.tokenId,
      symbol: denomination.symbol,
      contractId: denomination.contractId,
    },
    signer,
  );

  return writeCertificate(card, certificate.bytes, pin, [{ name: 'this issuer', publicKey: certificate.issuerPublicKey }]);
}

/**
 * ATM side: stores a certificate the issuance server returned, sets the holder's first
 * PIN (FINALIZE), and checks the card exactly as a receiver would, against
 * the issuers the ATM trusts. A card that fails is never dispensed.
 */
export async function writeCertificate(
  card: NearCashCard,
  certificateBytes: Uint8Array,
  pin: string,
  trustedIssuers: readonly TrustedIssuer[],
): Promise<Certificate> {
  const certificate = decodeCertificate(certificateBytes);
  await card.storeCertificate(certificate.bytes);
  await card.finalize(certificate.bytes.length, pin);

  const check = await checkBanknote(card, trustedIssuers);
  if (!check.valid) {
    throw new Error(`issued card failed verification: ${check.failure} (${check.detail})`);
  }
  return certificate;
}
