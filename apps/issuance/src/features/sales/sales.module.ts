import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CertificatesModule } from '../certificates/certificates.module.ts';
import { PaymentsModule } from '../payments/payments.module.ts';
import { ReserveModule } from '../reserve/reserve.module.ts';
import { SalesService } from './sales.service.ts';
import { SALE_REPOSITORY, type SaleRepository } from './sale-repository.port.ts';
import { JsonFileSaleRepository } from './json-file-sale.repository.ts';
import { SalesController } from './sales.controller.ts';

/** Feature: selling a banknote, from the quote to the certificate (rules 1–5). */
@Module({
  imports: [CertificatesModule, PaymentsModule, ReserveModule],
  controllers: [SalesController],
  providers: [
    {
      provide: SALE_REPOSITORY,
      inject: [ISSUANCE_CONFIG],
      useFactory: (config: IssuanceConfig): SaleRepository => new JsonFileSaleRepository(config.salesFile),
    },
    SalesService,
  ],
  // The repository too: the refunds feature reads the sales it watches.
  exports: [SalesService, SALE_REPOSITORY],
})
export class SalesModule {}
