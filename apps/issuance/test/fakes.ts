/**
 * Test doubles for the issuance server: a certificate authority with the DEV
 * key (or a given signer), a reserve that counts transfers, card keys.
 */
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  type BirthProof,
  type CardPublicKeys,
  type CertificateSigner,
  DEV_DENOMINATION,
  DEV_ISSUER_SIGNER,
  DEV_PRODUCTION_PUBLIC_KEY,
  DEV_PRODUCTION_SECRET_KEY,
  type Denomination,
  keysMessage,
  signBirth,
  toBirthProof,
} from '@nearcash/core';
import type { CertificateAuthority } from '../src/features/certificates/certificate-authority.port.ts';
import type { CardFunding, Nep413Payload, Reserve, SignedNep413 } from '../src/features/reserve/reserve.port.ts';
import { SimulatedReserve } from '../src/features/reserve/simulated.reserve.ts';

export const TEN = DEV_DENOMINATION.amount;
export const TOKEN = DEV_DENOMINATION.tokenId;

/** The DEV denomination only, signed by `signer` (default: the DEV key). */
export class TestAuthority implements CertificateAuthority {
  readonly signer: CertificateSigner;
  constructor(signer: CertificateSigner = DEV_ISSUER_SIGNER) {
    this.signer = signer;
  }
  async denomination(amount: bigint): Promise<Denomination> {
    if (amount !== TEN) throw new Error('not an allowed denomination');
    return DEV_DENOMINATION;
  }
  async denominations(): Promise<bigint[]> {
    return [TEN];
  }
  async productionPublicKey(): Promise<Uint8Array> {
    return DEV_PRODUCTION_PUBLIC_KEY;
  }
}

/** Counts transfers; optionally fails the next one. */
export class CountingReserve implements Reserve {
  readonly name = 'counting reserve';
  readonly inner = new SimulatedReserve({ [TOKEN]: 10n ** 30n });
  calls = 0;
  failNext = false;
  async fundCard(funding: CardFunding): Promise<string> {
    this.calls += 1;
    if (this.failNext) {
      this.failNext = false;
      throw new Error('relay timeout');
    }
    return this.inner.fundCard(funding);
  }
  signIntent(payload: Nep413Payload): Promise<SignedNep413> {
    return this.inner.signIntent(payload);
  }
}

/** The keys a blank card would generate. Without a birth certificate: a card the bank did not make. */
export function cardKeys() {
  return {
    authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
  };
}

/**
 * A blank card the bank made (protocol.md §5.8): its chip was born with
 * `productionSecretKey` (default: the DEV production key) and signs the
 * keys it generates, as the applet does (DER).
 */
export function bornCard(productionSecretKey: Uint8Array = DEV_PRODUCTION_SECRET_KEY): { keys: CardPublicKeys; birth: BirthProof } {
  const keys = cardKeys();
  const chipSecret = secp256k1.utils.randomSecretKey();
  const chipPublicKey = secp256k1.getPublicKey(chipSecret, false);
  const keysSignature = secp256k1.sign(createHash('sha256').update(keysMessage(keys.authPublicKey, keys.fundsPublicKey)).digest(), chipSecret, {
    prehash: false,
    format: 'der',
  });
  return { keys, birth: toBirthProof(chipPublicKey, signBirth(chipPublicKey, productionSecretKey), keysSignature) };
}
