/**
 * The ATM server's HTTP API, through the real Nest application (AppModule):
 * only the paired screen may drive the ATM, bodies are checked, errors
 * reach the page as {"error": "…"}. The issuance server and the hardware
 * are test doubles (overridden providers).
 */
import 'reflect-metadata';
import { DEV_ISSUER } from '@nearcash/core';
import { KIOSK_KEY_HEADER } from '@nearcash/kiosk-api';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { AppModule } from '../src/server/app.module.ts';
import type { AtmConfig } from '../src/server/config/atm-config.ts';
import { CASSETTE, DISPENSER } from '../src/server/features/hardware/hardware.ports.ts';
import { ISSUANCE, TRUSTED_ISSUERS } from '../src/server/features/issuance/issuance.port.ts';
import { BANKNOTE, CountingCassette, CountingDispenser, EVM_ADDRESS, FakeIssuance } from './fakes.ts';

const apps: INestApplication[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

async function start(kioskKey?: string): Promise<string> {
  const config: AtmConfig = {
    issuance: { url: 'http://issuance.invalid', atmToken: 'unused' },
    trustedIssuerKey: undefined,
    http: { host: '127.0.0.1', port: 0 },
    kioskKey,
    cassette: { kind: 'none' },
    dispenser: { kind: 'sim' },
    pollMs: 5,
    graceMs: 60_000,
    minStepMs: 0,
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(config)] })
    .overrideProvider(ISSUANCE)
    .useValue(new FakeIssuance())
    .overrideProvider(TRUSTED_ISSUERS)
    .useValue([DEV_ISSUER])
    .overrideProvider(CASSETTE)
    .useValue(new CountingCassette())
    .overrideProvider(DISPENSER)
    .useValue(new CountingDispenser())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.listen(0, '127.0.0.1');
  apps.push(app);
  return app.getUrl();
}

const json = (body: unknown) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('kiosk API', () => {
  it('with a kiosk key, only the paired screen gets in', async () => {
    const base = await start('pairing-key-123');
    const unpaired = await fetch(`${base}/api/setup`);
    expect(unpaired.status).toBe(401);
    expect(await unpaired.json()).toEqual({ error: 'this screen is not paired with the ATM' });
    expect((await fetch(`${base}/api/setup`, { headers: { [KIOSK_KEY_HEADER]: 'wrong' } })).status).toBe(401);
    const paired = await fetch(`${base}/api/setup`, { headers: { [KIOSK_KEY_HEADER]: 'pairing-key-123' } });
    expect(paired.status).toBe(200);
    expect(((await paired.json()) as { banknotes: unknown[] }).banknotes).toHaveLength(1);
  });

  it('no sale: GET /api/session answers JSON null', async () => {
    const base = await start();
    const response = await fetch(`${base}/api/session`);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('null');
  });

  it('starts a sale from JSON, and rejects incomplete requests', async () => {
    const base = await start();
    const incomplete = await fetch(`${base}/api/session`, json({ amount: BANKNOTE.amount.toString() }));
    expect(incomplete.status).toBe(400);
    expect(await incomplete.json()).toEqual({ error: 'paymentOptionId is required' });

    const created = await fetch(
      `${base}/api/session`,
      json({ amount: BANKNOTE.amount.toString(), paymentOptionId: 'eth-ethereum', refundTo: EVM_ADDRESS, pin: '1234' }),
    );
    expect(created.status).toBe(201);
    expect(((await created.json()) as { stage: string }).stage).toBe('awaiting_payment');
    expect(((await (await fetch(`${base}/api/session`)).json()) as { stage: string }).stage).toBe('awaiting_payment');

    // A second sale meanwhile (here without a refund address, which is optional): 409.
    const busy = await fetch(
      `${base}/api/session`,
      json({ amount: BANKNOTE.amount.toString(), paymentOptionId: 'eth-ethereum', pin: '1234' }),
    );
    expect(busy.status).toBe(409);
  });

  it('finish without a sale: 404; unknown routes: 404', async () => {
    const base = await start();
    expect((await fetch(`${base}/api/session/finish`, { method: 'POST' })).status).toBe(404);
    const unknown = await fetch(`${base}/api/nope`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: 'not found' });
  });
});
