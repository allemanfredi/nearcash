/**
 * The issuance server's HTTP API through the real Nest application
 * (AppModule), the way an ATM uses it (HttpIssuanceClient): only ATMs with a
 * token get in, errors keep their status, the development routes exist only
 * with simulated payments.
 */
import 'reflect-metadata';
import { DEV_DENOMINATION, HttpIssuanceClient, decodeCertificate, verifyCertificateSignature } from '@nearcash/core';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.ts';
import type { IssuanceConfig } from '../src/config/issuance-config.ts';
import { RefundsService } from '../src/features/refunds/refunds.service.ts';
import { SIMULATED_SENDERS } from '../src/features/refunds/simulated-sender-finder.ts';
import { TEN, cardKeys } from './fakes.ts';

const apps: INestApplication[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

/** A server with the DEV key, the simulated reserve and in-memory sales: its URL. */
async function start(payments: 'simulated' | '1click' = 'simulated'): Promise<string> {
  return (await startApp(payments)).base;
}

async function startApp(payments: 'simulated' | '1click' = 'simulated'): Promise<{ base: string; app: INestApplication }> {
  const config: IssuanceConfig = {
    certificates: { kind: 'dev' },
    payments: { kind: payments, oneClick: { recipientType: 'CONFIDENTIAL_INTENTS' } },
    reserve: { kind: 'simulated' },
    reserveAccountId: 'bank-reserve.far',
    atmTokens: new Map([['secret-1', 'atm-duomo']]),
    paymentWindowMinutes: 30,
    salesFile: undefined,
    refunds: {
      sweepSeconds: 0, // the tests sweep by hand
      watchHours: 24,
      file: undefined,
      rpc: { base: '', arbitrum: '', ethereum: '', solana: '', near: '', nearIndexer: '' },
      simulatedNetworkFee: 1000n,
    },
    http: { host: '127.0.0.1', port: 0 },
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] }).compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return { base: await app.getUrl(), app };
}

describe('HTTP API', () => {
  it('serves ATMs with a token, and nobody else', async () => {
    const base = await start();
    await expect(new HttpIssuanceClient(base, 'wrong').getSale('x')).rejects.toThrow(/401/);
    const anonymous = await fetch(`${base}/issuer`);
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: 'unknown ATM' });
  });

  it('a whole sale, the way an ATM makes it', async () => {
    const base = await start();
    const atm = new HttpIssuanceClient(base, 'secret-1');

    // What an ATM display needs: the banknotes on sale, and whether payments are real.
    expect(await atm.saleDenominations()).toEqual([
      { amount: TEN, symbol: DEV_DENOMINATION.symbol, decimals: DEV_DENOMINATION.decimals },
    ]);
    expect(await atm.denominations()).toEqual([TEN]);
    expect(await atm.info()).toEqual({ simulatedPayments: true });
    expect((await atm.issuer()).name).toMatch(/DEV/);

    const sale = await atm.createSale({ amount: TEN, originAsset: 'base:usdc', refundTo: '0xuser' });
    expect(sale.status).toBe('AWAITING_PAYMENT');
    await expect(atm.issue(sale.id, cardKeys())).rejects.toThrow(/402/); // not paid yet

    await atm.simulatePayment(sale.id);
    expect((await atm.getSale(sale.id)).status).toBe('PAID');
    const certificate = decodeCertificate(await atm.issue(sale.id, cardKeys()));
    expect(verifyCertificateSignature(certificate)).toBe(true);
    expect((await atm.getSale(sale.id)).status).toBe('ISSUED');
  });

  it('bad requests and unknown sales keep their status', async () => {
    const base = await start();
    const headers = { Authorization: 'Bearer secret-1', 'Content-Type': 'application/json' };
    const notAnAmount = await fetch(`${base}/sales`, { method: 'POST', headers, body: JSON.stringify({ amount: 'ten' }) });
    expect(notAnAmount.status).toBe(400);
    expect(await notAnAmount.json()).toEqual({ error: 'amount must be an integer (smallest unit)' });
    expect((await fetch(`${base}/sales/nope`, { headers })).status).toBe(404);
  });

  it('without a refund address, an overpayment goes back to the address that paid (simulated)', async () => {
    const { base, app } = await startApp();
    const atm = new HttpIssuanceClient(base, 'secret-1');
    const sale = await atm.createSale({ amount: TEN, originAsset: 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near' });

    const paid = await fetch(`${base}/dev/sales/${sale.id}/pay`, {
      method: 'POST',
      headers: { Authorization: 'Bearer secret-1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ excess: '25000' }),
    });
    expect(paid.status).toBe(200);

    const refunds = app.get(RefundsService);
    await refunds.sweep(); // the scheduler is off in tests
    expect(refunds.refundsOf(sale.id)).toMatchObject([{ amount: '25000', state: 'sent', sender: SIMULATED_SENDERS.evm }]);
  });

  it('with real payments, the development routes do not exist', async () => {
    const base = await start('1click');
    const response = await fetch(`${base}/dev/sales/x/pay`, { method: 'POST', headers: { Authorization: 'Bearer secret-1' } });
    expect(response.status).toBe(404);
    expect(await new HttpIssuanceClient(base, 'secret-1').info()).toEqual({ simulatedPayments: false });
  });
});
