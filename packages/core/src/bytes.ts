/**
 * Small, explicit helpers for working with bytes.
 *
 * Everything in the NearCash protocol is big-endian (docs/protocol.md §5).
 * Hex, concatenation and UTF-8 come from @noble/hashes so the whole project
 * uses one audited implementation.
 */
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';

export { bytesToHex, concatBytes, hexToBytes, utf8ToBytes };

/** True when both arrays have the same length and the same bytes. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/** Encodes an unsigned integer as exactly `length` big-endian bytes. */
export function uintToBytes(value: bigint | number, length: number): Uint8Array {
  let remaining = BigInt(value);
  const max = 1n << BigInt(8 * length);
  if (remaining < 0n || remaining >= max) {
    throw new RangeError(`${value} does not fit in ${length} unsigned bytes`);
  }
  const out = new Uint8Array(length);
  for (let i = length - 1; i >= 0; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

/** Decodes big-endian unsigned bytes into a bigint. */
export function bytesToUint(bytes: Uint8Array): bigint {
  let value = 0n;
  for (const byte of bytes) {
    value = (value << 8n) | BigInt(byte);
  }
  return value;
}

/** Encodes a UTF-8 string prefixed by its byte length (one byte, so max 255). */
export function lengthPrefixedUtf8(text: string): Uint8Array {
  const bytes = utf8ToBytes(text);
  if (bytes.length > 255) {
    throw new RangeError(`"${text}" is longer than 255 bytes`);
  }
  return concatBytes(Uint8Array.of(bytes.length), bytes);
}

/**
 * Reads a byte array front to back, failing loudly if a field runs past the
 * end. Used to parse card responses and certificates.
 */
export class ByteReader {
  private readonly bytes: Uint8Array;
  private position = 0;

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  /** Number of bytes not read yet. */
  get remaining(): number {
    return this.bytes.length - this.position;
  }

  /** Offset of the next byte to read. */
  get offset(): number {
    return this.position;
  }

  bytesN(length: number): Uint8Array {
    if (length > this.remaining) {
      throw new RangeError(`need ${length} bytes at offset ${this.position}, only ${this.remaining} left`);
    }
    const out = this.bytes.slice(this.position, this.position + length);
    this.position += length;
    return out;
  }

  u8(): number {
    return this.bytesN(1)[0]!;
  }

  u16(): number {
    return Number(bytesToUint(this.bytesN(2)));
  }

  uint(length: number): bigint {
    return bytesToUint(this.bytesN(length));
  }

  /** Reads a one-byte length followed by that many bytes of strict UTF-8. */
  lengthPrefixedUtf8(): string {
    const length = this.u8();
    return new TextDecoder('utf-8', { fatal: true }).decode(this.bytesN(length));
  }

  /** Throws unless every byte has been consumed. */
  expectEnd(what: string): void {
    if (this.remaining !== 0) {
      throw new RangeError(`${what}: ${this.remaining} unexpected trailing bytes`);
    }
  }
}
