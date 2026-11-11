/**
 * Certificates signed by the NEAR MPC network (chain signatures).
 *
 * The issuer key is never assembled anywhere: the MPC nodes each hold a
 * share and sign together. Our issuer contract (contracts/issuer) is the
 * only account allowed to request signatures for its key. It accepts
 * requests only from the issuance server, and builds the certificate body itself
 * (allowed denominations, daily cap, issue date rounded to the day).
 *
 *   issuance server ──sign_certificate(card keys, amount, day)──▶ issuer contract ──sign──▶ MPC contract
 *                   ◀──────────── MPC signature (big_r, s, recovery_id) ◀─────────────────┘
 *
 * Facts below were checked in the near/mpc sources (crates/near-mpc-crypto-types,
 * crates/contract) and against NEAR testnet (2026-11-03).
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha3_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';
import { Account, JsonRpcProvider, type KeyPairString } from 'near-api-js';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from './bytes.ts';
import type { Denomination } from './issuance.ts';
import type { CertificateSigner, CertificateSigningRequest } from './signer.ts';

/** Domain 0 of the MPC contract: ECDSA over secp256k1. */
export const MPC_SECP256K1_DOMAIN_ID = 0;

/** Prefix of the key-derivation hash (near/mpc kdf.rs, TWEAK_DERIVATION_PREFIX). */
export const MPC_TWEAK_PREFIX = 'near-mpc-recovery v0.1.0 epsilon derivation:';

/** Derivation path of the NearCash issuer key. Changing it changes the key. */
export const DEFAULT_CERTIFICATE_PATH = 'nearcash-certificates-v1';

/** Gas attached to sign_certificate: the MPC request plus its callback. */
const SIGN_CERTIFICATE_GAS = 300_000_000_000_000n; // 300 Tgas

// ------------------------------------------------------------------ key derivation

/**
 * The tweak MPC adds to its root key for a (predecessor, path) pair:
 * sha3_256(prefix ‖ predecessor ‖ "," ‖ path), read as a big-endian scalar.
 */
export function mpcTweak(predecessor: string, path: string): bigint {
  const hash = sha3_256(utf8ToBytes(`${MPC_TWEAK_PREFIX}${predecessor},${path}`));
  const tweak = BigInt(`0x${bytesToHex(hash)}`);
  if (tweak >= secp256k1.Point.Fn.ORDER) throw new Error('tweak is not a valid scalar');
  return tweak;
}

/**
 * Computes offline the key MPC uses for (predecessor, path):
 * derived = G·tweak + root. Returns it compressed (33 bytes).
 * Lets anyone check which key the issuer contract will sign with.
 */
export function deriveMpcPublicKey(rootPublicKey: Uint8Array, predecessor: string, path: string): Uint8Array {
  const root = secp256k1.Point.fromBytes(rootPublicKey);
  return secp256k1.Point.BASE.multiply(mpcTweak(predecessor, path)).add(root).toBytes(true);
}

/** Parses NEAR's "secp256k1:<base58 of X ‖ Y>" key format into compressed SEC1. */
export function parseNearSecp256k1Key(text: string): Uint8Array {
  const [curve, encoded] = text.split(':');
  if (curve !== 'secp256k1' || !encoded) throw new Error(`not a secp256k1 key: ${text}`);
  const xy = base58.decode(encoded);
  if (xy.length !== 64) throw new Error('a NEAR secp256k1 key must be 64 bytes');
  return secp256k1.Point.fromBytes(concatBytes(Uint8Array.of(0x04), xy)).toBytes(true);
}

// ------------------------------------------------------------------ signature format

/**
 * MPC answers a secp256k1 request with (near-mpc-crypto-types, SignatureResponse):
 *   { "scheme": "Secp256k1",
 *     "big_r": { "affine_point": "<33 bytes hex, compressed R>" },
 *     "s":     { "scalar": "<32 bytes hex>" },
 *     "recovery_id": 0 | 1 }
 * The ECDSA r is the x-coordinate of R. Returns compact r ‖ s.
 */
export function mpcSignatureToCompact(response: unknown): Uint8Array {
  const value = response as {
    scheme?: string;
    big_r?: { affine_point?: string };
    s?: { scalar?: string };
  };
  if (value?.scheme !== 'Secp256k1' || !value.big_r?.affine_point || !value.s?.scalar) {
    throw new Error(`unexpected MPC response: ${JSON.stringify(response)}`);
  }
  const bigR = hexToBytes(value.big_r.affine_point);
  const s = hexToBytes(value.s.scalar);
  if (bigR.length !== 33 || s.length !== 32) throw new Error('MPC response has wrong field sizes');
  return concatBytes(bigR.subarray(1), s); // drop the 02/03 prefix: r = x(R)
}

// ------------------------------------------------------------------ signer

/** Arguments of the issuer contract's sign_certificate (contracts/issuer). */
export type SignCertificateArgs = {
  /** Compressed SEC1 keys of the card, lowercase hex. */
  auth_public_key: string;
  funds_public_key: string;
  /** In the token's smallest unit, decimal string (NEAR's U128). */
  amount: string;
  /** Unix seconds at 00:00 UTC. */
  issued_at: number;
  /** The chip key C, compressed SEC1, lowercase hex (protocol.md §5.8). */
  chip_public_key: string;
  /** The production key's signature over C: compact r ‖ s, hex. */
  birth_signature: string;
  /** C's signature over A and F: compact r ‖ s, hex. */
  keys_signature: string;
};

/** The issuer contract's `config()` view. */
export type IssuerContractConfig = {
  owner: string;
  mpc_contract: string;
  path: string;
  issuer_public_key: string;
  token_id: string;
  symbol: string;
  decimals: number;
  funds_contract_id: string;
  denominations: string[];
  daily_value_cap: string;
  /**
   * The bank's production key (compressed SEC1 hex): it signs every chip's
   * birth certificate (protocol.md §5.8). Absent on contracts deployed
   * before birth certificates.
   */
  production_public_key?: string;
};

/** Reads the issuer contract's configuration (a view call: no account, no key). */
export interface IssuerContractReader {
  /** The issuer contract's configuration. */
  contractConfig(): Promise<IssuerContractConfig>;
}

/** What the signer needs from NEAR. Separate so tests can stand in for the network. */
export interface MpcIssuerClient extends IssuerContractReader {
  /** The MPC key of (issuer contract, path), as NEAR prints it: "secp256k1:…". */
  derivedPublicKey(): Promise<string>;
  /** Calls sign_certificate on the issuer contract; resolves with the MPC SignatureResponse. */
  signCertificate(args: SignCertificateArgs): Promise<unknown>;
}

/**
 * The banknotes the issuer contract allows (token, symbol, decimals,
 * denominations), read from its config() view. The configuration changes
 * rarely: it is read at most once a minute.
 */
export class IssuerContractBanknotes {
  private readonly reader: IssuerContractReader;
  private cached: { value: IssuerContractConfig; readAt: number } | undefined;

  constructor(reader: IssuerContractReader) {
    this.reader = reader;
  }

  /** The issuer contract's configuration (token, denominations, the key it writes into certificates…). */
  async contractConfig(): Promise<IssuerContractConfig> {
    if (!this.cached || Date.now() - this.cached.readAt > 60_000) {
      this.cached = { value: await this.reader.contractConfig(), readAt: Date.now() };
    }
    return this.cached.value;
  }

  /**
   * The denomination of a banknote of `amount` as the contract defines it
   * (token, symbol, decimals, funds contract). Throws if the contract does
   * not allow that amount.
   */
  async denomination(amount: bigint): Promise<Denomination> {
    const config = await this.contractConfig();
    if (!config.denominations.includes(amount.toString())) {
      throw new Error(`${amount} is not an allowed denomination (${config.denominations.join(', ')})`);
    }
    return {
      amount,
      decimals: config.decimals,
      tokenId: config.token_id,
      symbol: config.symbol,
      contractId: config.funds_contract_id,
    };
  }

  /** Allowed amounts, smallest unit. */
  async denominations(): Promise<bigint[]> {
    return (await this.contractConfig()).denominations.map(BigInt);
  }

  /** The production key that gives birth to the bank's chips. Throws if the contract has none. */
  async productionPublicKey(): Promise<Uint8Array> {
    const key = (await this.contractConfig()).production_public_key;
    if (!key) {
      throw new Error(
        'the issuer contract has no production key (it was deployed before birth certificates): ' +
          'migrate it (docs/protocol.md §11), or skip birth certificates for a demo (NEARCASH_SKIP_BIRTH)',
      );
    }
    return hexToBytes(key);
  }
}

/** Certificates signed by the NEAR MPC network, through the issuer contract. */
export class MpcCertificateSigner implements CertificateSigner {
  readonly name: string;
  private readonly client: MpcIssuerClient;
  private readonly banknotes: IssuerContractBanknotes;
  private cachedPublicKey: Uint8Array | undefined;

  constructor(client: MpcIssuerClient, name: string) {
    this.client = client;
    this.name = name;
    this.banknotes = new IssuerContractBanknotes(client);
  }

  async publicKey(): Promise<Uint8Array> {
    this.cachedPublicKey ??= parseNearSecp256k1Key(await this.client.derivedPublicKey());
    return this.cachedPublicKey;
  }

  /**
   * Sends the fields; the contract rebuilds the body and has MPC sign
   * SHA-256 of it. issueCertificate checks the signature against the body
   * built here, so any mismatch with the contract is caught before issuing.
   */
  async sign(request: CertificateSigningRequest): Promise<Uint8Array> {
    const { fields, birth } = request;
    // The contract certifies only keys a born chip vouches for (protocol.md §5.8).
    if (!birth) throw new Error('the issuer contract certifies only cards with a birth certificate');
    return mpcSignatureToCompact(
      await this.client.signCertificate({
        auth_public_key: bytesToHex(fields.authPublicKey),
        funds_public_key: bytesToHex(fields.fundsPublicKey),
        amount: fields.amount.toString(),
        issued_at: fields.issuedAt,
        chip_public_key: bytesToHex(birth.chipPublicKey),
        birth_signature: bytesToHex(birth.birthSignature),
        keys_signature: bytesToHex(birth.keysSignature),
      }),
    );
  }

  /** See IssuerContractBanknotes.denomination. */
  denomination(amount: bigint): Promise<Denomination> {
    return this.banknotes.denomination(amount);
  }

  /** Allowed amounts, smallest unit. */
  denominations(): Promise<bigint[]> {
    return this.banknotes.denominations();
  }

  /** See IssuerContractBanknotes.productionPublicKey. */
  productionPublicKey(): Promise<Uint8Array> {
    return this.banknotes.productionPublicKey();
  }

  /** The issuer contract's configuration (token, denominations, the key it writes into certificates…). */
  contractConfig(): Promise<IssuerContractConfig> {
    return this.banknotes.contractConfig();
  }
}

// ------------------------------------------------------------------ NEAR connection

/** Where the issuer contract is: enough to read it. */
export type IssuerContractLocation = {
  /** NEAR RPC, e.g. https://test.rpc.fastnear.com */
  rpcUrl: string;
  /** Our issuer contract (contracts/issuer); it names the MPC contract and the key path. */
  issuerContractId: string;
};

/** Everything the issuance server needs to reach the MPC network. */
export type MpcIssuerConfig = IssuerContractLocation & {
  /** The issuance server's NEAR account, authorised in the issuer contract as a minter (add_minter). */
  issuanceAccountId: string;
  /** Its key ("ed25519:…"): a function-call key limited to sign_certificate. */
  issuancePrivateKey: KeyPairString;
};

/** Reads the issuer contract over NEAR RPC (near-api-js): no account, no key. */
export class NearIssuerContractReader implements IssuerContractReader {
  private readonly location: IssuerContractLocation;
  private readonly provider: JsonRpcProvider;

  constructor(location: IssuerContractLocation) {
    this.location = location;
    this.provider = new JsonRpcProvider({ url: location.rpcUrl });
  }

  async contractConfig(): Promise<IssuerContractConfig> {
    const config = await this.provider.callFunction<IssuerContractConfig>({
      contractId: this.location.issuerContractId,
      method: 'config',
      args: {},
    });
    if (!config) throw new Error('issuer contract returned no config');
    return config;
  }
}

/** Talks to NEAR with near-api-js: reads the issuer contract, and calls it as the issuance server. */
export class NearMpcIssuerClient implements MpcIssuerClient {
  private readonly config: MpcIssuerConfig;
  private readonly provider: JsonRpcProvider;
  private readonly reader: NearIssuerContractReader;

  constructor(config: MpcIssuerConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider({ url: config.rpcUrl });
    this.reader = new NearIssuerContractReader(config);
  }

  async derivedPublicKey(): Promise<string> {
    // Path and MPC contract come from the issuer contract itself, never from
    // local settings: the key is then always the one the contract writes into
    // certificates (a renamed default path would silently change the key).
    const { path, mpc_contract: mpcContractId } = await this.contractConfig();
    const key = await this.provider.callFunction<string>({
      contractId: mpcContractId,
      method: 'derived_public_key',
      args: {
        path,
        predecessor: this.config.issuerContractId, // the contract asks MPC, so the key is its own
        domain_id: MPC_SECP256K1_DOMAIN_ID,
      },
    });
    if (typeof key !== 'string') throw new Error('derived_public_key returned no key');
    return key;
  }

  contractConfig(): Promise<IssuerContractConfig> {
    return this.reader.contractConfig();
  }

  async signCertificate(args: SignCertificateArgs): Promise<unknown> {
    const account = new Account(this.config.issuanceAccountId, this.provider, this.config.issuancePrivateKey);
    // The transaction resolves only when the MPC nodes have produced the
    // signature (a few seconds): sign_certificate returns MPC's answer.
    return account.callFunction({
      contractId: this.config.issuerContractId,
      methodName: 'sign_certificate',
      args,
      gas: SIGN_CERTIFICATE_GAS,
    });
  }
}

/**
 * Builds the MPC signer from environment variables (.env.issuance):
 *   NEARCASH_ISSUER_CONTRACT    required
 *   NEARCASH_ISSUANCE_ACCOUNT       required
 *   NEARCASH_ISSUANCE_PRIVATE_KEY   required ("ed25519:…")
 *   NEARCASH_NEAR_RPC           default https://test.rpc.fastnear.com
 * The MPC contract and the key path are read from the issuer contract.
 * Returns undefined when the required variables are missing.
 */
export function mpcSignerFromEnvironment(env: Record<string, string | undefined>): MpcCertificateSigner | undefined {
  const issuerContractId = env.NEARCASH_ISSUER_CONTRACT;
  const issuanceAccountId = env.NEARCASH_ISSUANCE_ACCOUNT;
  const issuancePrivateKey = env.NEARCASH_ISSUANCE_PRIVATE_KEY;
  if (!issuerContractId || !issuanceAccountId || !issuancePrivateKey) return undefined;

  const client = new NearMpcIssuerClient({
    rpcUrl: env.NEARCASH_NEAR_RPC ?? 'https://test.rpc.fastnear.com',
    issuerContractId,
    issuanceAccountId,
    issuancePrivateKey: issuancePrivateKey as KeyPairString,
  });
  return new MpcCertificateSigner(client, `NEAR MPC via ${issuerContractId}`);
}
