/**
 * NEARCASH_SKIP_MPC=true, for demos: the banknotes are still the issuer
 * contract's, but the issuance server signs their certificates itself with
 * the public DEV key, and never asks the NEAR MPC network.
 */
import 'reflect-metadata';
import {
  DEV_ISSUER,
  HttpIssuanceClient,
  type IssuerContractConfig,
  type IssuerContractReader,
  bytesToHex,
  decodeCertificate,
  verifyCertificateSignature,
} from '@nearcash/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.ts';
import { ConfigurationError, type IssuanceConfig, issuanceConfigFromEnvironment } from '../src/config/issuance-config.ts';
import { CERTIFICATE_AUTHORITY } from '../src/features/certificates/certificate-authority.port.ts';
import { CertificatesService } from '../src/features/certificates/certificates.service.ts';
import { SkipMpcCertificateAuthority } from '../src/features/certificates/skip-mpc-certificate-authority.ts';
import { cardKeys } from './fakes.ts';

/** 5 USDC: the issuer contract's banknote in these tests (not the DEV key's 0.01 ETH). */
const FIVE_USDC = 5_000_000n;

/** A stand-in for the issuer contract's config() view; counts the reads. */
class FakeIssuerContract implements IssuerContractReader {
  reads = 0;
  readonly config: IssuerContractConfig = {
    owner: 'owner.testnet',
    mpc_contract: 'v1.signer-prod.testnet',
    path: 'nearcash-certificates-v1',
    issuer_public_key: '03e38503df708b9f40ee5a6f7669732229bf1feafe4492ccac028e7e2b778337f8', // MPC's: not used here
    token_id: 'nep141:usdc.test',
    symbol: 'USDC',
    decimals: 6,
    funds_contract_id: 'intents.far',
    denominations: [FIVE_USDC.toString(), '10000000'],
    daily_value_cap: '1000000000',
  };

  async contractConfig(): Promise<IssuerContractConfig> {
    this.reads += 1;
    return this.config;
  }
}

describe('NEARCASH_SKIP_MPC in the configuration', () => {
  const base = { NEARCASH_ATM_TOKENS: 'atm-duomo:secret-1' };

  it('needs only the issuer contract: no NEAR account, no key', () => {
    const config = issuanceConfigFromEnvironment({
      ...base,
      NEARCASH_SKIP_MPC: 'true',
      NEARCASH_ISSUER_CONTRACT: 'nearcash-issuer.testnet',
    });
    expect(config.certificates).toEqual({
      kind: 'skip-mpc',
      issuerContract: { rpcUrl: 'https://test.rpc.fastnear.com', issuerContractId: 'nearcash-issuer.testnet' },
    });
  });

  it('is off by default: then MPC needs its account and key', () => {
    expect(() => issuanceConfigFromEnvironment({ ...base, NEARCASH_ISSUER_CONTRACT: 'nearcash-issuer.testnet' })).toThrow(
      /NEARCASH_ISSUANCE_ACCOUNT/,
    );
    for (const off of ['false', '0', '']) {
      expect(() =>
        issuanceConfigFromEnvironment({ ...base, NEARCASH_SKIP_MPC: off, NEARCASH_ISSUER_CONTRACT: 'nearcash-issuer.testnet' }),
      ).toThrow(/NEARCASH_ISSUANCE_ACCOUNT/);
    }
  });

  it('accepts only true or false', () => {
    expect(() => issuanceConfigFromEnvironment({ ...base, NEARCASH_SKIP_MPC: 'yes please' })).toThrow(ConfigurationError);
    expect(issuanceConfigFromEnvironment({ ...base, NEARCASH_SKIP_MPC: '1', NEARCASH_ISSUER_CONTRACT: 'c.testnet' }).certificates.kind).toBe(
      'skip-mpc',
    );
  });

  it('changes nothing with the dev signer, which never asks MPC', () => {
    expect(issuanceConfigFromEnvironment({ ...base, NEARCASH_SIGNER: 'dev', NEARCASH_SKIP_MPC: 'true' }).certificates).toEqual({
      kind: 'dev',
    });
  });
});

describe('the issuance server signs certificates itself', () => {
  it('for the banknotes of the issuer contract, with the public DEV key', async () => {
    const contract = new FakeIssuerContract();
    const authority = new SkipMpcCertificateAuthority(contract);
    const certificates = new CertificatesService(authority);

    expect(await certificates.allowedAmounts()).toEqual([FIVE_USDC, 10_000_000n]);
    const denomination = await certificates.denomination(FIVE_USDC);
    expect(denomination).toMatchObject({ symbol: 'USDC', decimals: 6, tokenId: 'nep141:usdc.test', contractId: 'intents.far' });
    await expect(certificates.denomination(7n)).rejects.toThrow(/not an allowed denomination/);

    const keys = cardKeys();
    const certificate = await certificates.certify({
      authPublicKey: keys.authPublicKey,
      fundsPublicKey: keys.fundsPublicKey,
      amount: denomination.amount,
      decimals: denomination.decimals,
      issuedAt: 1_793_836_800, // a day at 00:00 UTC
      tokenId: denomination.tokenId,
      symbol: denomination.symbol,
      contractId: denomination.contractId,
    });

    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect(bytesToHex(certificate.issuerPublicKey)).toBe(bytesToHex(DEV_ISSUER.publicKey));
    expect(certificates.issuerName).toMatch(/DEV.*MPC skipped/);
    expect(contract.reads).toBe(1); // the contract's config is read once, then cached
  });
});

describe('a whole sale with MPC skipped, through the HTTP API', () => {
  const apps: INestApplication[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('gives the ATM a certificate signed by the key it is told to trust', async () => {
    const config: IssuanceConfig = {
      certificates: { kind: 'skip-mpc', issuerContract: { rpcUrl: 'http://unused.invalid', issuerContractId: 'unused.testnet' } },
      payments: { kind: 'simulated', oneClick: { recipientType: 'CONFIDENTIAL_INTENTS' } },
      reserve: { kind: 'simulated' },
      reserveAccountId: 'bank-reserve.far',
      atmTokens: new Map([['secret-1', 'atm-duomo']]),
      paymentWindowMinutes: 30,
      salesFile: undefined,
      refunds: {
        sweepSeconds: 0,
        watchHours: 24,
        file: undefined,
        rpc: { base: '', arbitrum: '', ethereum: '', solana: '', near: '', nearIndexer: '' },
        simulatedNetworkFee: 1000n,
      },
      http: { host: '127.0.0.1', port: 0 },
    };
    // The real module, with the contract's view answered here instead of by NEAR.
    const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
      .overrideProvider(CERTIFICATE_AUTHORITY)
      .useValue(new SkipMpcCertificateAuthority(new FakeIssuerContract()))
      .compile();
    const app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    const atm = new HttpIssuanceClient(await app.getUrl(), 'secret-1');

    // The ATM learns which key to trust from GET /issuer: the DEV key.
    const issuer = await atm.issuer();
    expect(bytesToHex(issuer.publicKey)).toBe(bytesToHex(DEV_ISSUER.publicKey));
    expect(await atm.saleDenominations()).toEqual([
      { amount: FIVE_USDC, symbol: 'USDC', decimals: 6 },
      { amount: 10_000_000n, symbol: 'USDC', decimals: 6 },
    ]);

    const sale = await atm.createSale({ amount: FIVE_USDC, originAsset: 'base:usdc', refundTo: '0xuser' });
    await atm.simulatePayment(sale.id);
    const certificate = decodeCertificate(await atm.issue(sale.id, cardKeys()));
    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect(bytesToHex(certificate.issuerPublicKey)).toBe(bytesToHex(issuer.publicKey));
    expect(certificate.symbol).toBe('USDC');
    expect((await atm.getSale(sale.id)).status).toBe('ISSUED');
  });
});
