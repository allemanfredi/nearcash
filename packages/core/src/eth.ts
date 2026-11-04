/**
 * Ethereum-style helpers for the card's funds key F on NEAR Intents.
 *
 * The card's Intents account id is the Ethereum address of F, and the
 * redemption is an ERC-191 signature. Rules verified in the near/intents
 * sources (docs/protocol.md §7):
 *  - digest = keccak256("\x19Ethereum Signed Message:\n" ‖ len ‖ message);
 *  - the contract rejects high-s signatures (malleability);
 *  - the signature is 65 bytes: r (32) ‖ s (32) ‖ recoveryId (1).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { bytesToHex, concatBytes, uintToBytes, utf8ToBytes } from './bytes.ts';

/** Lowercase "0x…" address of a secp256k1 public key (any SEC1 encoding). */
export function ethereumAddress(publicKey: Uint8Array): string {
  const uncompressed = secp256k1.Point.fromBytes(publicKey).toBytes(false); // 0x04 ‖ X ‖ Y
  const hash = keccak_256(uncompressed.subarray(1)); // hash X ‖ Y, without the 0x04 prefix
  return `0x${bytesToHex(hash.subarray(12))}`; // last 20 bytes
}

/** ERC-191 ("personal_sign") digest of a message. */
export function erc191Digest(message: string | Uint8Array): Uint8Array {
  const bytes = typeof message === 'string' ? utf8ToBytes(message) : message;
  // The length is written in decimal ASCII, without padding.
  const prefix = utf8ToBytes(`\x19Ethereum Signed Message:\n${bytes.length}`);
  return keccak_256(concatBytes(prefix, bytes));
}

/**
 * Converts the card's SIGN_ONCE answer (DER, possibly high-s) into the
 * 65-byte r ‖ s ‖ recoveryId form NEAR Intents accepts:
 *  1. if s is in the upper half of the curve order, replace it with n − s
 *     (an equally valid signature, the one the contract accepts);
 *  2. find the recovery id (0 or 1) that recovers the card's key F.
 *
 * Recovery ids 2 and 3 only exist when r ≥ n, which has probability ~2^-128,
 * so they are not tried.
 */
export function toRecoverableSignature(
  derSignature: Uint8Array,
  digest: Uint8Array,
  fundsPublicKey: Uint8Array,
): Uint8Array {
  const curveOrder = secp256k1.Point.Fn.ORDER;
  let signature = secp256k1.Signature.fromBytes(derSignature, 'der');
  if (signature.hasHighS()) {
    signature = new secp256k1.Signature(signature.r, curveOrder - signature.s);
  }

  const expectedKey = secp256k1.Point.fromBytes(fundsPublicKey);
  for (const recoveryId of [0, 1]) {
    let recovered;
    try {
      recovered = signature.addRecoveryBit(recoveryId).recoverPublicKey(digest);
    } catch {
      continue; // this recovery id gives no valid point; try the other one
    }
    if (recovered.equals(expectedKey)) {
      return concatBytes(uintToBytes(signature.r, 32), uintToBytes(signature.s, 32), Uint8Array.of(recoveryId));
    }
  }
  throw new Error('signature does not belong to the given key and digest');
}
