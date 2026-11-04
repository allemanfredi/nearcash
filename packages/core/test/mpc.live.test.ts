/**
 * LIVE test against NEAR testnet: the real MPC network signs a certificate
 * through our issuer contract. Skipped unless an ATM is configured:
 *
 *     pnpm test:mpc-live      (from the repository root; reads .env.issuance)
 *
 * (variables: see mpcSignerFromEnvironment in src/mpc.ts)
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';
import {
  bytesToHex,
  issueCertificate,
  issueDay,
  mpcSignerFromEnvironment,
  verifyCertificateSignature,
} from '../src/index.ts';

const signer = mpcSignerFromEnvironment(process.env);

describe.skipIf(!signer)('certificate signed by the real NEAR MPC network', () => {
  it('verifies with the issuer key derived for our contract', async () => {
    // The contract defines the banknote: take its first allowed denomination.
    const denomination = await signer!.denomination((await signer!.denominations())[0]!);
    const certificate = await issueCertificate(
      {
        authPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
        fundsPublicKey: secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), false),
        amount: denomination.amount,
        decimals: denomination.decimals,
        issuedAt: issueDay(),
        tokenId: denomination.tokenId,
        symbol: denomination.symbol,
        contractId: denomination.contractId,
      },
      signer!,
    );
    expect(verifyCertificateSignature(certificate)).toBe(true);
    console.log(`MPC issuer key: ${bytesToHex(certificate.issuerPublicKey)}`);
  }, 120_000);
});
