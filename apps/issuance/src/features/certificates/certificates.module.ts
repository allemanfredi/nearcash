import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CertificatesService } from './certificates.service.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './certificate-authority.port.ts';
import { DevCertificateAuthority } from './dev-certificate-authority.ts';
import { MpcCertificateAuthority } from './mpc-certificate-authority.ts';
import { CertificatesController } from './certificates.controller.ts';

/** Feature: which banknotes exist, and who certifies them (NEAR MPC or the DEV key). */
@Module({
  controllers: [CertificatesController],
  providers: [
    {
      provide: CERTIFICATE_AUTHORITY,
      inject: [ISSUANCE_CONFIG],
      useFactory: (config: IssuanceConfig): CertificateAuthority =>
        config.certificates.kind === 'mpc'
          ? new MpcCertificateAuthority(config.certificates.mpc)
          : new DevCertificateAuthority(),
    },
    CertificatesService,
  ],
  exports: [CERTIFICATE_AUTHORITY, CertificatesService],
})
export class CertificatesModule {}
