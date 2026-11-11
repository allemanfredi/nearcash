import { Module } from '@nestjs/common';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from '../../config/atm-config.ts';
import { DummyReader } from './dummy-reader.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from './hardware.ports.ts';
import { NoCardReader } from './no-card-reader.ts';
import { PcscCassette } from './pcsc-cassette.ts';
import { PcscReaders, loadPcscLibrary } from './pcsc-readers.ts';
import { ServoDispenser } from './servo-dispenser.ts';
import { SimulatedDispenser } from './simulated-dispenser.ts';

/** Injection token of the PC/SC readers, when the cassette uses them. */
const PCSC_READERS = Symbol('PCSC_READERS');

/**
 * Feature: the cassette of blank cards and the dispenser.
 *
 *   NEARCASH_CASSETTE=pcsc     the NFC reader (PC/SC) in front of the blank cards
 *   NEARCASH_CASSETTE=dummy    the printed dummy reader: nothing is issued, the card comes out blank
 *   NEARCASH_CASSETTE=none     no reader: the ATM is out of service
 *   NEARCASH_DISPENSER=servos  the turret and the pusher (hardware/atm/dispense.py)
 *   NEARCASH_DISPENSER=sim     nothing moves, the dispense is only logged
 */
@Module({
  providers: [
    {
      provide: PCSC_READERS,
      inject: [ATM_CONFIG, OPERATOR_LOG],
      useFactory: async (config: AtmConfig, log: OperatorLog): Promise<PcscReaders | undefined> => {
        if (config.cassette.kind !== 'pcsc') return undefined;
        const readers = new PcscReaders({
          readerName: config.cassette.readerName,
          library: loadPcscLibrary(),
          onEvent: (message) => log.log(`[reader] ${message}`),
        });
        readers.start();
        await readers.firstScan();
        return readers;
      },
    },
    {
      provide: CASSETTE,
      inject: [ATM_CONFIG, PCSC_READERS],
      useFactory: (config: AtmConfig, readers: PcscReaders | undefined): Cassette => {
        if (config.cassette.kind === 'pcsc' && readers) {
          return new PcscCassette(readers, config.cassette.readerName, config.cassette.requireBirth);
        }
        if (config.cassette.kind === 'dummy') return new DummyReader();
        return new NoCardReader();
      },
    },
    {
      provide: DISPENSER,
      inject: [ATM_CONFIG, OPERATOR_LOG],
      useFactory: (config: AtmConfig, log: OperatorLog): Dispenser =>
        config.dispenser.kind === 'servos' ? new ServoDispenser(config.dispenser.command, log) : new SimulatedDispenser(log),
    },
  ],
  exports: [CASSETTE, DISPENSER],
})
export class HardwareModule {}
