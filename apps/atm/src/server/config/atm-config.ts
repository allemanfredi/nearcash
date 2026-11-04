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
 *   NEARCASH_CASSETTE        none                       no NFC reader yet: the ATM is out of service
 *   NEARCASH_DISPENSER       sim                        (the Raspberry's dispenser motor comes next)
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Injection token of the AtmConfig. */
export const ATM_CONFIG = Symbol('ATM_CONFIG');

/** apps/atm, from src/server/config (sources) or dist/server/config (build). */
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

export type AtmConfig = {
  issuance: { url: string; atmToken: string };
  /** Issuer key (compressed, hex) every dispensed card must verify against; undefined: ask the issuance server. */
  trustedIssuerKey: string | undefined;
  /** Plain HTTP on the Pi itself: the kiosk page's server forwards /api here (HTTPS is the page's). */
  http: { host: string; port: number };
  /** When set, the kiosk API answers only a screen that sends it (X-Kiosk-Key). */
  kioskKey: string | undefined;
  /** No NFC reader driver yet (the reader and the cards are on their way). */
  cassette: { kind: 'none' };
  dispenser: { kind: 'sim' };
  /** How often a sale's payment is asked to the issuance server. */
  pollMs: number;
  /** After a quote's deadline, how long to keep trying when the issuance server can't be reached. */
  graceMs: number;
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
  const cassette = env.NEARCASH_CASSETTE ?? 'none';
  if (cassette !== 'none') throw new ConfigurationError(`NEARCASH_CASSETTE=${cassette}: not available yet (only "none", no reader)`);
  const dispenser = env.NEARCASH_DISPENSER ?? 'sim';
  if (dispenser !== 'sim') throw new ConfigurationError(`NEARCASH_DISPENSER=${dispenser}: not available yet (only "sim")`);

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
    cassette: { kind: 'none' },
    dispenser: { kind: 'sim' },
    pollMs: 3_000,
    graceMs: 15 * 60_000,
  };
}
