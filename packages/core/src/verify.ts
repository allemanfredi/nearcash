/**
 * The receiver's check (docs/protocol.md §9, "Exchange"): is the card in my
 * hand a genuine, unspent NearCash banknote, and how much is it worth?
 * Works fully offline: no network call is made.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { randomBytes } from '@noble/hashes/utils.js';
import { concatBytes, equalBytes } from './bytes.ts';
import type { CardInfo, NearCashCard } from './card.ts';
import {
  type Certificate,
  compressPublicKey,
  decodeCertificate,
  verifyCertificateSignature,
} from './certificate.ts';
import { ethereumAddress } from './eth.ts';
import { AUTH_DOMAIN_TAG, CHALLENGE_LENGTH, CardState, cardStateName } from './protocol.ts';

/** An issuer whose certificates the verifier accepts. */
export type TrustedIssuer = {
  name: string;
  /** Compressed SEC1 public key. */
  publicKey: Uint8Array;
};

/** Why a card was rejected. The UI maps each code to a message. */
export type BanknoteFailure =
  | 'NOT_ISSUED' // blank card or issuance not finished
  | 'SPENT' // genuine, but already redeemed
  | 'MALFORMED_CERTIFICATE'
  | 'UNTRUSTED_ISSUER'
  | 'BAD_CERTIFICATE_SIGNATURE'
  | 'KEY_MISMATCH' // certificate keys ≠ keys in the chip
  | 'BAD_AUTH_SIGNATURE' // the chip could not prove it holds key A
  | 'STATE_MISMATCH'; // signed state differs from INFO

export type BanknoteCheck =
  | {
      valid: true;
      info: CardInfo;
      certificate: Certificate;
      issuer: TrustedIssuer;
      /** The card's Intents account (Ethereum address of F). */
      accountId: string;
    }
  | {
      valid: false;
      failure: BanknoteFailure;
      detail: string;
      info?: CardInfo;
      certificate?: Certificate;
    };

/**
 * Runs the full receiver check on a card that has just been tapped:
 *  1. SELECT + INFO: the card must be ISSUED (or SPENT, reported as such);
 *  2. GET_CERT and check the issuer's signature against the trusted issuers;
 *  3. the keys in the certificate must be the keys inside the chip;
 *  4. AUTH with a fresh random challenge, verified with key A.
 * A card is valid only if every step passes.
 */
export async function checkBanknote(
  card: NearCashCard,
  trustedIssuers: readonly TrustedIssuer[],
): Promise<BanknoteCheck> {
  await card.select();
  const info = await card.info();

  if (info.state !== CardState.ISSUED && info.state !== CardState.SPENT) {
    return fail('NOT_ISSUED', `card state is ${cardStateName(info.state)}`, info);
  }

  // 2. Certificate: well-formed, from a trusted issuer, correctly signed.
  let certificate: Certificate;
  try {
    certificate = decodeCertificate(await card.readCertificate(info.certificateLength));
  } catch (error) {
    return fail('MALFORMED_CERTIFICATE', String(error), info);
  }
  const issuer = trustedIssuers.find((candidate) =>
    equalBytes(compressPublicKey(candidate.publicKey), certificate.issuerPublicKey),
  );
  if (!issuer) {
    return fail('UNTRUSTED_ISSUER', 'the certificate was not issued by a trusted issuer', info, certificate);
  }
  if (!verifyCertificateSignature(certificate)) {
    return fail('BAD_CERTIFICATE_SIGNATURE', `invalid signature by issuer ${issuer.name}`, info, certificate);
  }

  // 3. The certificate must describe this very chip.
  if (
    !info.authPublicKey ||
    !info.fundsPublicKey ||
    !equalBytes(compressPublicKey(info.authPublicKey), certificate.authPublicKey) ||
    !equalBytes(compressPublicKey(info.fundsPublicKey), certificate.fundsPublicKey)
  ) {
    return fail('KEY_MISMATCH', 'the certificate belongs to a different card', info, certificate);
  }

  // 4. Proof of possession of key A over a fresh challenge. Without this, a
  //    copy of the certificate on a fake card would pass steps 1–3.
  const challenge = randomBytes(CHALLENGE_LENGTH);
  const auth = await card.auth(challenge);
  const message = concatBytes(AUTH_DOMAIN_TAG, challenge, Uint8Array.of(auth.state));
  if (!verifyAuthSignature(auth.signature, message, certificate.authPublicKey)) {
    return fail('BAD_AUTH_SIGNATURE', 'the card could not prove it holds key A', info, certificate);
  }
  if (auth.state !== info.state) {
    return fail('STATE_MISMATCH', 'signed state differs from INFO', info, certificate);
  }
  if (auth.state === CardState.SPENT) {
    return fail('SPENT', 'this banknote has already been redeemed', info, certificate);
  }

  return {
    valid: true,
    info,
    certificate,
    issuer,
    accountId: ethereumAddress(certificate.fundsPublicKey),
  };
}

/**
 * Verifies an AUTH signature: DER ECDSA over SHA-256(message).
 * The card does not normalise s, so high-s signatures must be accepted.
 */
export function verifyAuthSignature(signature: Uint8Array, message: Uint8Array, authPublicKey: Uint8Array): boolean {
  try {
    return secp256k1.verify(signature, message, authPublicKey, { prehash: true, lowS: false, format: 'der' });
  } catch {
    return false;
  }
}

function fail(
  failure: BanknoteFailure,
  detail: string,
  info?: CardInfo,
  certificate?: Certificate,
): BanknoteCheck {
  return { valid: false, failure, detail, info, certificate };
}
