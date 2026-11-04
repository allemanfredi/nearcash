/**
 * Client for the NearCash applet: one method per command of
 * docs/protocol.md §5. Every method sends real APDUs through a
 * CardTransport, so the same code runs against any reader (the ATM's NFC
 * reader, or a test transport).
 */
import { ByteReader, concatBytes, uintToBytes, utf8ToBytes } from './bytes.ts';
import {
  APPLET_AID,
  CHALLENGE_LENGTH,
  CLA,
  CardError,
  type CardState,
  DIGEST_LENGTH,
  Ins,
  MAX_CERT_LENGTH,
  PUBLIC_KEY_LENGTH,
  SW,
  isValidPin,
} from './protocol.ts';
import type { CardTransport } from './transport.ts';

/** Parsed INFO response (protocol.md §5.1). */
export type CardInfo = {
  version: number;
  state: CardState;
  pinTriesRemaining: number;
  certificateLength: number;
  /** Uncompressed SEC1 keys; absent while the card is EMPTY. */
  authPublicKey?: Uint8Array;
  fundsPublicKey?: Uint8Array;
};

/** AUTH response (protocol.md §5.3). */
export type AuthResponse = {
  /** State byte the card signed together with the challenge. */
  state: CardState;
  /** DER ECDSA signature by key A over SHA-256(tag ‖ challenge ‖ state). */
  signature: Uint8Array;
};

/** Keys returned by GENERATE_KEYS, uncompressed SEC1. */
export type CardKeys = {
  authPublicKey: Uint8Array;
  fundsPublicKey: Uint8Array;
};

/** Largest GET_CERT chunk we ask for (short APDU: Le ≤ 256). */
const READ_CHUNK = 255;
/** STORE_CERT chunk size (short APDU: Lc ≤ 255). */
const WRITE_CHUNK = 200;

export class NearCashCard {
  readonly transport: CardTransport;

  constructor(transport: CardTransport) {
    this.transport = transport;
  }

  // ------------------------------------------------------------------ commands

  /** SELECT the NearCash applet. Must be the first command after every tap. */
  async select(): Promise<void> {
    await this.exchange('SELECT', buildApdu(0x00, 0xa4, 0x04, 0x00, APPLET_AID));
  }

  /** INFO: version, state, PIN tries, certificate length and public keys. */
  async info(): Promise<CardInfo> {
    const data = await this.command('INFO', Ins.INFO, 0, 0, undefined, 256);
    const reader = new ByteReader(data);
    const info: CardInfo = {
      version: reader.u8(),
      state: reader.u8() as CardState,
      pinTriesRemaining: reader.u8(),
      certificateLength: reader.u16(),
    };
    if (reader.remaining > 0) {
      info.authPublicKey = reader.bytesN(PUBLIC_KEY_LENGTH);
      info.fundsPublicKey = reader.bytesN(PUBLIC_KEY_LENGTH);
    }
    reader.expectEnd('INFO');
    return info;
  }

  /** GET_CERT in chunks until `length` bytes (default: the length INFO reports). */
  async readCertificate(length?: number): Promise<Uint8Array> {
    const total = length ?? (await this.info()).certificateLength;
    const chunks: Uint8Array[] = [];
    let offset = 0;
    while (offset < total) {
      const chunk = await this.command(
        'GET_CERT',
        Ins.GET_CERT,
        offset >> 8,
        offset & 0xff,
        undefined,
        Math.min(READ_CHUNK, total - offset),
      );
      if (chunk.length === 0) throw new Error(`GET_CERT returned no data at offset ${offset}`);
      chunks.push(chunk);
      offset += chunk.length;
    }
    return concatBytes(...chunks);
  }

  /** AUTH: the card signs `challenge` and its state with key A. */
  async auth(challenge: Uint8Array): Promise<AuthResponse> {
    if (challenge.length < 16 || challenge.length > 64) {
      throw new RangeError(`challenge must be 16–64 bytes (we use ${CHALLENGE_LENGTH})`);
    }
    const data = await this.command('AUTH', Ins.AUTH, 0, 0, challenge, 256);
    return { state: data[0] as CardState, signature: data.slice(1) };
  }

  /**
   * SIGN_ONCE: the card signs `digest` with key F and becomes SPENT in the
   * same atomic step. Calling it again with the same digest returns the same
   * signature (safe retry); any other digest is refused forever.
   * Returns the DER signature exactly as the card produced it (may be high-s).
   */
  async signOnce(pin: string, digest: Uint8Array): Promise<Uint8Array> {
    requirePin(pin);
    if (digest.length !== DIGEST_LENGTH) throw new RangeError('digest must be 32 bytes');
    const pinBytes = utf8ToBytes(pin);
    const data = concatBytes(Uint8Array.of(pinBytes.length), pinBytes, digest);
    return this.command('SIGN_ONCE', Ins.SIGN_ONCE, 0, 0, data, 256);
  }

  /** CHANGE_PIN: replace the holder PIN (used right after an exchange). */
  async changePin(oldPin: string, newPin: string): Promise<void> {
    requirePin(oldPin);
    requirePin(newPin);
    const oldBytes = utf8ToBytes(oldPin);
    const newBytes = utf8ToBytes(newPin);
    const data = concatBytes(Uint8Array.of(oldBytes.length), oldBytes, Uint8Array.of(newBytes.length), newBytes);
    await this.command('CHANGE_PIN', Ins.CHANGE_PIN, 0, 0, data);
  }

  // ------------------------------------------------------------------ issuance

  /** GENERATE_KEYS: creates A and F inside the chip (only once per card). */
  async generateKeys(): Promise<CardKeys> {
    const data = await this.command('GENERATE_KEYS', Ins.GENERATE_KEYS, 0, 0, undefined, 256);
    const reader = new ByteReader(data);
    const keys = {
      authPublicKey: reader.bytesN(PUBLIC_KEY_LENGTH),
      fundsPublicKey: reader.bytesN(PUBLIC_KEY_LENGTH),
    };
    reader.expectEnd('GENERATE_KEYS');
    return keys;
  }

  /** STORE_CERT in chunks. The certificate becomes readable after FINALIZE. */
  async storeCertificate(certificate: Uint8Array): Promise<void> {
    if (certificate.length === 0 || certificate.length > MAX_CERT_LENGTH) {
      throw new RangeError(`certificate must be 1–${MAX_CERT_LENGTH} bytes`);
    }
    for (let offset = 0; offset < certificate.length; offset += WRITE_CHUNK) {
      const chunk = certificate.subarray(offset, Math.min(certificate.length, offset + WRITE_CHUNK));
      await this.command('STORE_CERT', Ins.STORE_CERT, offset >> 8, offset & 0xff, chunk);
    }
  }

  /** FINALIZE: freezes the certificate, sets the first PIN, card becomes ISSUED. */
  async finalize(certificateLength: number, pin: string): Promise<void> {
    requirePin(pin);
    const pinBytes = utf8ToBytes(pin);
    const data = concatBytes(uintToBytes(certificateLength, 2), Uint8Array.of(pinBytes.length), pinBytes);
    await this.command('FINALIZE', Ins.FINALIZE, 0, 0, data);
  }

  // ------------------------------------------------------------------ plumbing

  /** Sends a NearCash command (CLA 0x80) and returns its response data. */
  private command(
    name: string,
    ins: number,
    p1: number,
    p2: number,
    data?: Uint8Array,
    expectedLength?: number,
  ): Promise<Uint8Array> {
    return this.exchange(name, buildApdu(CLA, ins, p1, p2, data, expectedLength));
  }

  /** Sends an APDU, checks the status word, strips it from the answer. */
  private async exchange(name: string, apdu: Uint8Array): Promise<Uint8Array> {
    const response = await this.transport.transmit(apdu);
    if (response.length < 2) {
      throw new Error(`${name}: response shorter than a status word`);
    }
    const sw = (response[response.length - 2]! << 8) | response[response.length - 1]!;
    if (sw !== SW.OK) {
      throw new CardError(name, sw);
    }
    return response.slice(0, response.length - 2);
  }
}

/**
 * Encodes a short ISO 7816-4 APDU:
 *   CLA INS P1 P2 [Lc data] [Le]
 * `expectedLength` is Le (1–256; 256 is encoded as 0x00). Omit it when the
 * command returns no data.
 */
export function buildApdu(
  cla: number,
  ins: number,
  p1: number,
  p2: number,
  data?: Uint8Array,
  expectedLength?: number,
): Uint8Array {
  const parts: Uint8Array[] = [Uint8Array.of(cla, ins, p1, p2)];
  if (data && data.length > 0) {
    if (data.length > 255) throw new RangeError('short APDU data must be ≤ 255 bytes');
    parts.push(Uint8Array.of(data.length), data);
  }
  if (expectedLength !== undefined) {
    if (expectedLength < 1 || expectedLength > 256) throw new RangeError('Le must be 1–256');
    parts.push(Uint8Array.of(expectedLength === 256 ? 0x00 : expectedLength));
  }
  return concatBytes(...parts);
}

function requirePin(pin: string): void {
  if (!isValidPin(pin)) {
    throw new RangeError('PIN must be 4–8 digits');
  }
}
