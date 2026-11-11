import type { CertificateSigner, Denomination } from '@nearcash/core';

/**
 * Who certifies banknotes, and which banknotes exist. In production the
 * issuer contract decides both (allowed denominations, token) and has the
 * NEAR MPC network sign; in development, the public DEV key and one
 * denomination.
 */
export interface CertificateAuthority {
  readonly signer: CertificateSigner;
  /** The banknote of `amount` (token, symbol, decimals). Throws if that amount is not allowed. */
  denomination(amount: bigint): Promise<Denomination>;
  /** Allowed amounts, smallest unit of the token. */
  denominations(): Promise<bigint[]>;
  /**
   * The bank's production key (compressed SEC1): it signs the birth
   * certificate of every chip the bank makes (protocol.md §5.8). In
   * production the issuer contract names it; in development, the public
   * DEV production key.
   */
  productionPublicKey(): Promise<Uint8Array>;
}

/** Injection token of the CertificateAuthority. */
export const CERTIFICATE_AUTHORITY = Symbol('CERTIFICATE_AUTHORITY');
