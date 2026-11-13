/**
 * The card emulator's side in the ATM server (NEARCASH_CASSETTE=emulator,
 * `pnpm local`) and its configuration. The emulator here is a small HTTP
 * server with the same routes as applet/src/emulator, whose "card" answers
 * every APDU with 9000: what is tested is the ATM's side (the reader's state,
 * the pusher and the turret, a transport bound to one card). The real applet
 * in the real emulator: `pnpm local` then `pnpm local:sale`.
 */
import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { atmConfigFromEnvironment } from '../src/server/config/atm-config.ts';
import { CardEmulator, EmulatedDispenser } from '../src/server/features/hardware/card-emulator.ts';
import { RecordingLog } from './fakes.ts';

/** A stand-in for the card emulator: its reader holds card N, or nothing. */
async function startFakeEmulator(): Promise<{ url: string; server: Server; apdus: string[] }> {
  let made = 0;
  let inReader: number | null = null;
  const apdus: string[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const route = `${request.method} ${url.pathname}`;
      const send = (status: number, text: string) => response.writeHead(status).end(text);
      if (route === 'GET /reader') return send(200, JSON.stringify({ card: inReader }));
      if (route === 'POST /load') {
        if (inReader !== null) return send(409, `the reader already holds card ${inReader}`);
        inReader = ++made;
        return send(200, JSON.stringify({ card: inReader }));
      }
      if (route === 'POST /hand-out') {
        if (inReader === null) return send(409, 'the reader is empty');
        const card = inReader;
        inReader = null;
        return send(200, JSON.stringify({ card }));
      }
      if (route === 'POST /reader/apdu') {
        if (inReader === null || url.searchParams.get('card') !== String(inReader)) return send(409, 'not in the reader');
        apdus.push(`${inReader}:${body}`);
        return send(200, '9000');
      }
      send(404, 'unknown route');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, server, apdus };
}

let running: { server: Server; emulator: CardEmulator } | undefined;
afterEach(() => {
  running?.emulator.stop();
  running?.server.close();
  running = undefined;
});

async function emulatorAndFake() {
  const fake = await startFakeEmulator();
  const emulator = new CardEmulator(fake.url, new RecordingLog());
  await emulator.start();
  running = { server: fake.server, emulator };
  return { emulator, apdus: fake.apdus };
}

describe('the card emulator, as the ATM server sees it', () => {
  it('reports an empty reader, a loaded card, and an empty reader again once the turret hands it out', async () => {
    const { emulator } = await emulatorAndFake();
    const dispenser = new EmulatedDispenser(emulator);
    expect(emulator.choose()).toMatchObject({ ok: true, cardPresent: false });
    await dispenser.load();
    expect(emulator.choose()).toMatchObject({ ok: true, cardPresent: true, cardMute: false });
    await dispenser.dispense();
    expect(emulator.choose()).toMatchObject({ ok: true, cardPresent: false });
  });

  it('sends APDUs to the card in the reader only: a transport stops working once its card is out', async () => {
    const { emulator, apdus } = await emulatorAndFake();
    const dispenser = new EmulatedDispenser(emulator);
    await dispenser.load();
    const transport = emulator.transportToCurrentCard();
    expect([...(await transport.transmit(new Uint8Array([0x80, 0x10, 0, 0, 0])))]).toEqual([0x90, 0x00]);
    await dispenser.dispense();
    await dispenser.load(); // card 2: the old transport must not reach it
    await expect(transport.transmit(new Uint8Array([0x80, 0x10, 0, 0, 0]))).rejects.toThrow(/not in the reader/);
    expect(apdus).toEqual(['1:8010000000']);
  });

  it('says so when the emulator does not answer: the ATM is then out of service', async () => {
    const emulator = new CardEmulator('http://127.0.0.1:9', new RecordingLog()); // nothing listens on port 9
    await emulator.start();
    const choice = emulator.choose();
    emulator.stop();
    expect(choice.ok).toBe(false);
    expect(choice.ok ? '' : choice.reason).toMatch(/card emulator at http:\/\/127\.0\.0\.1:9 does not answer/);
  });
});

describe('the card emulator in the configuration', () => {
  it('takes the emulator as cassette and dispenser together, at its URL', () => {
    const config = atmConfigFromEnvironment({
      NEARCASH_CASSETTE: 'emulator',
      NEARCASH_DISPENSER: 'emulator',
      NEARCASH_CARD_EMULATOR_URL: 'http://127.0.0.1:9999',
    });
    expect(config.cassette).toEqual({ kind: 'emulator', url: 'http://127.0.0.1:9999' });
    expect(config.dispenser).toEqual({ kind: 'emulator', url: 'http://127.0.0.1:9999' });
  });

  it('refuses one without the other', () => {
    expect(() => atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'emulator' })).toThrow(/go together/);
    expect(() => atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'pcsc', NEARCASH_DISPENSER: 'emulator' })).toThrow(/go together/);
  });
});
