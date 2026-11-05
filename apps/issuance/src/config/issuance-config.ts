/**
 * The issuance server's configuration: environment variables, read from
 * <repository root>/.env.issuance when present (template:
 * .env.issuance.example), turned into one typed object. Every feature
 * module builds its adapters from it, so each part can be real or
 * simulated independently:
 *
 *   NEARCASH_SIGNER     mpc (default) | dev     who certifies banknotes
 *   NEARCASH_SKIP_MPC   false (default) | true  demos: with the mpc signer, the issuance server
 *                                               signs certificates itself (public DEV key)
 *                                               instead of asking the NEAR MPC network
 *   NEARCASH_PAYMENTS   simulated (default) | 1click
 *   NEARCASH_RESERVE    simulated (default) | far
 *
 * Refunds back to the sender (features/refunds) also read:
 *   NEARCASH_REFUND_SWEEP_SECONDS   how often to look for refunds (default 10 simulated, 60 real; 0: never)
 *   NEARCASH_REFUND_WATCH_HOURS     how long after a sale's deadline (default 24)
 *   NEARCASH_REFUNDS_STORE          file of the refunds sent back (default issuance-refunds.json)
 *   NEARCASH_RPC_BASE / _ARBITRUM / _ETHEREUM / _SOLANA / _NEAR, NEARCASH_NEARBLOCKS_URL
 *                                   where to read who paid (public mainnet endpoints by default)
 *   NEARCASH_SIMULATED_REFUND_FEE   simulated payments: refunds up to this (smallest unit) are "too small"
 */
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IssuerContractLocation, MpcIssuerConfig } from '@nearcash/core';
import type { ChainRpcUrls } from '../features/refunds/chain-sender-finder.ts';
import type { FarReserveConfig } from '../features/reserve/far.reserve.ts';

/** Injection token of the IssuanceConfig. */
export const ISSUANCE_CONFIG = Symbol('ISSUANCE_CONFIG');

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

export type IssuanceConfig = {
  /**
   * Which banknotes exist and who signs their certificates:
   *   mpc       the issuer contract's banknotes, signed by the NEAR MPC network (production);
   *   skip-mpc  the issuer contract's banknotes, signed by the issuance server itself with
   *             the public DEV key (demos: NEARCASH_SKIP_MPC=true);
   *   dev       the DEV key's single test banknote, no issuer contract at all (development).
   */
  certificates:
    | { kind: 'mpc'; mpc: MpcIssuerConfig }
    | { kind: 'skip-mpc'; issuerContract: IssuerContractLocation }
    | { kind: 'dev' };
  /** How customers pay. The 1Click settings are kept even when payments are simulated (the live check uses them). */
  payments: { kind: 'simulated' | '1click'; oneClick: OneClickSettings };
  /** Where the value of each banknote comes from. */
  reserve: { kind: 'simulated' } | { kind: 'far'; far: FarReserveConfig };
  /** The reserve's account inside FAR: recipient of every payment. */
  reserveAccountId: string;
  /** ATMs allowed to use the API: token → ATM name. */
  atmTokens: ReadonlyMap<string, string>;
  /** How long a quote stays payable. */
  paymentWindowMinutes: number;
  /** Where sales are kept (one payment = one card); undefined: in memory only (tests). */
  salesFile: string | undefined;
  /** Refunds back to the address the payment came from. */
  refunds: RefundSettings;
  http: { host: string; port: number };
};

export type RefundSettings = {
  /** How often to look for refunds; 0: never (tests run sweeps by hand). */
  sweepSeconds: number;
  /** How long after a sale's deadline its refunds are still looked for. */
  watchHours: number;
  /** Where the refunds sent back are kept; undefined: in memory only (tests). */
  file: string | undefined;
  /** Where to read who paid, on each chain customers pay from. */
  rpc: ChainRpcUrls;
  /** Simulated payments only: refunds up to this amount (smallest unit) are too small to send back. */
  simulatedNetworkFee: bigint;
};

export type OneClickSettings = {
  baseUrl?: string;
  /** Partner key (JWT): required for CONFIDENTIAL_INTENTS quotes. */
  apiKey?: string;
  userSession?: string;
  recipientType: string;
};

/** A configuration problem, with the variable to fix. */
export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigurationError';
  }
}

/** Reads .env.issuance into the environment (variables already set win). */
export function loadIssuanceEnvironment(): NodeJS.ProcessEnv {
  const file = resolve(repositoryRoot, '.env.issuance');
  if (existsSync(file)) process.loadEnvFile(file);
  return process.env;
}

export function issuanceConfigFromEnvironment(env: NodeJS.ProcessEnv): IssuanceConfig {
  const required = (name: string): string => {
    const value = env[name];
    if (!value) throw new ConfigurationError(`missing ${name} (see .env.issuance.example)`);
    return value;
  };
  const oneOf = <T extends string>(name: string, allowed: readonly T[], fallback: T): T => {
    const value = (env[name] ?? fallback) as T;
    if (!allowed.includes(value)) throw new ConfigurationError(`${name} must be one of ${allowed.join(', ')}`);
    return value;
  };

  const yesNo = (name: string): boolean => {
    const value = (env[name] ?? '').trim().toLowerCase();
    if (value === '' || value === 'false' || value === '0') return false;
    if (value === 'true' || value === '1') return true;
    throw new ConfigurationError(`${name} must be true or false`);
  };

  const signer = oneOf('NEARCASH_SIGNER', ['mpc', 'dev'], 'mpc');
  // NEARCASH_SKIP_MPC only matters with the mpc signer: the dev signer never asks MPC.
  const skipMpc = signer === 'mpc' && yesNo('NEARCASH_SKIP_MPC');
  const issuerContract = (): IssuerContractLocation => ({
    rpcUrl: env.NEARCASH_NEAR_RPC ?? 'https://test.rpc.fastnear.com',
    issuerContractId: required('NEARCASH_ISSUER_CONTRACT'),
  });
  let certificates: IssuanceConfig['certificates'];
  if (signer === 'dev') {
    certificates = { kind: 'dev' };
  } else if (skipMpc) {
    // Only the contract is read (its banknotes): no NEAR account or key is needed.
    certificates = { kind: 'skip-mpc', issuerContract: issuerContract() };
  } else {
    certificates = {
      kind: 'mpc',
      mpc: {
        ...issuerContract(),
        issuanceAccountId: required('NEARCASH_ISSUANCE_ACCOUNT'),
        issuancePrivateKey: required('NEARCASH_ISSUANCE_PRIVATE_KEY') as MpcIssuerConfig['issuancePrivateKey'],
      },
    };
  }

  const reserveKind = oneOf('NEARCASH_RESERVE', ['simulated', 'far'], 'simulated');
  const reserve: IssuanceConfig['reserve'] =
    reserveKind === 'far'
      ? {
          kind: 'far',
          far: {
            contractId: env.NEARCASH_FAR_CONTRACT ?? 'intents.far',
            relayUrl: required('NEARCASH_FAR_RELAY_URL'),
            relayApiKey: env.NEARCASH_FAR_RELAY_API_KEY,
            contractSalt: env.NEARCASH_FAR_CONTRACT_SALT,
            reserveAccountId: required('NEARCASH_RESERVE_ACCOUNT'),
            reservePrivateKey: required('NEARCASH_RESERVE_PRIVATE_KEY') as FarReserveConfig['reservePrivateKey'],
          },
        }
      : { kind: 'simulated' };

  // NEARCASH_ATM_TOKENS=name:token,name:token
  const atmTokens = new Map<string, string>();
  for (const entry of required('NEARCASH_ATM_TOKENS').split(',')) {
    const separator = entry.indexOf(':');
    const name = entry.slice(0, separator).trim();
    const token = entry.slice(separator + 1).trim();
    if (separator <= 0 || !token) throw new ConfigurationError('NEARCASH_ATM_TOKENS must be name:token pairs, comma separated');
    atmTokens.set(token, name);
  }

  const paymentsKind = oneOf('NEARCASH_PAYMENTS', ['simulated', '1click'], 'simulated');
  const wholeNumber = (name: string, fallback: number): number => {
    const value = Number(env[name] ?? fallback);
    if (!Number.isInteger(value) || value < 0) throw new ConfigurationError(`${name} must be a whole number`);
    return value;
  };

  return {
    certificates,
    payments: {
      kind: paymentsKind,
      oneClick: {
        baseUrl: env.NEARCASH_1CLICK_URL,
        apiKey: env.NEARCASH_1CLICK_API_KEY,
        userSession: env.NEARCASH_1CLICK_USER_SESSION,
        recipientType: env.NEARCASH_1CLICK_RECIPIENT_TYPE ?? 'CONFIDENTIAL_INTENTS',
      },
    },
    reserve,
    reserveAccountId: env.NEARCASH_RESERVE_ACCOUNT ?? 'nearcash-reserve',
    atmTokens,
    paymentWindowMinutes: 30,
    salesFile: resolve(repositoryRoot, env.NEARCASH_ISSUANCE_STORE ?? 'issuance-sales.json'),
    refunds: {
      // Simulated refunds are checked more often, so a demo shows them quickly.
      sweepSeconds: wholeNumber('NEARCASH_REFUND_SWEEP_SECONDS', paymentsKind === 'simulated' ? 10 : 60),
      watchHours: wholeNumber('NEARCASH_REFUND_WATCH_HOURS', 24),
      file: resolve(repositoryRoot, env.NEARCASH_REFUNDS_STORE ?? 'issuance-refunds.json'),
      rpc: {
        base: env.NEARCASH_RPC_BASE ?? 'https://mainnet.base.org',
        arbitrum: env.NEARCASH_RPC_ARBITRUM ?? 'https://arb1.arbitrum.io/rpc',
        ethereum: env.NEARCASH_RPC_ETHEREUM ?? 'https://ethereum-rpc.publicnode.com',
        solana: env.NEARCASH_RPC_SOLANA ?? 'https://api.mainnet-beta.solana.com',
        near: env.NEARCASH_RPC_NEAR ?? 'https://free.rpc.fastnear.com',
        nearIndexer: env.NEARCASH_NEARBLOCKS_URL ?? 'https://api.nearblocks.io',
      },
      simulatedNetworkFee: BigInt(wholeNumber('NEARCASH_SIMULATED_REFUND_FEE', 1000)),
    },
    http: {
      // 127.0.0.1 unless told otherwise: in a demo the ATM's Raspberry Pi
      // reaches the server over the LAN (NEARCASH_ISSUANCE_HOST=0.0.0.0). The
      // API needs an ATM token, but it is plain HTTP: production adds TLS.
      host: env.NEARCASH_ISSUANCE_HOST ?? '127.0.0.1',
      port: Number(env.NEARCASH_ISSUANCE_PORT ?? 8790),
    },
  };
}
