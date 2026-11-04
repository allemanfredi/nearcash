/**
 * NEAR MPC certificate signing, without the network:
 *  - the key derivation is checked against values read from NEAR testnet;
 *  - a fake MPC network answers exactly like the real one (same JSON, same
 *    key derivation, sometimes high-s) to test the whole signing path.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { base58 } from '@scure/base';
import { describe, expect, it } from 'vitest';
import {
  type CertificateFields,
  type IssuerContractConfig,
  MpcCertificateSigner,
  type MpcIssuerClient,
  type SignCertificateArgs,
  bytesToHex,
  deriveMpcPublicKey,
  encodeCertificateBody,
  hexToBytes,
  issueCertificate,
  mpcSignatureToCompact,
  mpcTweak,
  parseNearSecp256k1Key,
  verifyCertificateSignature,
} from '../src/index.ts';

/**
 * Read from v1.signer-prod.testnet on 2026-11-03 (public_key and
 * derived_public_key views). Recorded data: do NOT rename these strings —
 * derivedKey is the answer for exactly this predecessor and path.
 */
const TESTNET = {
  rootKey: 'secp256k1:4NfTiv3UsGahebgTaHyD9vF8KYKMBnfd6kh94mK6xv8fGBiJB8TBtFMP5WWXz6B89Ac1fbpzPwAvoyQebemHFwx3',
  predecessor: 'nearbank-issuer.testnet',
  path: 'nearbank-certificates-v1',
  derivedKey: 'secp256k1:4aJjNZVSEuo5HN1egGNDBzucL3uHQvTMiGDJmyBqqBTk2kueB6urcWrKwGy2bjhjtqPct1j5ecNFkfpkZnqah2g6',
};

const n = secp256k1.Point.Fn.ORDER;

/** NEAR's text form of a secp256k1 public key: "secp256k1:" + base58(X ‖ Y). */
function nearKeyString(compressed: Uint8Array): string {
  return `secp256k1:${base58.encode(secp256k1.Point.fromBytes(compressed).toBytes(false).subarray(1))}`;
}

/**
 * Stands in for MPC + the issuer contract: holds a root secret, derives the
 * per-(predecessor, path) secret like MPC, rebuilds the certificate body
 * from the request like the contract, and answers in MPC's JSON format.
 */
class FakeMpcNetwork implements MpcIssuerClient {
  readonly rootSecret = secp256k1.utils.randomSecretKey();
  readonly predecessor = 'issuer.test';
  readonly path = 'nearcash-certificates-v1';
  /** Return high-s signatures, as a real threshold signer may. */
  highS = false;
  /** The contract's configuration (token, symbol…), as on-chain. */
  config: IssuerContractConfig = {
    owner: 'owner.test',
    mpc_contract: 'v1.signer-prod.testnet',
    path: this.path,
    issuer_public_key: '',
    token_id: 'nep141:eth.omft.near',
    symbol: 'ETH',
    decimals: 18,
    funds_contract_id: 'intents.near',
    denominations: ['10000000000000000'],
    daily_value_cap: '1000000000000000000',
  };

  async contractConfig(): Promise<IssuerContractConfig> {
    return this.config;
  }

  private derivedSecret(): bigint {
    const root = BigInt(`0x${bytesToHex(this.rootSecret)}`);
    return (root + mpcTweak(this.predecessor, this.path)) % n;
  }

  async derivedPublicKey(): Promise<string> {
    const rootPublic = secp256k1.getPublicKey(this.rootSecret, true);
    return nearKeyString(deriveMpcPublicKey(rootPublic, this.predecessor, this.path));
  }

  async signCertificate(args: SignCertificateArgs): Promise<unknown> {
    // Like contracts/issuer: the body is built here, from the request and the config.
    const body = encodeCertificateBody(
      {
        authPublicKey: hexToBytes(args.auth_public_key),
        fundsPublicKey: hexToBytes(args.funds_public_key),
        amount: BigInt(args.amount),
        decimals: this.config.decimals,
        issuedAt: args.issued_at,
        tokenId: this.config.token_id,
        symbol: this.config.symbol,
        contractId: this.config.funds_contract_id,
      },
      parseNearSecp256k1Key(await this.derivedPublicKey()),
    );
    const secret = this.derivedSecret().toString(16).padStart(64, '0');
    const digest = sha256(body);
    let signature = secp256k1.Signature.fromBytes(
      secp256k1.sign(digest, Uint8Array.from(Buffer.from(secret, 'hex')), { prehash: false, lowS: true, format: 'recovered' }),
      'recovered',
    );
    let recovery = signature.recovery!;
    if (this.highS) {
      signature = new secp256k1.Signature(signature.r, n - signature.s);
      recovery ^= 1;
    }
    // R is the point with x = r and the parity given by the recovery bit.
    const bigR = Uint8Array.of(recovery & 1 ? 0x03 : 0x02, ...Buffer.from(signature.r.toString(16).padStart(64, '0'), 'hex'));
    return {
      scheme: 'Secp256k1',
      big_r: { affine_point: bytesToHex(bigR) },
      s: { scalar: signature.s.toString(16).padStart(64, '0') },
      recovery_id: recovery,
    };
  }
}

function sampleFields(): CertificateFields {
  return {
    authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
    amount: 10_000_000_000_000_000n,
    decimals: 18,
    issuedAt: 1_793_707_192,
    tokenId: 'nep141:eth.omft.near',
    symbol: 'ETH',
    contractId: 'intents.near',
  };
}

describe('MPC key derivation', () => {
  it('reproduces the key NEAR testnet derives for our issuer contract', () => {
    const derived = deriveMpcPublicKey(parseNearSecp256k1Key(TESTNET.rootKey), TESTNET.predecessor, TESTNET.path);
    expect(bytesToHex(derived)).toBe(bytesToHex(parseNearSecp256k1Key(TESTNET.derivedKey)));
  });

  it('gives different keys for different contracts or paths', () => {
    const root = parseNearSecp256k1Key(TESTNET.rootKey);
    const reference = bytesToHex(deriveMpcPublicKey(root, TESTNET.predecessor, TESTNET.path));
    expect(bytesToHex(deriveMpcPublicKey(root, 'someone-else.testnet', TESTNET.path))).not.toBe(reference);
    expect(bytesToHex(deriveMpcPublicKey(root, TESTNET.predecessor, 'other-path'))).not.toBe(reference);
  });

  it('parses only secp256k1 keys', () => {
    expect(parseNearSecp256k1Key(TESTNET.rootKey).length).toBe(33);
    expect(() => parseNearSecp256k1Key('ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp')).toThrow();
  });
});

describe('MPC signature format', () => {
  it('rejects answers that are not secp256k1 signatures', () => {
    expect(() => mpcSignatureToCompact({ scheme: 'Ed25519', signature: [] })).toThrow();
    expect(() => mpcSignatureToCompact({ scheme: 'Secp256k1', big_r: { affine_point: '02' }, s: { scalar: '00' } })).toThrow();
  });
});

describe('certificates signed by (a stand-in for) the MPC network', () => {
  for (const highS of [false, true]) {
    it(`are valid and carry the derived key (${highS ? 'high' : 'low'}-s answer)`, async () => {
      const network = new FakeMpcNetwork();
      network.highS = highS;
      const signer = new MpcCertificateSigner(network, 'fake MPC');

      const certificate = await issueCertificate(sampleFields(), signer);

      expect(verifyCertificateSignature(certificate)).toBe(true);
      expect(bytesToHex(certificate.issuerPublicKey)).toBe(bytesToHex(await signer.publicKey()));
    });
  }

  it('refuses a signature made with another key', async () => {
    const network = new FakeMpcNetwork();
    const impostor = new FakeMpcNetwork(); // different root secret
    const signer = new MpcCertificateSigner(
      {
        derivedPublicKey: () => network.derivedPublicKey(),
        contractConfig: () => network.contractConfig(),
        signCertificate: (args) => impostor.signCertificate(args),
      },
      'mismatched MPC',
    );
    await expect(issueCertificate(sampleFields(), signer)).rejects.toThrow(/does not verify/);
  });

  it('refuses to issue when the contract would sign different content', async () => {
    const network = new FakeMpcNetwork();
    network.config = { ...network.config, symbol: 'USDC' }; // the contract's idea of the banknote differs
    await expect(issueCertificate(sampleFields(), new MpcCertificateSigner(network, 'fake MPC'))).rejects.toThrow(
      /does not verify/,
    );
  });

  it('takes token and denominations from the contract', async () => {
    const signer = new MpcCertificateSigner(new FakeMpcNetwork(), 'fake MPC');
    const denomination = await signer.denomination(10_000_000_000_000_000n);
    expect(denomination).toMatchObject({ symbol: 'ETH', decimals: 18, tokenId: 'nep141:eth.omft.near' });
    await expect(signer.denomination(5n)).rejects.toThrow(/not an allowed denomination/);
  });
});
