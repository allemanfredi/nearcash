import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CertificatesModule } from '../certificates/certificates.module.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from '../certificates/certificate-authority.port.ts';
import { RESERVE, type Reserve } from './reserve.port.ts';
import { FarReserve } from './far.reserve.ts';
import { SimulatedReserve } from './simulated.reserve.ts';

/** Feature: the reserve the value of every banknote comes from (FAR, or an in-memory ledger). */
@Module({
  imports: [CertificatesModule],
  providers: [
    {
      provide: RESERVE,
      inject: [ISSUANCE_CONFIG, CERTIFICATE_AUTHORITY],
      useFactory: async ({ reserve }: IssuanceConfig, authority: CertificateAuthority): Promise<Reserve> => {
        if (reserve.kind === 'far') return new FarReserve(reserve.far);
        // A float large enough for demos, in every token a banknote can hold.
        const amounts = await authority.denominations();
        const tokens = new Set((await Promise.all(amounts.map((amount) => authority.denomination(amount)))).map((d) => d.tokenId));
        return new SimulatedReserve(Object.fromEntries([...tokens].map((token) => [token, 10n ** 30n])));
      },
    },
  ],
  exports: [RESERVE],
})
export class ReserveModule {}
