import { createRequire } from 'node:module';
import type * as IntentsSdk from '@defuse-protocol/intents-sdk';
import type * as NearApi from 'near-api-js';
import type { Nep413Payload, SignedNep413 } from './reserve.port.ts';

/** "ed25519:…" key string, as near-api-js 5 (the SDK's version) types it. */
export type KeyPairString = Parameters<typeof NearApi.KeyPair.fromString>[0];

/** The reserve's account inside FAR, and FAR's contract. */
export type FarAccount = {
  /** FAR's intents contract id: "intents.far" (docs.near-intents.org, Confidential Intents). */
  contractId: string;
  /**
   * The reserve's account inside FAR: the recipient of every payment, and the
   * signer of every transfer out of the reserve. An implicit account (the hex
   * of its ed25519 public key) needs no registration.
   */
  reserveAccountId: string;
  /** Its key, "ed25519:…". Whoever has it can spend the reserve. */
  reservePrivateKey: KeyPairString;
};

/**
 * The SDK's ESM build has an extension-less deep import of near-api-js that
 * Node rejects; its CommonJS build works. Loaded only when FAR is used, so
 * development with the simulated reserve never touches it.
 */
export function loadFarLibraries(): { sdk: typeof IntentsSdk; near: typeof NearApi } {
  const require = createRequire(import.meta.url);
  return { sdk: require('@defuse-protocol/intents-sdk'), near: require('near-api-js') };
}

/** The implicit NEAR account of an ed25519 key: the 64 lowercase hex digits of its public key. */
export function implicitAccountId(privateKey: KeyPairString): string {
  const { near } = loadFarLibraries();
  return Buffer.from(near.KeyPair.fromString(privateKey).getPublicKey().data).toString('hex');
}

/**
 * The reserve's key, as the Intents SDK's NEP-413 signer (NEP-413: the NEAR
 * message-signing standard that intents use). It signs the transfer intents
 * 1Click prepares for the reserve.
 */
export class ReserveKey {
  readonly accountId: string;
  readonly intentSigner: ReturnType<typeof IntentsSdk.createIntentSignerNearKeyPair>;

  constructor(account: Pick<FarAccount, 'reserveAccountId' | 'reservePrivateKey'>) {
    const { sdk, near } = loadFarLibraries();
    // An implicit account can only be signed for by its own key: catch a
    // mismatched pair at startup, not when the first banknote is funded.
    const implicit = implicitAccountId(account.reservePrivateKey);
    if (/^[0-9a-f]{64}$/.test(account.reserveAccountId) && account.reserveAccountId !== implicit) {
      throw new Error(`NEARCASH_RESERVE_ACCOUNT is an implicit account, but not the one of NEARCASH_RESERVE_PRIVATE_KEY (${implicit})`);
    }
    this.accountId = account.reserveAccountId;
    this.intentSigner = sdk.createIntentSignerNearKeyPair({
      signer: near.KeyPair.fromString(account.reservePrivateKey),
      accountId: account.reserveAccountId,
    });
  }

  /** Signs the payload exactly as given (NEP-413 hash of message, nonce, recipient). */
  async sign(payload: Nep413Payload): Promise<SignedNep413> {
    const signed = await this.intentSigner.signRaw({ payload });
    return { standard: 'nep413', payload, public_key: signed.public_key, signature: signed.signature };
  }
}
