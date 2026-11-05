import {
  DEV_ISSUER,
  DEV_ISSUER_SECRET_KEY,
  type Denomination,
  IssuerContractBanknotes,
  type IssuerContractReader,
  LocalKeySigner,
} from '@nearcash/core';
import type { CertificateAuthority } from './certificate-authority.port.ts';

/**
 * DEMOS ONLY (NEARCASH_SKIP_MPC=true): the NEAR MPC signature is skipped.
 *
 * The banknotes are still the issuer contract's (token, denominations),
 * read from its config() view. But the certificate is built and signed
 * here, by the issuance server itself, with the public DEV key, instead of
 * by the NEAR MPC network through the contract's sign_certificate. So a
 * sale needs no NEAR account, no gas and no wait for the MPC nodes.
 *
 * What is skipped with the signature: the contract's own checks (daily cap,
 * public counters). And the DEV key is public, so anyone could forge these
 * certificates: the ATM trusts them because it asks this server which key
 * to trust; the wallet app trusts them only in its Debug builds. Demo
 * banknotes only, never real money.
 */
export class SkipMpcCertificateAuthority implements CertificateAuthority {
  readonly signer = new LocalKeySigner(DEV_ISSUER_SECRET_KEY, `${DEV_ISSUER.name}, MPC skipped`);
  private readonly banknotes: IssuerContractBanknotes;

  constructor(issuerContract: IssuerContractReader) {
    this.banknotes = new IssuerContractBanknotes(issuerContract);
  }

  denomination(amount: bigint): Promise<Denomination> {
    return this.banknotes.denomination(amount);
  }

  denominations(): Promise<bigint[]> {
    return this.banknotes.denominations();
  }
}
