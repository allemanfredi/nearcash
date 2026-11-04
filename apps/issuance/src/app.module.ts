import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { AtmAuthGuard } from './common/atm-auth.guard.ts';
import { HttpErrorFilter } from './common/http-error.filter.ts';
import { IssuanceConfigModule } from './config/config.module.ts';
import type { IssuanceConfig } from './config/issuance-config.ts';
import { CertificatesModule } from './features/certificates/certificates.module.ts';
import { PaymentsModule } from './features/payments/payments.module.ts';
import { RefundsModule } from './features/refunds/refunds.module.ts';
import { ReserveModule } from './features/reserve/reserve.module.ts';
import { SalesModule } from './features/sales/sales.module.ts';
import { SimulatedPaymentsModule } from './features/simulated-payments/simulated-payments.module.ts';

/**
 * The issuance server: one process, one module per feature.
 *
 *   certificates         which banknotes exist, who certifies them (NEAR MPC)
 *   payments             1Click quotes into the reserve (or simulated)
 *   reserve              where each banknote's value comes from (FAR)
 *   sales                quote → payment check → funding → certificate
 *   refunds              refunds that reached the reserve go back to whoever paid
 *   simulated-payments   development only: pay or refund by hand
 *
 * Each feature keeps its files in its own folder, and each file's name says
 * its layer:
 *   *.controller.ts   HTTP: parses requests, calls a service      (presentation)
 *   *.service.ts      the rules                                   (application)
 *   *.port.ts         interfaces and injection tokens, data types (domain)
 *   other files       adapters implementing the ports             (infrastructure)
 *   *.module.ts       wiring, with Nest's dependency injection
 * Dependencies point inwards: controllers use services, services use ports,
 * modules pick the adapters from the configuration.
 */
@Module({})
export class AppModule {
  static forRoot(config: IssuanceConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        IssuanceConfigModule.forRoot(config),
        CertificatesModule,
        PaymentsModule,
        ReserveModule,
        SalesModule,
        RefundsModule,
        ...(config.payments.kind === 'simulated' ? [SimulatedPaymentsModule] : []),
      ],
      providers: [
        // Every route is for ATMs with a token; every error leaves as {"error": "…"}.
        { provide: APP_GUARD, useClass: AtmAuthGuard },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
      ],
    };
  }
}
