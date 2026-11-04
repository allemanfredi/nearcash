import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import { bytesToHex, erc191Digest, ethereumAddress, hexToBytes, toRecoverableSignature } from '../src/index.ts';

describe('ethereumAddress', () => {
  it('matches the well-known address of secret key 1', () => {
    const secretKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    expect(ethereumAddress(secp256k1.getPublicKey(secretKey, false))).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
    // Same result from the compressed key.
    expect(ethereumAddress(secp256k1.getPublicKey(secretKey, true))).toBe('0x7e5f4552091a69125d5dfcb7b8c2659029395bdf');
  });
});

describe('erc191Digest', () => {
  it('matches the personal_sign digest of "hello world"', () => {
    expect(bytesToHex(erc191Digest('hello world'))).toBe(
      'd9eba16ed0ecae432b71fe008c98cc872bb4cc214d3220a36f365326cf807d68',
    );
  });
});

describe('toRecoverableSignature', () => {
  const secretKey = secp256k1.utils.randomSecretKey();
  const publicKey = secp256k1.getPublicKey(secretKey, false);
  const digest = erc191Digest('{"intents":[]}');
  const curveOrder = secp256k1.Point.Fn.ORDER;

  /** Signs like the card: plain ECDSA on the digest, DER, s high or low as requested. */
  function cardLikeSignature(highS: boolean): Uint8Array {
    const lowS = secp256k1.Signature.fromBytes(
      secp256k1.sign(digest, secretKey, { prehash: false, lowS: true, format: 'compact' }),
      'compact',
    );
    const signature = highS ? new secp256k1.Signature(lowS.r, curveOrder - lowS.s) : lowS;
    return signature.toBytes('der');
  }

  for (const highS of [false, true]) {
    it(`returns a low-s r‖s‖v signature that recovers the key (input ${highS ? 'high' : 'low'}-s)`, () => {
      const result = toRecoverableSignature(cardLikeSignature(highS), digest, publicKey);
      expect(result.length).toBe(65);

      const r = BigInt(`0x${bytesToHex(result.subarray(0, 32))}`);
      const s = BigInt(`0x${bytesToHex(result.subarray(32, 64))}`);
      const recoveryId = result[64]!;
      expect(s <= curveOrder / 2n).toBe(true);
      expect([0, 1]).toContain(recoveryId);

      const recovered = new secp256k1.Signature(r, s).addRecoveryBit(recoveryId).recoverPublicKey(digest);
      expect(ethereumAddress(recovered.toBytes(false))).toBe(ethereumAddress(publicKey));
    });
  }

  it('refuses a signature made by another key', () => {
    const otherKey = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false);
    expect(() => toRecoverableSignature(cardLikeSignature(false), digest, otherKey)).toThrow();
  });
});
