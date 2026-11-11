import {
  type BirthProof,
  type CardPublicKeys,
  type Certificate,
  type CertificateFields,
  type Denomination,
  type SaleDenomination,
  birthProblem,
  issueCertificate,
} from '@nearcash/core';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.ts';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './certificate-authority.port.ts';

/** The banknotes on sale, and their certificates. */
@Injectable()
export class CertificatesService {
  constructor(
    @Inject(CERTIFICATE_AUTHORITY) private readonly authority: CertificateAuthority,
    @Inject(ISSUANCE_CONFIG) private readonly config: Pick<IssuanceConfig, 'birthCertificates'>,
  ) {}

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

  /**
   * Refuses a card the bank did not make (protocol.md §5.8): its chip must
   * have a birth certificate signed by the production key, and must have
   * signed these keys itself. Checked before the card is funded: the issuer
   * contract checks again before MPC signs, and a card it refused would keep
   * value it can never spend. Skipped only for demos (NEARCASH_SKIP_BIRTH).
   */
  async checkBirth(keys: CardPublicKeys, birth: BirthProof | undefined): Promise<void> {
    if (this.config.birthCertificates === 'skipped') return;
    if (!birth) throw new DomainError('invalid-request', 'this card has no birth certificate: the bank did not make it');
    let productionKey: Uint8Array;
    try {
      productionKey = await this.authority.productionPublicKey();
    } catch (error) {
      throw new DomainError('needs-operator', error instanceof Error ? error.message : String(error));
    }
    const problem = birthProblem(birth, keys, productionKey);
    if (problem) throw new DomainError('invalid-request', problem);
  }

  /** Signs a banknote's certificate (NEAR MPC in production, with the chip's birth) and checks the result. */
  certify(fields: CertificateFields, birth?: BirthProof): Promise<Certificate> {
    return issueCertificate(fields, this.authority.signer, birth);
  }
}
