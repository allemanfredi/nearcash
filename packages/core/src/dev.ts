/**
 * DEVELOPMENT ONLY — a fixed, publicly known issuer key, for tests and for
 * test banknotes (the issuance server's NEARCASH_SIGNER=dev), accepted by the
 * wallet in Debug builds only.
 *
 * Its secret is derived from a public string: anyone can forge certificates
 * with it. Never use it for real cards, and never list it as a trusted
 * issuer in a production build.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from './bytes.ts';
import type { Denomination } from './issuance.ts';
import { LocalKeySigner } from './signer.ts';
import type { TrustedIssuer } from './verify.ts';

export const DEV_ISSUER_SECRET_KEY: Uint8Array = sha256(
  utf8ToBytes('NearCash DEV issuer - public on purpose - never use for real cards'),
);

export const DEV_ISSUER: TrustedIssuer = {
  name: 'NearCash DEV issuer (insecure)',
  publicKey: secp256k1.getPublicKey(DEV_ISSUER_SECRET_KEY, true),
};

/** Signs with the public DEV key. Tests and test banknotes only. */
export const DEV_ISSUER_SIGNER = new LocalKeySigner(DEV_ISSUER_SECRET_KEY, DEV_ISSUER.name);

/** A plausible denomination for test banknotes: 0.01 ETH on Intents. */
export const DEV_DENOMINATION: Denomination = {
  amount: 10_000_000_000_000_000n, // 0.01 ETH in wei
  decimals: 18,
  tokenId: 'nep141:eth.omft.near',
  symbol: 'ETH',
  contractId: 'intents.near',
};
