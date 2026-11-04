import { describe, expect, it } from 'vitest';
import { ByteReader, buildApdu, bytesToHex, bytesToUint, hexToBytes, isValidPin, uintToBytes } from '../src/index.ts';

describe('big-endian integers', () => {
  it('round-trips values of any width', () => {
    expect(bytesToHex(uintToBytes(0x1234, 2))).toBe('1234');
    expect(bytesToHex(uintToBytes(1n, 16))).toBe('00000000000000000000000000000001');
    const big = 2n ** 127n + 12345n;
    expect(bytesToUint(uintToBytes(big, 16))).toBe(big);
  });

  it('refuses values that do not fit', () => {
    expect(() => uintToBytes(256, 1)).toThrow(RangeError);
    expect(() => uintToBytes(-1, 4)).toThrow(RangeError);
  });
});

describe('ByteReader', () => {
  it('reads fields in order and detects truncation and trailing bytes', () => {
    const reader = new ByteReader(hexToBytes('01000203616263'));
    expect(reader.u8()).toBe(1);
    expect(reader.u16()).toBe(2);
    expect(reader.lengthPrefixedUtf8()).toBe('abc');
    expect(() => reader.u8()).toThrow(RangeError);
    reader.expectEnd('test');

    const extra = new ByteReader(hexToBytes('0102'));
    extra.u8();
    expect(() => extra.expectEnd('test')).toThrow(/trailing/);
  });
});

describe('buildApdu (short APDUs)', () => {
  it('encodes the four ISO 7816 cases', () => {
    expect(bytesToHex(buildApdu(0x80, 0x10, 0, 0))).toBe('80100000'); // case 1
    expect(bytesToHex(buildApdu(0x80, 0x10, 0, 0, undefined, 256))).toBe('8010000000'); // case 2, Le=256
    expect(bytesToHex(buildApdu(0x80, 0x42, 1, 2, hexToBytes('aabb')))).toBe('8042010202aabb'); // case 3
    expect(bytesToHex(buildApdu(0x80, 0x20, 0, 0, hexToBytes('aa'), 100))).toBe('8020000001aa64'); // case 4
  });

  it('rejects data that does not fit a short APDU', () => {
    expect(() => buildApdu(0x80, 0x42, 0, 0, new Uint8Array(256))).toThrow(RangeError);
  });
});

describe('isValidPin', () => {
  it('accepts only 4–8 ASCII digits', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('١٢٣٤')).toBe(false); // non-ASCII digits
  });
});
