/**
 * The chip's birth certificate (docs/protocol.md §5.8): proof that a
 * banknote's keys were born inside a genuine NearCash chip.
 *
 *   factory      the chip creates C (CHIP_KEY); the bank's production key,
 *                kept offline, signs it: the birth signature (STORE_BIRTH)
 *   ATM          the born chip creates A and F (GENERATE_KEYS) and signs them
 *                with C: the keys signature
 *   issuer       checks both signatures before funding the card (issuance
 *                server) and before having it certified (issuer contract)
 *
 * A card made by someone else has no birth signature, and C never leaves a
 * genuine chip: so nobody, not even whoever controls the issuance server,
 * can have keys of their own certified.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes } from './bytes.ts';
import { compressPublicKey, toLowS } from './certificate.ts';
import { BIRTH_DOMAIN_TAG, BIRTH_SIGNATURE_LENGTH, KEYS_DOMAIN_TAG } from './protocol.ts';

/** What the issuer checks for a card: its birth, and the keys it vouches for. */
export type BirthProof = {
  /** C, compressed SEC1 (33 bytes). */
  chipPublicKey: Uint8Array;
  /** The production key's signature over birthMessage(C): compact r ‖ s (64 bytes). */
  birthSignature: Uint8Array;
  /** C's signature over keysMessage(A, F): compact r ‖ s, low-s (64 bytes). */
  keysSignature: Uint8Array;
};

/** What the production key signs: "NBK-BIRTH-v1" ‖ compressed C. */
export function birthMessage(chipPublicKey: Uint8Array): Uint8Array {
  return concatBytes(BIRTH_DOMAIN_TAG, compressPublicKey(chipPublicKey));
}

/** What C signs at GENERATE_KEYS: "NBK-KEYS-v1" ‖ compressed A ‖ compressed F. */
export function keysMessage(authPublicKey: Uint8Array, fundsPublicKey: Uint8Array): Uint8Array {
  return concatBytes(KEYS_DOMAIN_TAG, compressPublicKey(authPublicKey), compressPublicKey(fundsPublicKey));
}

/**
 * The factory's signature: the production key signs SHA-256 of the birth
 * message, compact r ‖ s, low-s. The secret must stay on an offline machine:
 * whoever holds it can give birth to fake chips.
 */
export function signBirth(chipPublicKey: Uint8Array, productionSecretKey: Uint8Array): Uint8Array {
  return secp256k1.sign(sha256(birthMessage(chipPublicKey)), productionSecretKey, {
    prehash: false, // we pass the SHA-256 digest ourselves
    lowS: true,
    format: 'compact',
  });
}

/** A new random production key (its secret), made once, offline: `pnpm card:birth --new-key`. */
export function newProductionSecretKey(): Uint8Array {
  return secp256k1.utils.randomSecretKey();
}

/** The compressed public key of a production key: what the issuer contract names. */
export function productionPublicKeyOf(productionSecretKey: Uint8Array): Uint8Array {
  return secp256k1.getPublicKey(productionSecretKey, true);
}

/**
 * The proof a card gives, in the form the issuer reads: C compressed, and
 * the keys signature (DER from the card, possibly high-s) as compact low-s.
 */
export function toBirthProof(chipPublicKey: Uint8Array, birthSignature: Uint8Array, keysSignatureDer: Uint8Array): BirthProof {
  if (birthSignature.length !== BIRTH_SIGNATURE_LENGTH) {
    throw new RangeError(`a birth signature is ${BIRTH_SIGNATURE_LENGTH} bytes`);
  }
  const keysSignature = toLowS(secp256k1.Signature.fromBytes(keysSignatureDer, 'der').toBytes('compact'));
  return { chipPublicKey: compressPublicKey(chipPublicKey), birthSignature, keysSignature };
}

/**
 * The issuer's check: the production key gave birth to C, and C signed
 * exactly these A and F. Returns why it fails, or undefined when it holds.
 */
export function birthProblem(
  proof: BirthProof,
  keys: { authPublicKey: Uint8Array; fundsPublicKey: Uint8Array },
  productionPublicKey: Uint8Array,
): string | undefined {
  if (!verifyBirthSignature(proof.chipPublicKey, proof.birthSignature, productionPublicKey)) {
    return 'the birth certificate was not signed by the production key: the bank did not make this chip';
  }
  if (!verifySha256(proof.keysSignature, keysMessage(keys.authPublicKey, keys.fundsPublicKey), proof.chipPublicKey)) {
    return 'the chip did not sign these keys: they were not born inside it';
  }
  return undefined;
}

/** True if the production key signed this chip key's birth (the factory's check after STORE_BIRTH). */
export function verifyBirthSignature(chipPublicKey: Uint8Array, birthSignature: Uint8Array, productionPublicKey: Uint8Array): boolean {
  return verifySha256(birthSignature, birthMessage(chipPublicKey), productionPublicKey);
}

/** ECDSA over SHA-256(message), compact r ‖ s; high-s accepted (only the message matters here). */
function verifySha256(signature: Uint8Array, message: Uint8Array, publicKey: Uint8Array): boolean {
  try {
    return secp256k1.verify(signature, message, publicKey, { prehash: true, lowS: false, format: 'compact' });
  } catch {
    return false; // malformed signature or key
  }
}
