import { type DynamicModule, Global, Logger, Module } from '@nestjs/common';
import { OPERATOR_LOG } from '../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from './atm-config.ts';

/**
 * Makes the configuration (and the operator log) injectable everywhere:
 * every feature module builds its adapters from it.
 */
@Global()
@Module({})
export class AtmConfigModule {
  static forRoot(config: AtmConfig): DynamicModule {
    return {
      module: AtmConfigModule,
      providers: [
        { provide: ATM_CONFIG, useValue: config },
        { provide: OPERATOR_LOG, useValue: new Logger('ATM') },
      ],
      exports: [ATM_CONFIG, OPERATOR_LOG],
    };
  }
}
