import { createRequire } from 'node:module';
import type * as IntentsSdk from '@defuse-protocol/intents-sdk';
import type { IntentPrimitive, IntentsSDK } from '@defuse-protocol/intents-sdk';
import type * as NearApi from 'near-api-js';
import type { CardFunding, Nep413Payload, Reserve, SignedNep413 } from './reserve.port.ts';

/** "ed25519:…" key string, as near-api-js 5 (the SDK's version) types it. */
type KeyPairString = Parameters<typeof NearApi.KeyPair.fromString>[0];

/**
 * The SDK's ESM build has an extension-less deep import of near-api-js that
 * Node rejects; its CommonJS build works. Loaded only when FAR is used, so
 * development with the simulated reserve never touches it.
 */
function loadFarLibraries(): { sdk: typeof IntentsSdk; near: typeof NearApi } {
  const require = createRequire(import.meta.url);
  return { sdk: require('@defuse-protocol/intents-sdk'), near: require('near-api-js') };
}

export type FarReserveConfig = {
  /** FAR's intents contract id: "intents.far" (docs.near-intents.org, Confidential Intents). */
  contractId: string;
  /** FAR's private relay: invite-only, URL from the Defuse team. */
  relayUrl: string;
  /** Partner key for the private relay ("same Partner JWT authentication as the public relay"). */
  relayApiKey?: string;
  /**
   * Static salt of FAR's contract (a private chain cannot be read for it), hex.
   * The docs' example uses "e110f317" (PRIVATE_INTENTS_CONTRACT_SALT); confirm with Defuse.
   */
  contractSalt?: string;
  /** The reserve's account inside FAR and its key ("ed25519:…"). */
  reserveAccountId: string;
  reservePrivateKey: KeyPairString;
};

/**
 * Transfers inside FAR with the Intents SDK, configured for a private
 * environment (custom contract, relay and static salt). Inside FAR tokens
 * are IMT ids, "imt:<account>:nep141:<token>": the banknote's token id in
 * the issuer contract must be that id.
 *
 * NOT TESTED against FAR yet: the private relay is invite-only.
 */
export class FarReserve implements Reserve {
  readonly name = 'FAR reserve';
  private readonly sdk: IntentsSDK;
  /** The reserve's key, as the SDK's NEP-413 signer: signs the SDK's own intents and 1Click's. */
  private readonly signer: ReturnType<typeof IntentsSdk.createIntentSignerNearKeyPair>;

  constructor(config: FarReserveConfig) {
    const { sdk, near } = loadFarLibraries();
    this.signer = sdk.createIntentSignerNearKeyPair({
      signer: near.KeyPair.fromString(config.reservePrivateKey),
      accountId: config.reserveAccountId,
    });
    this.sdk = new sdk.IntentsSDK({
      env: {
        contractID: config.contractId,
        contractSalt: config.contractSalt,
        solverRelayBaseURL: config.relayUrl,
        // Not used by plain transfers.
        poaTokenFactoryContractID: '',
        poaBridgeBaseURL: '',
        managerConsoleBaseURL: '',
        bridgeIndexerURL: '',
        nearIntentsBaseURL: '',
      },
      intentSigner: this.signer,
      solverRelayApiKey: config.relayApiKey,
      referral: 'nearcash',
    });
  }

  async fundCard(funding: CardFunding): Promise<string> {
    const transfer: IntentPrimitive = {
      intent: 'transfer',
      receiver_id: funding.cardAccountId,
      tokens: { [funding.tokenId]: funding.amount.toString() },
    };
    const { intentHash } = await this.sdk.signAndSendIntent({ intents: [transfer] });
    await this.sdk.waitForIntentSettlement({ intentHash, signal: AbortSignal.timeout(120_000) });
    return intentHash;
  }

  async signIntent(payload: Nep413Payload): Promise<SignedNep413> {
    // signRaw signs the payload exactly as given (NEP-413 hash of message, nonce, recipient).
    const signed = await this.signer.signRaw({ payload });
    return { standard: 'nep413', payload, public_key: signed.public_key, signature: signed.signature };
  }
}
