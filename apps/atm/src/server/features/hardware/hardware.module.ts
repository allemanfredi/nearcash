import { Module } from '@nestjs/common';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from '../../config/atm-config.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from './hardware.ports.ts';
import { NoCardReader } from './no-card-reader.ts';
import { PcscCassette } from './pcsc-cassette.ts';
import { PcscReaders, loadPcscLibrary } from './pcsc-readers.ts';
import { SimulatedDispenser } from './simulated-dispenser.ts';

/** Injection token of the PC/SC readers, when the cassette uses them. */
const PCSC_READERS = Symbol('PCSC_READERS');

/**
 * Feature: the cassette of blank cards and the dispenser.
 *
 *   NEARCASH_CASSETTE=pcsc   the NFC reader (PC/SC) in front of the blank cards
 *   NEARCASH_CASSETTE=none   no reader: the ATM is out of service
 *
 * The dispenser only logs until its motor is wired.
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
      useFactory: (config: AtmConfig, readers: PcscReaders | undefined): Cassette =>
        config.cassette.kind === 'pcsc' && readers ? new PcscCassette(readers, config.cassette.readerName) : new NoCardReader(),
    },
    {
      provide: DISPENSER,
      inject: [OPERATOR_LOG],
      useFactory: (log: OperatorLog): Dispenser => new SimulatedDispenser(log),
    },
  ],
  exports: [CASSETTE, DISPENSER],
})
export class HardwareModule {}
