import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import {
  type CertificateFields,
  DEV_ISSUER,
  DEV_ISSUER_SIGNER,
  bytesToHex,
  decodeCertificate,
  formatAmount,
  issueCertificate,
  toLowS,
  verifyCertificateSignature,
} from '../src/index.ts';

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

describe('certificate v1', () => {
  it('round-trips every field and verifies', async () => {
    const fields = sampleFields();
    const certificate = await issueCertificate(fields, DEV_ISSUER_SIGNER);
    const decoded = decodeCertificate(certificate.bytes);

    expect(decoded.amount).toBe(fields.amount);
    expect(decoded.decimals).toBe(18);
    expect(decoded.issuedAt).toBe(fields.issuedAt);
    expect(decoded.tokenId).toBe(fields.tokenId);
    expect(decoded.symbol).toBe('ETH');
    expect(decoded.contractId).toBe('intents.near');
    expect(decoded.issuerPublicKey).toEqual(DEV_ISSUER.publicKey);
    // Keys are stored compressed, whatever encoding was given.
    expect(decoded.authPublicKey.length).toBe(33);
    expect(verifyCertificateSignature(decoded)).toBe(true);
  });

  it('fits comfortably in the 512 bytes the card reserves', async () => {
    expect((await issueCertificate(sampleFields(), DEV_ISSUER_SIGNER)).bytes.length).toBeLessThan(300);
  });

  it('detects any change to the signed body', async () => {
    const certificate = await issueCertificate(sampleFields(), DEV_ISSUER_SIGNER);
    const tampered = certificate.bytes.slice();
    tampered[85] = tampered[85]! ^ 0x01; // last byte of the 16-byte amount
    expect(verifyCertificateSignature(decodeCertificate(tampered))).toBe(false);
  });

  it('rejects bytes that are not a certificate', async () => {
    const certificate = await issueCertificate(sampleFields(), DEV_ISSUER_SIGNER);
    const badMagic = certificate.bytes.slice();
    badMagic[0] = 0x00;
    expect(() => decodeCertificate(badMagic)).toThrow(/magic/);
    expect(() => decodeCertificate(certificate.bytes.slice(0, 100))).toThrow();
  });
});

describe('toLowS', () => {
  it('turns a high-s signature into its low-s twin and leaves low-s ones alone', () => {
    const n = secp256k1.Point.Fn.ORDER;
    const low = secp256k1.Signature.fromBytes(
      secp256k1.sign(new Uint8Array(32).fill(7), secp256k1.utils.randomSecretKey(), { prehash: false, lowS: true, format: 'compact' }),
      'compact',
    );
    const high = new secp256k1.Signature(low.r, n - low.s).toBytes('compact');
    expect(bytesToHex(toLowS(high))).toBe(bytesToHex(low.toBytes('compact')));
    expect(bytesToHex(toLowS(low.toBytes('compact')))).toBe(bytesToHex(low.toBytes('compact')));
  });
});

describe('formatAmount', () => {
  it('prints token amounts without trailing zeros', () => {
    expect(formatAmount(10_000_000_000_000_000n, 18)).toBe('0.01');
    expect(formatAmount(1_500_000n, 6)).toBe('1.5');
    expect(formatAmount(5_000_000n, 6)).toBe('5');
    expect(formatAmount(0n, 6)).toBe('0');
  });
});
