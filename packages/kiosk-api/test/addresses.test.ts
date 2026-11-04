import { describe, expect, it } from 'vitest';
import { refundAddressProblem, toChecksumAddress } from '../src/addresses.ts';

describe('refund addresses', () => {
  it('EVM: 0x + 40 hex, and a mixed-case address must match its EIP-55 checksum', () => {
    // The examples from EIP-55.
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe('0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed');
    expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe('0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359');

    expect(refundAddressProblem('evm', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toBeNull();
    expect(refundAddressProblem('evm', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBeNull(); // no checksum
    expect(refundAddressProblem('evm', '0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).toMatch(/typo/); // one letter flipped
    expect(refundAddressProblem('evm', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeA')).toMatch(/40 hex/);
    expect(refundAddressProblem('evm', 'alice.near')).not.toBeNull();
  });

  it('Solana: a 32-byte key in base58', () => {
    expect(refundAddressProblem('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBeNull();
    expect(refundAddressProblem('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4w')).not.toBeNull(); // too short: 24 bytes
    expect(refundAddressProblem('solana', 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTD0O1')).not.toBeNull(); // 0 and O aren't base58
    expect(refundAddressProblem('solana', '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed')).not.toBeNull();
  });

  it('NEAR: named and implicit accounts', () => {
    expect(refundAddressProblem('near', 'alice.near')).toBeNull();
    expect(refundAddressProblem('near', 'my_wallet-1.tg')).toBeNull();
    expect(refundAddressProblem('near', 'a'.repeat(64).replace(/a/g, 'f'))).toBeNull(); // 64 hex
    expect(refundAddressProblem('near', '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBeNull();
    expect(refundAddressProblem('near', 'Alice.near')).not.toBeNull(); // uppercase
    expect(refundAddressProblem('near', 'bad..near')).not.toBeNull();
    expect(refundAddressProblem('near', '-bad.near')).not.toBeNull();
    expect(refundAddressProblem('near', 'x')).not.toBeNull(); // too short
  });

  it('an empty address is never accepted', () => {
    expect(refundAddressProblem('evm', '')).not.toBeNull();
  });
});
