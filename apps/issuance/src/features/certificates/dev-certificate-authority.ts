import { DEV_DENOMINATION, DEV_ISSUER_SIGNER, DEV_PRODUCTION_PUBLIC_KEY, type Denomination } from '@nearcash/core';
import type { CertificateAuthority } from './certificate-authority.port.ts';

/**
 * DEVELOPMENT ONLY: the public DEV key and its single denomination (0.01 ETH).
 * Wallets trust it only in their Debug builds: test banknotes only.
 */
export class DevCertificateAuthority implements CertificateAuthority {
  readonly signer = DEV_ISSUER_SIGNER;

  async denomination(amount: bigint): Promise<Denomination> {
    if (amount !== DEV_DENOMINATION.amount) throw new Error(`only ${DEV_DENOMINATION.amount} in dev mode`);
    return DEV_DENOMINATION;
  }

  async denominations(): Promise<bigint[]> {
    return [DEV_DENOMINATION.amount];
  }

  /** The public DEV production key: test chips are born with it (pnpm card:birth --dev). */
  async productionPublicKey(): Promise<Uint8Array> {
    return DEV_PRODUCTION_PUBLIC_KEY;
  }
}
