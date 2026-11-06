/**
 * Writes ios/NearCashWalletTests/Fixtures/redemption-fixtures.json: the
 * values the wallet app's redemption code must reproduce, computed here with
 * the TypeScript implementation (packages/core/src/eth.ts) and @noble.
 * Deterministic (fixed keys, RFC 6979 signatures): running it again gives
 * the same file.
 *
 *   pnpm --filter @nearcash/core exec node scripts/redemption-fixtures.ts
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { p256 } from '@noble/curves/nist.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';
import { erc191Digest, ethereumAddress, toRecoverableSignature } from '../src/eth.ts';
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '../src/bytes.ts';

const sha256 = (bytes: Uint8Array) => new Uint8Array(createHash('sha256').update(bytes).digest());

// --- Keccak-256 around the block size (136 bytes) and on a long input.
const keccakInputs = [0, 3, 135, 136, 137, 272, 500].map((length) =>
  Uint8Array.from({ length }, (_, index) => (index * 7 + 3) & 0xff),
);
keccakInputs[1] = utf8ToBytes('abc');
const keccak = keccakInputs.map((input) => ({ input: bytesToHex(input), hash: bytesToHex(keccak_256(input)) }));

// --- Base58, with leading zero bytes.
const base58Vectors = ['', '00', '0000ff', '61', '626262', '00010203040506070809', 'ffffffffffffffffffffffffffffffff'].map((hex) => ({
  hex,
  text: base58.encode(hexToBytes(hex)),
}));

// --- A transfer intent as 1Click prepares it (shape seen live on 2026-11-06).
const cardSecret = hexToBytes('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318');
const cardPublicKey = secp256k1.getPublicKey(cardSecret, false); // 04 ‖ X ‖ Y
const cardAccount = ethereumAddress(cardPublicKey);
const depositAddress = 'd617174f345a81932be781a26666157325bf6dbde6bbe35061b22b6ec49d6407';
const tokenId = 'nep141:eth-0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48.omft.near';
const payload = JSON.stringify({
  verifying_contract: 'intents.far',
  signer_id: cardAccount,
  deadline: '2026-11-09T09:50:01.000Z',
  nonce: 'Vij2xgDhEPMXAJpJdpVX5hiE8TUyA83420b70e/RNnM=',
  intents: [{
    intent: 'transfer',
    receiver_id: depositAddress,
    tokens: { [`imt:51e8f94d77b5e90dc9852ca6113771e11e8382ce69473a75e313e41665de7cbe:${tokenId}`]: '5000000' },
  }],
});
const digest = erc191Digest(payload);

// The card answers SIGN_ONCE in DER, low-s or high-s: both must give the same 65 bytes.
const curveOrder = secp256k1.Point.Fn.ORDER;
const lowSignature = secp256k1.Signature.fromBytes(secp256k1.sign(digest, cardSecret, { prehash: false, lowS: true }), 'compact');
const highSignature = new secp256k1.Signature(lowSignature.r, curveOrder - lowSignature.s);

// --- The refund passkey (P-256).
const passkeySecret = hexToBytes('c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721');
const passkeyXY = p256.getPublicKey(passkeySecret, false).subarray(1);
const passkeyAccount = '0x' + bytesToHex(keccak_256(concatBytes(utf8ToBytes('p256'), passkeyXY)).subarray(12));
const p256Order = p256.Point.Fn.ORDER;
const signedMessage = utf8ToBytes('authenticatorData ‖ SHA-256(clientDataJSON), for the test');
const p256Low = p256.Signature.fromBytes(p256.sign(sha256(signedMessage), passkeySecret, { prehash: false, lowS: true }), 'compact');
const p256High = new p256.Signature(p256Low.r, p256Order - p256Low.s);

// --- A WebAuthn attestation object carrying that key, CBOR-encoded by hand.
const cborHead = (major: number, value: number) =>
  value < 24 ? Uint8Array.of((major << 5) | value)
    : value < 256 ? Uint8Array.of((major << 5) | 24, value)
      : Uint8Array.of((major << 5) | 25, value >> 8, value & 0xff);
const cborBytes = (bytes: Uint8Array) => concatBytes(cborHead(2, bytes.length), bytes);
const cborText = (text: string) => concatBytes(cborHead(3, utf8ToBytes(text).length), utf8ToBytes(text));
const cborInt = (value: number) => (value >= 0 ? cborHead(0, value) : cborHead(1, -1 - value));
const coseKey = concatBytes(
  cborHead(5, 5),
  cborInt(1), cborInt(2), // kty: EC2
  cborInt(3), cborInt(-7), // alg: ES256
  cborInt(-1), cborInt(1), // crv: P-256
  cborInt(-2), cborBytes(passkeyXY.subarray(0, 32)),
  cborInt(-3), cborBytes(passkeyXY.subarray(32)),
);
const credentialId = Uint8Array.from({ length: 20 }, (_, index) => index + 1);
const authData = concatBytes(
  sha256(utf8ToBytes('wallet.example.com')), // rpIdHash
  Uint8Array.of(0x45), // flags: UP | UV | AT
  new Uint8Array(4), // signCount
  new Uint8Array(16), // aaguid
  Uint8Array.of(0, credentialId.length),
  credentialId,
  coseKey,
);
const attestationObject = concatBytes(
  cborHead(5, 3),
  cborText('fmt'), cborText('none'),
  cborText('attStmt'), cborHead(5, 0),
  cborText('authData'), cborBytes(authData),
);

const fixtures = {
  generatedBy: 'packages/core/scripts/redemption-fixtures.ts',
  keccak,
  base58: base58Vectors,
  card: {
    fundsPublicKey: bytesToHex(cardPublicKey),
    accountId: cardAccount,
  },
  intent: {
    payload,
    depositAddress,
    tokenId,
    amount: '5000000',
    contractId: 'intents.far',
    erc191Digest: bytesToHex(digest),
    derLowS: bytesToHex(lowSignature.toBytes('der')),
    derHighS: bytesToHex(highSignature.toBytes('der')),
    recoverable: bytesToHex(toRecoverableSignature(highSignature.toBytes('der'), digest, cardPublicKey)),
  },
  passkey: {
    publicKey: bytesToHex(passkeyXY),
    accountId: passkeyAccount,
    publicKeyText: 'p256:' + base58.encode(passkeyXY),
    // near/intents' own vector (contracts/defuse/core/src/payload/webauthn.rs, test p256)
    intentsVectorKey: bytesToHex(base58.decode('2V8Np9vGqLiwVZ8qmMmpkxU7CTRqje4WtwFeLimSwuuyF1rddQK5fELiMgxUnYbVjbZHCNnGc6fAe4JeDcVxgj3Q')),
    intentsVectorAccount: '0x3602b546589a8fcafdce7fad64a46f91db0e4d50',
    signedMessage: bytesToHex(signedMessage),
    derHighS: bytesToHex(p256High.toBytes('der')),
    compactLowS: bytesToHex(p256Low.toBytes('compact')),
    attestationObject: bytesToHex(attestationObject),
    credentialId: bytesToHex(credentialId),
  },
};

const target = new URL('../../../ios/NearCashWalletTests/Fixtures/redemption-fixtures.json', import.meta.url);
writeFileSync(target, JSON.stringify(fixtures, null, 2) + '\n');
console.log('wrote', target.pathname);
