import {
  type Certificate,
  type CertificateFields,
  type Denomination,
  type SaleDenomination,
  issueCertificate,
} from '@nearcash/core';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './certificate-authority.port.ts';

/** The banknotes on sale, and their certificates. */
@Injectable()
export class CertificatesService {
  constructor(@Inject(CERTIFICATE_AUTHORITY) private readonly authority: CertificateAuthority) {}

  get issuerName(): string {
    return this.authority.signer.name;
  }

  issuerPublicKey(): Promise<Uint8Array> {
    return this.authority.signer.publicKey();
  }

  /** The banknote of `amount`, or an invalid-request error if it is not on sale. */
  async denomination(amount: bigint): Promise<Denomination> {
    try {
      return await this.authority.denomination(amount);
    } catch (error) {
      throw new DomainError('invalid-request', error instanceof Error ? error.message : String(error));
    }
  }

  allowedAmounts(): Promise<bigint[]> {
    return this.authority.denominations();
  }

  /** Banknotes on sale with their token symbol and decimals, for ATM displays. */
  async saleDenominations(): Promise<SaleDenomination[]> {
    const amounts = await this.authority.denominations();
    return Promise.all(
      amounts.map(async (amount) => {
        const { symbol, decimals } = await this.authority.denomination(amount);
        return { amount, symbol, decimals };
      }),
    );
  }

  /** Signs a banknote's certificate (NEAR MPC in production) and checks the result. */
  certify(fields: CertificateFields): Promise<Certificate> {
    return issueCertificate(fields, this.authority.signer);
  }
}
