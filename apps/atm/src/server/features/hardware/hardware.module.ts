import { Module } from '@nestjs/common';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from '../../config/atm-config.ts';
import { CardEmulator, EmulatedCassette, EmulatedDispenser } from './card-emulator.ts';
import { DummyReader } from './dummy-reader.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from './hardware.ports.ts';
import { NoCardReader } from './no-card-reader.ts';
import { PcscCassette } from './pcsc-cassette.ts';
import { PcscReaders, loadPcscLibrary } from './pcsc-readers.ts';
import { ServoDispenser } from './servo-dispenser.ts';
import { SimulatedDispenser } from './simulated-dispenser.ts';

/** Injection token of the PC/SC readers, when the cassette uses them. */
const PCSC_READERS = Symbol('PCSC_READERS');
/** Injection token of the card emulator, when the cassette and the dispenser are its own (`pnpm local`). */
const CARD_EMULATOR = Symbol('CARD_EMULATOR');

/**
 * Feature: the cassette of blank cards and the dispenser.
 *
 *   NEARCASH_CASSETTE=pcsc     the NFC reader (PC/SC) in front of the blank cards
 *   NEARCASH_CASSETTE=dummy    the printed dummy reader: nothing is issued, the card comes out blank
 *   NEARCASH_CASSETTE=none     no reader: the ATM is out of service
 *   NEARCASH_CASSETTE=emulator and NEARCASH_DISPENSER=emulator
 *                              DEVELOPMENT ONLY (`pnpm local`): the card emulator, the real applet in jCardSim
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
      provide: CARD_EMULATOR,
      inject: [ATM_CONFIG, OPERATOR_LOG],
      useFactory: async (config: AtmConfig, log: OperatorLog): Promise<CardEmulator | undefined> => {
        if (config.cassette.kind !== 'emulator') return undefined;
        const emulator = new CardEmulator(config.cassette.url, log);
        await emulator.start();
        return emulator;
      },
    },
    {
      provide: CASSETTE,
      inject: [ATM_CONFIG, PCSC_READERS, CARD_EMULATOR, DISPENSER],
      useFactory: (
        config: AtmConfig,
        readers: PcscReaders | undefined,
        emulator: CardEmulator | undefined,
        dispenser: Dispenser,
      ): Cassette => {
        if (config.cassette.kind === 'emulator' && emulator) return new EmulatedCassette(emulator, dispenser);
        if (config.cassette.kind === 'pcsc' && readers) {
          // With the servos the pusher loads each card once its sale is paid; without, an operator puts it there.
          const load = dispenser.loadsCards ? () => dispenser.load() : undefined;
          return new PcscCassette(readers, config.cassette.readerName, config.cassette.requireBirth, load);
        }
        if (config.cassette.kind === 'dummy') return new DummyReader();
        return new NoCardReader();
      },
    },
    {
      provide: DISPENSER,
      inject: [ATM_CONFIG, OPERATOR_LOG, CARD_EMULATOR],
      useFactory: (config: AtmConfig, log: OperatorLog, emulator: CardEmulator | undefined): Dispenser => {
        if (config.dispenser.kind === 'servos') return new ServoDispenser(config.dispenser.command, log);
        if (config.dispenser.kind === 'emulator' && emulator) return new EmulatedDispenser(emulator);
        return new SimulatedDispenser(log);
      },
    },
  ],
  exports: [CASSETTE, DISPENSER],
})
export class HardwareModule {}
