/**
 * Banknote certificate v1 (docs/protocol.md §8).
 *
 * The issuer (the ATM) signs it at issuance and the card stores it as opaque
 * bytes. Anyone can read it with GET_CERT and check, offline, that a trusted
 * issuer vouches for this card's keys, amount and token.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ByteReader, concatBytes, equalBytes, lengthPrefixedUtf8, uintToBytes, utf8ToBytes } from './bytes.ts';
import type { CertificateSigner } from './signer.ts';

export const CERTIFICATE_MAGIC = utf8ToBytes('NBC1');
const COMPRESSED_KEY_LENGTH = 33;
const SIGNATURE_LENGTH = 64;
const AMOUNT_LENGTH = 16; // unsigned 128-bit
const TIMESTAMP_LENGTH = 8; // unsigned 64-bit

/** What the issuer states about a card. */
export type CertificateFields = {
  /** Key A of the card (any SEC1 encoding; stored compressed). */
  authPublicKey: Uint8Array;
  /** Key F of the card (any SEC1 encoding; stored compressed). */
  fundsPublicKey: Uint8Array;
  /** Value in the token's smallest unit (e.g. wei). */
  amount: bigint;
  /** Decimals of the token, to display the amount. */
  decimals: number;
  /** Issuance time, Unix seconds. */
  issuedAt: number;
  /** Intents token id, e.g. "nep141:eth.omft.near". */
  tokenId: string;
  /** Display symbol, e.g. "ETH". */
  symbol: string;
  /** Intents/FAR contract that holds the funds. */
  contractId: string;
};

/** A parsed certificate: the fields plus the issuer key, signature and raw bytes. */
export type Certificate = CertificateFields & {
  /** Issuer public key, compressed SEC1. */
  issuerPublicKey: Uint8Array;
  /** Compact r ‖ s (low-s) ECDSA over SHA-256(body). */
  signature: Uint8Array;
  /** The signed bytes: everything before the signature. */
  body: Uint8Array;
  /** The full encoding stored on the card: body ‖ signature. */
  bytes: Uint8Array;
};

/** Converts any SEC1 public key to its 33-byte compressed form (throws if invalid). */
export function compressPublicKey(publicKey: Uint8Array): Uint8Array {
  return secp256k1.Point.fromBytes(publicKey).toBytes(true);
}

/**
 * Builds a certificate and has it signed by `signer` (for real banknotes:
 * the NEAR MPC network, see mpc.ts).
 *
 * The signature covers SHA-256 of the body, which includes the card's keys
 * A and F: it is valid for that one chip only (protocol.md §8). It is
 * normalised to low-s and checked before being returned, so a bad answer
 * from the signer can never end up on a card.
 */
export async function issueCertificate(fields: CertificateFields, signer: CertificateSigner): Promise<Certificate> {
  const issuerPublicKey = compressPublicKey(await signer.publicKey());
  const normalized: CertificateFields = {
    ...fields,
    authPublicKey: compressPublicKey(fields.authPublicKey),
    fundsPublicKey: compressPublicKey(fields.fundsPublicKey),
  };
  const body = encodeCertificateBody(normalized, issuerPublicKey);
  // If the signer rebuilt a different body (e.g. the issuer contract with
  // another configuration), the check below fails: nothing wrong is issued.
  const signature = toLowS(await signer.sign({ fields: normalized, body }));

  // Parse what we just built: every certificate we issue must be readable…
  const certificate = decodeCertificate(concatBytes(body, signature));
  // …and verifiable by any wallet.
  if (!verifyCertificateSignature(certificate)) {
    throw new Error(`${signer.name} returned a signature that does not verify`);
  }
  return certificate;
}

/**
 * The low-s twin of a compact r ‖ s signature: if s > n/2, s becomes n − s.
 * Both are valid ECDSA signatures; verifiers here accept only the low one.
 */
export function toLowS(compactSignature: Uint8Array): Uint8Array {
  if (compactSignature.length !== SIGNATURE_LENGTH) throw new RangeError('compact signature must be 64 bytes');
  const signature = secp256k1.Signature.fromBytes(compactSignature, 'compact');
  if (!signature.hasHighS()) return compactSignature;
  return new secp256k1.Signature(signature.r, secp256k1.Point.Fn.ORDER - signature.s).toBytes('compact');
}

/** Parses certificate bytes. Throws if the encoding is malformed (not if the signature is wrong). */
export function decodeCertificate(bytes: Uint8Array): Certificate {
  const reader = new ByteReader(bytes);

  const magic = reader.bytesN(CERTIFICATE_MAGIC.length);
  if (!equalBytes(magic, CERTIFICATE_MAGIC)) {
    throw new Error('not a NearCash v1 certificate (bad magic)');
  }
  const authPublicKey = readPublicKey(reader, 'authPublicKey');
  const fundsPublicKey = readPublicKey(reader, 'fundsPublicKey');
  const amount = reader.uint(AMOUNT_LENGTH);
  const decimals = reader.u8();
  const issuedAt = Number(reader.uint(TIMESTAMP_LENGTH));
  const tokenId = reader.lengthPrefixedUtf8();
  const symbol = reader.lengthPrefixedUtf8();
  const contractId = reader.lengthPrefixedUtf8();
  const issuerPublicKey = readPublicKey(reader, 'issuerPublicKey');
  const bodyLength = reader.offset;
  const signature = reader.bytesN(SIGNATURE_LENGTH);
  reader.expectEnd('certificate');

  return {
    authPublicKey,
    fundsPublicKey,
    amount,
    decimals,
    issuedAt,
    tokenId,
    symbol,
    contractId,
    issuerPublicKey,
    signature,
    body: bytes.slice(0, bodyLength),
    bytes: bytes.slice(),
  };
}

/** True if the issuer signature over the certificate body is valid. */
export function verifyCertificateSignature(certificate: Certificate): boolean {
  try {
    return secp256k1.verify(certificate.signature, certificate.body, certificate.issuerPublicKey, {
      prehash: true,
      lowS: true,
      format: 'compact',
    });
  } catch {
    // Malformed signature or key: treat as "not valid", never as a crash.
    return false;
  }
}

/** Seconds in a day: certificates carry the issue date only, never the time. */
const SECONDS_PER_DAY = 86_400;

/**
 * Unix seconds at 00:00 UTC of the day containing `date`. Certificates carry
 * only this, so the time of purchase cannot be read from a banknote.
 */
export function issueDay(date: Date = new Date()): number {
  const seconds = Math.floor(date.getTime() / 1000);
  return seconds - (seconds % SECONDS_PER_DAY);
}

/** Formats `amount` with its decimals, e.g. 1500000000000000000n, 18 → "1.5". */
export function formatAmount(amount: bigint, decimals: number): string {
  const base = 10n ** BigInt(decimals);
  const whole = amount / base;
  const fraction = (amount % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
}

// ------------------------------------------------------------------ internals

/**
 * The signed part of a certificate (everything but the signature), exactly
 * as protocol.md §8 lays it out. The issuer contract rebuilds the same bytes
 * on-chain (contracts/issuer, certificate_body): a shared test vector keeps
 * the two in step.
 */
export function encodeCertificateBody(fields: CertificateFields, issuerPublicKey: Uint8Array): Uint8Array {
  if (!Number.isInteger(fields.decimals) || fields.decimals < 0 || fields.decimals > 255) {
    throw new RangeError('decimals must be an integer 0–255');
  }
  if (!Number.isSafeInteger(fields.issuedAt) || fields.issuedAt < 0) {
    throw new RangeError('issuedAt must be a non-negative integer (Unix seconds)');
  }
  return concatBytes(
    CERTIFICATE_MAGIC,
    compressPublicKey(fields.authPublicKey),
    compressPublicKey(fields.fundsPublicKey),
    uintToBytes(fields.amount, AMOUNT_LENGTH),
    Uint8Array.of(fields.decimals),
    uintToBytes(fields.issuedAt, TIMESTAMP_LENGTH),
    lengthPrefixedUtf8(fields.tokenId),
    lengthPrefixedUtf8(fields.symbol),
    lengthPrefixedUtf8(fields.contractId),
    compressPublicKey(issuerPublicKey),
  );
}

function readPublicKey(reader: ByteReader, name: string): Uint8Array {
  const key = reader.bytesN(COMPRESSED_KEY_LENGTH);
  try {
    secp256k1.Point.fromBytes(key); // throws if not a point on the curve
  } catch {
    throw new Error(`certificate field ${name} is not a valid secp256k1 key`);
  }
  return key;
}
