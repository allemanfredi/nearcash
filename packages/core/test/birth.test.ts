/**
 * The chip's birth certificate (protocol.md §5.8): what the factory signs,
 * what the chip signs, and the issuer's check. The fixed vector at the end
 * is repeated in contracts/issuer (Rust): both sides must agree byte for byte.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { describe, expect, it } from 'vitest';
import {
  type BirthProof,
  type CardTransport,
  DEV_PRODUCTION_PUBLIC_KEY,
  DEV_PRODUCTION_SECRET_KEY,
  birthMessage,
  birthProblem,
  bytesToHex,
  compressPublicKey,
  keysMessage,
  NearCashCard,
  signBirth,
  toBirthProof,
  utf8ToBytes,
} from '../src/index.ts';

/** A chip born with the DEV production key, which signs a fresh A and F as a real card would (DER). */
function bornCard(productionSecretKey = DEV_PRODUCTION_SECRET_KEY) {
  const chipSecret = secp256k1.utils.randomSecretKey();
  const chipPublicKey = secp256k1.getPublicKey(chipSecret, false);
  const keys = {
    authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
  };
  const keysSignatureDer = secp256k1.sign(sha256(keysMessage(keys.authPublicKey, keys.fundsPublicKey)), chipSecret, {
    prehash: false,
    lowS: false,
    format: 'der',
  });
  const proof = toBirthProof(chipPublicKey, signBirth(chipPublicKey, productionSecretKey), keysSignatureDer);
  return { chipSecret, keys, proof };
}

describe('birth certificate', () => {
  it('messages: a domain tag, then compressed keys', () => {
    const key = secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false);
    expect(birthMessage(key)).toEqual(Uint8Array.from([...utf8ToBytes('NBK-BIRTH-v1'), ...compressPublicKey(key)]));
    expect(keysMessage(key, key).length).toBe(11 + 33 + 33);
  });

  it('a chip born with the production key, vouching for its own keys, passes', () => {
    const { keys, proof } = bornCard();
    expect(birthProblem(proof, keys, DEV_PRODUCTION_PUBLIC_KEY)).toBeUndefined();
    expect(proof.chipPublicKey.length).toBe(33);
    expect(proof.keysSignature.length).toBe(64);
  });

  it('a chip born with another production key is refused', () => {
    const { keys, proof } = bornCard(secp256k1.utils.randomSecretKey());
    expect(birthProblem(proof, keys, DEV_PRODUCTION_PUBLIC_KEY)).toMatch(/production key/);
  });

  it('keys the chip did not sign are refused (keys made outside the chip)', () => {
    const { proof } = bornCard();
    const otherKeys = {
      authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
      fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    };
    expect(birthProblem(proof, otherKeys, DEV_PRODUCTION_PUBLIC_KEY)).toMatch(/did not sign these keys/);
  });

  it("a genuine chip's birth copied onto keys signed by another chip is refused", () => {
    const genuine = bornCard();
    const forged = bornCard(secp256k1.utils.randomSecretKey());
    const mixed: BirthProof = { ...genuine.proof, keysSignature: forged.proof.keysSignature };
    expect(birthProblem(mixed, forged.keys, DEV_PRODUCTION_PUBLIC_KEY)).toBeDefined();
  });

  it('A and F swapped are refused: the order is signed', () => {
    const { keys, proof } = bornCard();
    const swapped = { authPublicKey: keys.fundsPublicKey, fundsPublicKey: keys.authPublicKey };
    expect(birthProblem(proof, swapped, DEV_PRODUCTION_PUBLIC_KEY)).toBeDefined();
  });

  it('the shared vector (contracts/issuer repeats it)', () => {
    const production = sha256(utf8ToBytes('NearCash test production key'));
    const chip = sha256(utf8ToBytes('NearCash test chip key'));
    const chipPublicKey = secp256k1.getPublicKey(chip, true);
    // A = G and F = 2G, the keys of the contract's tests.
    const keys = { authPublicKey: secp256k1.Point.BASE.toBytes(true), fundsPublicKey: secp256k1.Point.BASE.multiply(2n).toBytes(true) };
    const keysSignature = secp256k1.sign(sha256(keysMessage(keys.authPublicKey, keys.fundsPublicKey)), chip, {
      prehash: false,
      lowS: true,
      format: 'compact',
    });
    const proof: BirthProof = { chipPublicKey, birthSignature: signBirth(chipPublicKey, production), keysSignature };

    expect(bytesToHex(secp256k1.getPublicKey(production, true))).toBe('03b55236f472a641ea4ab4ab08eb13975bfc8e5c0ddd5f7c6071c87bcdadf60d1b');
    expect(bytesToHex(chipPublicKey)).toBe('03ea3ac40b638d319b2ca804024fc12321513e5d2bfc681183a0750a3f86e35813');
    expect(bytesToHex(proof.birthSignature)).toBe(
      '2c2efd03aa3c7ce51cb4807c4de63460ef8981cfaaaa183b09c6e55e0679d855127c8340a4e3f52d96c44eab73012c1301c158a39c1f02977889339d2e58cd99',
    );
    expect(bytesToHex(keysSignature)).toBe(
      '2116ad0b93f2e1f1e84c4f84cccedf0843311e103ae4a93b4909fbf28278182053d93edd3d8cdeb213403184b82f12e69f305dcd84bf802f6211ab73221c9a5d',
    );
    expect(birthProblem(proof, keys, secp256k1.getPublicKey(production, true))).toBeUndefined();
  });
});

describe('reading the birth from a card', () => {
  /** A card that answers every command with the given status word. */
  const cardAnswering = (sw: number) =>
    new NearCashCard({ transmit: async () => Uint8Array.of(sw >> 8, sw & 0xff) } as CardTransport);

  it('a card never born (6985) and a v1 applet that does not know GET_BIRTH (6D00) have no birth', async () => {
    expect(await cardAnswering(0x6985).readBirth()).toBeUndefined();
    expect(await cardAnswering(0x6d00).readBirth()).toBeUndefined();
  });

  it('any other error is an error', async () => {
    await expect(cardAnswering(0x6a80).readBirth()).rejects.toThrow(/GET_BIRTH/);
  });
});
