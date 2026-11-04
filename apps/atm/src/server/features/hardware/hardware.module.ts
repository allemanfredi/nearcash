import { Module } from '@nestjs/common';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from './hardware.ports.ts';
import { NoCardReader } from './no-card-reader.ts';
import { SimulatedDispenser } from './simulated-dispenser.ts';

/**
 * Feature: the cassette of blank cards and the dispenser. Until the NFC
 * reader and the cards arrive there is no cassette (the ATM is out of
 * service) and the dispenser only logs; the config refuses anything else.
 */
@Module({
  providers: [
    { provide: CASSETTE, useFactory: (): Cassette => new NoCardReader() },
    {
      provide: DISPENSER,
      inject: [OPERATOR_LOG],
      useFactory: (log: OperatorLog): Dispenser => new SimulatedDispenser(log),
    },
  ],
  exports: [CASSETTE, DISPENSER],
})
export class HardwareModule {}
