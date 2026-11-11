/**
 * Who signs banknote certificates (docs/protocol.md §8).
 *
 * Issuance code depends only on this interface, so the key can live in
 * different places without touching anything else:
 *  - MpcCertificateSigner (mpc.ts): the NEAR MPC network signs, through the
 *    issuer contract, which rebuilds the certificate body itself. This is
 *    how real banknotes are issued.
 *  - LocalKeySigner (here): a secret key in memory. Tests and the public
 *    DEV issuer only.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import type { BirthProof } from './birth.ts';
import type { CertificateFields } from './certificate.ts';

/** What a signer is asked to sign. */
export type CertificateSigningRequest = {
  /** The certificate fields, keys already compressed. */
  fields: CertificateFields;
  /** The body built from them (protocol.md §8). The signature must cover SHA-256(body). */
  body: Uint8Array;
  /**
   * The card's birth certificate (protocol.md §5.8). The issuer contract
   * requires it; local signers (DEV key) ignore it: the issuance server has
   * checked it already, unless birth certificates are skipped for a demo.
   */
  birth?: BirthProof;
};

export interface CertificateSigner {
  /** Human-readable description, for logs and errors. */
  readonly name: string;

  /** Compressed SEC1 public key (33 bytes) that verifiers must trust. */
  publicKey(): Promise<Uint8Array>;

  /**
   * Returns a compact ECDSA secp256k1 signature r ‖ s (64 bytes) over
   * SHA-256(request.body); s may be high, the caller normalises it.
   * A signer may rebuild the body from `request.fields` (the issuer contract
   * does): the caller checks the result against `request.body`.
   */
  sign(request: CertificateSigningRequest): Promise<Uint8Array>;
}

/** Signs with a secret key held in memory. Never use for real banknotes. */
export class LocalKeySigner implements CertificateSigner {
  readonly name: string;
  private readonly secretKey: Uint8Array;

  constructor(secretKey: Uint8Array, name: string) {
    this.secretKey = secretKey;
    this.name = name;
  }

  async publicKey(): Promise<Uint8Array> {
    return secp256k1.getPublicKey(this.secretKey, true);
  }

  async sign(request: CertificateSigningRequest): Promise<Uint8Array> {
    // prehash: false — we pass the SHA-256 digest of the body ourselves.
    return secp256k1.sign(sha256(request.body), this.secretKey, { prehash: false, lowS: true, format: 'compact' });
  }
}
