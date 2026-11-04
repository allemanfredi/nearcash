/**
 * Test doubles for the issuance server: a certificate authority with the DEV
 * key (or a given signer), a reserve that counts transfers, card keys.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { type CertificateSigner, DEV_DENOMINATION, DEV_ISSUER_SIGNER, type Denomination } from '@nearcash/core';
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

/** The keys a blank card would generate. */
export function cardKeys() {
  return {
    authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
  };
}
