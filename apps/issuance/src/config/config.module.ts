import { type DynamicModule, Global, Module } from '@nestjs/common';
import { CLOCK, systemClock } from '../common/clock.ts';
import { ISSUANCE_CONFIG, type IssuanceConfig } from './issuance-config.ts';

/**
 * Makes the configuration (and the clock) injectable everywhere: every
 * feature module builds its adapters from it.
 */
@Global()
@Module({})
export class IssuanceConfigModule {
  static forRoot(config: IssuanceConfig): DynamicModule {
    return {
      module: IssuanceConfigModule,
      providers: [
        { provide: ISSUANCE_CONFIG, useValue: config },
        { provide: CLOCK, useValue: systemClock },
      ],
      exports: [ISSUANCE_CONFIG, CLOCK],
    };
  }
}
