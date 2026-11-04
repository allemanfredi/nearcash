import { type DynamicModule, Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { HttpErrorFilter } from './common/http-error.filter.ts';
import { KioskKeyGuard } from './common/kiosk-key.guard.ts';
import type { AtmConfig } from './config/atm-config.ts';
import { AtmConfigModule } from './config/config.module.ts';
import { CatalogModule } from './features/catalog/catalog.module.ts';
import { HardwareModule } from './features/hardware/hardware.module.ts';
import { IssuanceModule } from './features/issuance/issuance.module.ts';
import { SalesModule } from './features/sales/sales.module.ts';

/**
 * The ATM server (on the Raspberry Pi): one process, one module per feature.
 * It is an API only: the page the iPhone shows is apps/kiosk (React, Vite).
 *
 *   issuance     the connection to the issuance server, the issuers to trust
 *   hardware     the cassette of blank cards and the dispenser
 *   catalog      what the screen offers (GET /api/setup)
 *   sales        the sale, from the quote to the banknote (/api/session…)
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
  static forRoot(config: AtmConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AtmConfigModule.forRoot(config), IssuanceModule, HardwareModule, CatalogModule, SalesModule],
      providers: [
        // Only the paired screen may use the API; every error leaves as {"error": "…"}.
        { provide: APP_GUARD, useClass: KioskKeyGuard },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
      ],
    };
  }
}
