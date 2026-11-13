/**
 * The ATM server's configuration (it runs on the Raspberry Pi inside the
 * ATM): environment variables, read from <repository root>/.env.atm when
 * present (template: .env.atm.example), turned into one typed object.
 * Defaults are for local development.
 *
 *   NEARCASH_ISSUANCE_URL    http://127.0.0.1:8790
 *   NEARCASH_ATM_TOKEN       dev-atm-token              this ATM's token at the issuance server
 *   NEARCASH_TRUSTED_ISSUER  issuer key (hex) cards must verify against; default: ask the issuance server
 *   NEARCASH_ATM_HOST        127.0.0.1                  only the kiosk page's server (same Pi) calls it
 *   NEARCASH_ATM_PORT        8792
 *   NEARCASH_KIOSK_KEY       pairing key the iPhone must send; empty: no check (development)
 *   NEARCASH_CASSETTE        none                       none: no reader, the ATM is out of service
 *                                                       pcsc: the NFC reader (PC/SC) in front of the blank cards
 *                                                       dummy: the printed dummy reader, to test the sale and the
 *                                                              mechanics without the NFC reader: nothing is issued,
 *                                                              the card comes out blank
 *                                                       emulator: DEVELOPMENT ONLY (`pnpm local`): the card emulator
 *                                                              (applet/src/emulator), the real applet in jCardSim,
 *                                                              born with the public DEV production key; needs
 *                                                              NEARCASH_DISPENSER=emulator
 *   NEARCASH_READER          part of the NFC reader's name; needed only when several
 *                            PC/SC readers are connected (a YubiKey counts as one)
 *   NEARCASH_SKIP_BIRTH      false                      true: demos with cards that were never born
 *                                                       (docs/protocol.md §5.8): the NFC reader accepts
 *                                                       a blank card without a birth certificate; the
 *                                                       issuance server must skip them too
 *   NEARCASH_DISPENSER       sim                        sim: nothing moves, only logged (with the NFC reader,
 *                                                            an operator puts each card on it before the sale)
 *                                                       servos: the pusher loads each card once its sale is
 *                                                               paid, the turret hands it out, through
 *                                                               hardware/atm/dispense.py
 *                                                       emulator: the card emulator's pusher and turret (with
 *                                                               NEARCASH_CASSETTE=emulator)
 *   NEARCASH_CARD_EMULATOR_URL  http://127.0.0.1:8893   where the card emulator listens
 *   NEARCASH_SERVO_OPTIONS   the servos' calibration, as for `pnpm atm:cycle`, e.g. "--pusher-reversed --stroke 160"
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Injection token of the AtmConfig. */
export const ATM_CONFIG = Symbol('ATM_CONFIG');

/** apps/atm, from src/server/config (sources) or dist/server/config (build). */
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/** The script that drives the servos for one card (Python, shared with cycle.py: servo_driver.py). */
const DISPENSE_SCRIPT = resolve(appDirectory, '../../hardware/atm/dispense.py');

export type AtmConfig = {
  issuance: { url: string; atmToken: string };
  /** Issuer key (compressed, hex) every dispensed card must verify against; undefined: ask the issuance server. */
  trustedIssuerKey: string | undefined;
  /** Plain HTTP on the Pi itself: the kiosk page's server forwards /api here (HTTPS is the page's). */
  http: { host: string; port: number };
  /** When set, the kiosk API answers only a screen that sends it (X-Kiosk-Key). */
  kioskKey: string | undefined;
  /**
   * none: no reader (out of service); pcsc: the NFC reader in front of the
   * blank cards; dummy: the printed dummy reader (no chip: cards come out blank).
   */
  cassette:
    | { kind: 'none' }
    | {
        kind: 'pcsc';
        readerName: string | undefined;
        /** A blank card must have a birth certificate (false only for demos: NEARCASH_SKIP_BIRTH). */
        requireBirth: boolean;
      }
    | { kind: 'dummy' }
    /** DEVELOPMENT ONLY: the card emulator (the real applet in jCardSim), at `url`. */
    | { kind: 'emulator'; url: string };
  /**
   * sim: only logged; servos: `command` is run for each card (python3,
   * dispense.py and the calibration options).
   */
  dispenser: { kind: 'sim' } | { kind: 'servos'; command: string[] } | { kind: 'emulator'; url: string };
  /** How often a sale's payment is asked to the issuance server. */
  pollMs: number;
  /** After a quote's deadline, how long to keep trying when the issuance server can't be reached. */
  graceMs: number;
  /**
   * How long the kiosk shows each issuing step at least. The kiosk asks for
   * the sale every 1.5 s: a step done faster (a simulated one: the dummy
   * reader, payments, funding or MPC skipped) would flash by or never show.
   */
  minStepMs: number;
};

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Reads .env.atm into the environment (variables already set win). */
export function loadAtmEnvironment(): NodeJS.ProcessEnv {
  const file = resolve(appDirectory, '../../.env.atm');
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}

export function atmConfigFromEnvironment(env: NodeJS.ProcessEnv): AtmConfig {
  // Cards that were never born (protocol.md §5.8), for demos only.
  const skipBirthText = (env.NEARCASH_SKIP_BIRTH ?? '').trim().toLowerCase();
  if (!['', 'true', 'false', '1', '0'].includes(skipBirthText)) {
    throw new ConfigurationError('NEARCASH_SKIP_BIRTH must be true or false');
  }
  const skipBirth = skipBirthText === 'true' || skipBirthText === '1';

  const cassette = env.NEARCASH_CASSETTE ?? 'none';
  if (cassette !== 'none' && cassette !== 'pcsc' && cassette !== 'dummy' && cassette !== 'emulator') {
    throw new ConfigurationError(
      `NEARCASH_CASSETTE=${cassette}: must be "pcsc" (the NFC reader), "dummy" (the printed dummy reader), "emulator" (development) or "none"`,
    );
  }
  const dispenser = env.NEARCASH_DISPENSER ?? 'sim';
  if (dispenser !== 'sim' && dispenser !== 'servos' && dispenser !== 'emulator') {
    throw new ConfigurationError(`NEARCASH_DISPENSER=${dispenser}: must be "servos" (the turret and the pusher), "emulator" (development) or "sim"`);
  }
  // The emulator's cards go in and out through its own pusher and turret: one without the other would leave
  // each banknote in the emulated reader (or load a real card into a reader that isn't there).
  if ((cassette === 'emulator') !== (dispenser === 'emulator')) {
    throw new ConfigurationError('NEARCASH_CASSETTE=emulator and NEARCASH_DISPENSER=emulator go together');
  }
  const emulatorUrl = env.NEARCASH_CARD_EMULATOR_URL || 'http://127.0.0.1:8893';
  // "--pusher-reversed --stroke 160" → ["--pusher-reversed", "--stroke", "160"]: dispense.py checks them.
  const servoOptions = (env.NEARCASH_SERVO_OPTIONS ?? '').split(/\s+/).filter((option) => option !== '');

  return {
    issuance: {
      url: env.NEARCASH_ISSUANCE_URL ?? 'http://127.0.0.1:8790',
      atmToken: env.NEARCASH_ATM_TOKEN ?? 'dev-atm-token',
    },
    trustedIssuerKey: env.NEARCASH_TRUSTED_ISSUER || undefined,
    http: {
      host: env.NEARCASH_ATM_HOST ?? '127.0.0.1',
      port: Number(env.NEARCASH_ATM_PORT ?? 8792),
    },
    kioskKey: env.NEARCASH_KIOSK_KEY || undefined,
    cassette:
      cassette === 'pcsc'
        ? { kind: 'pcsc', readerName: env.NEARCASH_READER || undefined, requireBirth: !skipBirth }
        : cassette === 'emulator'
          ? { kind: 'emulator', url: emulatorUrl }
          : { kind: cassette },
    dispenser:
      dispenser === 'servos'
        ? { kind: 'servos', command: ['python3', DISPENSE_SCRIPT, ...servoOptions] }
        : dispenser === 'emulator'
          ? { kind: 'emulator', url: emulatorUrl }
          : { kind: 'sim' },
    pollMs: 3_000,
    graceMs: 15 * 60_000,
    minStepMs: 3_000,
  };
}
