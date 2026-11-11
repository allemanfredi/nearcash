import {
  type Denomination,
  type IssuerContractConfig,
  MpcCertificateSigner,
  type MpcIssuerConfig,
  NearMpcIssuerClient,
} from '@nearcash/core';
import type { CertificateAuthority } from './certificate-authority.port.ts';

/**
 * Production: the issuer contract (contracts/issuer) defines the banknotes
 * and asks the NEAR MPC network to sign. The issuance server's NEAR account
 * is the only one the contract accepts requests from (its "minter").
 */
export class MpcCertificateAuthority implements CertificateAuthority {
  readonly signer: MpcCertificateSigner;

  constructor(config: MpcIssuerConfig) {
    this.signer = new MpcCertificateSigner(new NearMpcIssuerClient(config), `NEAR MPC via ${config.issuerContractId}`);
  }

  denomination(amount: bigint): Promise<Denomination> {
    return this.signer.denomination(amount);
  }

  denominations(): Promise<bigint[]> {
    return this.signer.denominations();
  }

  /** The issuer contract's production key: it checks every chip's birth with it too. */
  productionPublicKey(): Promise<Uint8Array> {
    return this.signer.productionPublicKey();
  }

  /** The contract's configuration, for the live check. */
  contractConfig(): Promise<IssuerContractConfig> {
    return this.signer.contractConfig();
  }
}
