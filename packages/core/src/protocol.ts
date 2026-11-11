/**
 * Constants of the NearCash card protocol. They mirror docs/protocol.md and
 * applet/src/main/java/xyz/nektarlabs/nearcash/NearCashApplet.java exactly.
 */
import { hexToBytes, utf8ToBytes } from './bytes.ts';

/** Applet AID (protocol.md §3). Also listed in the iOS app's Info.plist. */
export const APPLET_AID = hexToBytes('F04E42414E4B01');

/** Proprietary class byte used by every NearCash command. */
export const CLA = 0x80;

/** Instruction bytes (protocol.md §5). */
export const Ins = {
  INFO: 0x10,
  GET_CERT: 0x12,
  GET_BIRTH: 0x14,
  AUTH: 0x20,
  SIGN_ONCE: 0x30,
  CHANGE_PIN: 0x32,
  GENERATE_KEYS: 0x40,
  STORE_CERT: 0x42,
  FINALIZE: 0x44,
  CHIP_KEY: 0x50,
  STORE_BIRTH: 0x52,
} as const;

/** Card life-cycle states (protocol.md §4). They only move forward. */
export const CardState = {
  EMPTY: 0x00,
  KEYS_GENERATED: 0x01,
  ISSUED: 0x02,
  SPENT: 0x03,
} as const;
export type CardState = (typeof CardState)[keyof typeof CardState];

/** Human-readable name of a state, for logs and errors. */
export function cardStateName(state: number): string {
  const entry = Object.entries(CardState).find(([, value]) => value === state);
  return entry ? entry[0] : `UNKNOWN(0x${state.toString(16)})`;
}

/** Status words the card can return (protocol.md §6). */
export const SW = {
  OK: 0x9000,
  WRONG_LENGTH: 0x6700,
  WRONG_DATA: 0x6a80,
  FILE_FULL: 0x6a84,
  WRONG_P1P2: 0x6b00,
  CONDITIONS_NOT_SATISFIED: 0x6985,
  PIN_BLOCKED: 0x6983,
  INS_NOT_SUPPORTED: 0x6d00,
  CLA_NOT_SUPPORTED: 0x6e00,
} as const;

export const PROTOCOL_VERSION = 0x02;
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;
export const PIN_TRY_LIMIT = 5;
export const MAX_CERT_LENGTH = 512;
export const DIGEST_LENGTH = 32;
export const CHALLENGE_LENGTH = 32;
/** Uncompressed SEC1 public key length, as the card sends keys. */
export const PUBLIC_KEY_LENGTH = 65;

/** Prefix of every AUTH message (protocol.md §5.3). */
export const AUTH_DOMAIN_TAG = utf8ToBytes('NBK-AUTH-v1');

/** Prefix of the birth message the production key signs (protocol.md §5.8). */
export const BIRTH_DOMAIN_TAG = utf8ToBytes('NBK-BIRTH-v1');

/** Prefix of the keys message the chip key C signs at GENERATE_KEYS (protocol.md §5.8). */
export const KEYS_DOMAIN_TAG = utf8ToBytes('NBK-KEYS-v1');

/** The birth signature: compact r ‖ s (protocol.md §5.8). */
export const BIRTH_SIGNATURE_LENGTH = 64;

/** True if `pin` is 4–8 ASCII digits, the only PINs the card accepts. */
export function isValidPin(pin: string): boolean {
  return new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

/** The card answered with a status word other than 9000. */
export class CardError extends Error {
  /** Status word, e.g. 0x6985. */
  readonly sw: number;
  /** Name of the command that failed, e.g. "SIGN_ONCE". */
  readonly command: string;

  constructor(command: string, sw: number) {
    super(`${command} failed: ${describeStatusWord(sw)} (SW ${sw.toString(16).toUpperCase().padStart(4, '0')})`);
    this.name = 'CardError';
    this.command = command;
    this.sw = sw;
  }

  /** Tries left when the PIN was wrong (SW 63Cx), 0 when blocked, otherwise undefined. */
  get pinTriesLeft(): number | undefined {
    if ((this.sw & 0xfff0) === 0x63c0) return this.sw & 0x000f;
    if (this.sw === SW.PIN_BLOCKED) return 0;
    return undefined;
  }
}

/** English description of a status word (protocol.md §6). */
export function describeStatusWord(sw: number): string {
  if ((sw & 0xfff0) === 0x63c0) return `wrong PIN, ${sw & 0x000f} attempts left`;
  switch (sw) {
    case SW.OK:
      return 'OK';
    case SW.WRONG_LENGTH:
      return 'wrong length';
    case SW.WRONG_DATA:
      return 'wrong data';
    case SW.FILE_FULL:
      return 'certificate too large';
    case SW.WRONG_P1P2:
      return 'offset out of range';
    case SW.CONDITIONS_NOT_SATISFIED:
      return 'not allowed in the current card state';
    case SW.PIN_BLOCKED:
      return 'PIN blocked';
    case SW.INS_NOT_SUPPORTED:
      return 'unknown instruction';
    case SW.CLA_NOT_SUPPORTED:
      return 'unknown class';
    default:
      return 'unexpected status';
  }
}
