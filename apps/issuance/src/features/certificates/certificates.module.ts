import { NearIssuerContractReader } from '@nearcash/core';
import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CertificatesService } from './certificates.service.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './certificate-authority.port.ts';
import { DevCertificateAuthority } from './dev-certificate-authority.ts';
import { MpcCertificateAuthority } from './mpc-certificate-authority.ts';
import { SkipMpcCertificateAuthority } from './skip-mpc-certificate-authority.ts';
import { CertificatesController } from './certificates.controller.ts';

/** Who certifies banknotes, from the configuration (see IssuanceConfig.certificates). */
function certificateAuthority(certificates: IssuanceConfig['certificates']): CertificateAuthority {
  switch (certificates.kind) {
    case 'mpc':
      return new MpcCertificateAuthority(certificates.mpc);
    case 'skip-mpc':
      return new SkipMpcCertificateAuthority(new NearIssuerContractReader(certificates.issuerContract));
    case 'dev':
      return new DevCertificateAuthority();
  }
}

/** Feature: which banknotes exist, and who certifies them (NEAR MPC, or the DEV key: MPC skipped, or development). */
@Module({
  controllers: [CertificatesController],
  providers: [
    {
      provide: CERTIFICATE_AUTHORITY,
      inject: [ISSUANCE_CONFIG],
      useFactory: (config: IssuanceConfig): CertificateAuthority => certificateAuthority(config.certificates),
    },
    CertificatesService,
  ],
  exports: [CERTIFICATE_AUTHORITY, CertificatesService],
})
export class CertificatesModule {}
