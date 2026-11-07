import { EventEmitter } from 'node:events';
import { CardState } from '@nearcash/core';
import { describe, expect, it } from 'vitest';
import { atmConfigFromEnvironment } from '../src/server/config/atm-config.ts';
import { PcscCassette } from '../src/server/features/hardware/pcsc-cassette.ts';
import { type PcscLibrary, PcscReaders, transmitWithT0Fixups } from '../src/server/features/hardware/pcsc-readers.ts';

// pcsc-lite's flag values, as pcsc-mini exposes them.
const PRESENT = 32;
const MUTE = 512;
const EXCLUSIVE = 128;
const IN_USE = 256;

const SELECT_NEARCASH = '00a4040007f04e42414e4b01';

/** A card that answers SELECT and INFO like the NearCash applet (or not at all, without it). */
class FakeCard {
  hasApplet = true;
  state: number = CardState.EMPTY;
  /** Sends overlapping in time would be a bug: the reader carries one APDU at a time. */
  inFlight = 0;
  maxInFlight = 0;
  received: string[] = [];

  async transmit(command: Uint8Array): Promise<Uint8Array> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    await new Promise((resolve) => setTimeout(resolve, 2));
    this.inFlight -= 1;
    const hex = Buffer.from(command).toString('hex');
    this.received.push(hex);
    if (hex === SELECT_NEARCASH) return this.hasApplet ? Uint8Array.of(0x90, 0x00) : Uint8Array.of(0x6a, 0x82);
    if (hex.startsWith('80100000')) return Uint8Array.of(0x01, this.state, 5, 0x00, 0x00, 0x90, 0x00); // INFO, no keys
    return Uint8Array.of(0x6d, 0x00);
  }

  async disconnect(): Promise<void> {}
}

const status = (raw: number) => ({
  has: (...flags: number[]) => flags.every((flag) => (raw & flag) === flag),
  hasAny: (...flags: number[]) => flags.some((flag) => (raw & flag) === flag),
});

class FakeReader extends EventEmitter {
  card: FakeCard | undefined;
  connects = 0;
  constructor(private readonly readerName: string) {
    super();
  }
  name(): string {
    return this.readerName;
  }
  async connect(): Promise<FakeCard> {
    if (!this.card) throw new Error('no card');
    this.connects += 1;
    return this.card;
  }
  place(card: FakeCard, flags = PRESENT): void {
    this.card = card;
    this.emit('change', status(flags));
  }
  remove(): void {
    this.card = undefined;
    this.emit('change', status(0));
  }
}

/** PC/SC with the readers a test plugs in. */
function fakePcsc() {
  let client: EventEmitter | undefined;
  const library: PcscLibrary = {
    ReaderStatus: { PRESENT, MUTE, EXCLUSIVE },
    CardMode: { SHARED: 2 },
    CardDisposition: { RESET: 1 },
    Client: class extends EventEmitter {
      constructor() {
        super();
        client = this;
      }
      start() {
        return this;
      }
      stop() {}
    } as unknown as PcscLibrary['Client'],
  };
  const plug = (name: string) => {
    const reader = new FakeReader(name);
    client!.emit('reader', reader);
    return reader;
  };
  return { library, plug };
}

function setUp(readerName?: string) {
  const pcsc = fakePcsc();
  const readers = new PcscReaders({ readerName, library: pcsc.library });
  readers.start();
  return { ...pcsc, readers, cassette: new PcscCassette(readers, readerName) };
}

describe('PC/SC cassette', () => {
  it('is out of service without a reader, and without a card on it', async () => {
    const { cassette, plug } = setUp();
    expect(await cassette.unavailableReason()).toBe('no NFC reader is connected');
    plug('ACS ACR122U PICC Interface');
    expect(await cassette.unavailableReason()).toMatch(/no blank card at the NFC reader/);
    await expect(cassette.nextBlankCard()).rejects.toThrow(/no blank card/);
  });

  it('hands out a blank NearCash card', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('ACS ACR122U PICC Interface');
    reader.place(new FakeCard());
    expect(await cassette.unavailableReason()).toBeNull();
    const card = await cassette.nextBlankCard();
    expect((await card.info()).state).toBe(CardState.EMPTY);
    expect(reader.connects).toBe(1); // one connection, reused
  });

  it('refuses a card without the applet, and one that is not blank', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('reader');
    const foreign = new FakeCard();
    foreign.hasApplet = false;
    reader.place(foreign);
    expect(await cassette.unavailableReason()).toMatch(/not a NearCash banknote/);

    reader.remove();
    const issued = new FakeCard();
    issued.state = CardState.ISSUED;
    reader.place(issued);
    expect(await cassette.unavailableReason()).toMatch(/not blank \(it is ISSUED\)/);
  });

  it('never talks to a card put on the reader after the one it handed out', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('reader');
    reader.place(new FakeCard());
    const card = await cassette.nextBlankCard();
    reader.remove();
    const other = new FakeCard();
    reader.place(other);
    await expect(card.info()).rejects.toThrow('the card left the NFC reader');
    expect(other.received).toEqual([]);
  });

  it('keeps its own connection when the card shows "in use", and stops at "exclusive"', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('reader');
    const card = new FakeCard();
    reader.place(card);
    expect(await cassette.unavailableReason()).toBeNull();
    reader.emit('change', status(PRESENT | IN_USE)); // what our own shared connection causes
    expect(await cassette.unavailableReason()).toBeNull();
    expect(reader.connects).toBe(1);
    reader.emit('change', status(PRESENT | EXCLUSIVE));
    expect(await cassette.unavailableReason()).toMatch(/another program holds the card/);
  });

  it('sends one APDU at a time, even when a check and a sale overlap', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('reader');
    const card = new FakeCard();
    reader.place(card);
    const banknote = await cassette.nextBlankCard();
    await Promise.all([banknote.info(), cassette.unavailableReason(), banknote.info(), cassette.unavailableReason()]);
    expect(card.maxInFlight).toBe(1);
  });

  it('needs NEARCASH_READER when several readers are connected', async () => {
    const unnamed = setUp();
    unnamed.plug('Yubico YubiKey OTP+FIDO+CCID');
    unnamed.plug('ACS ACR122U PICC Interface');
    expect(await unnamed.cassette.unavailableReason()).toMatch(/several readers are connected .*NEARCASH_READER/);

    const named = setUp('acr122');
    named.plug('Yubico YubiKey OTP+FIDO+CCID').place(new FakeCard());
    const acr = named.plug('ACS ACR122U PICC Interface');
    expect(await named.cassette.unavailableReason()).toMatch(/no blank card at the NFC reader \(ACS ACR122U/);
    acr.place(new FakeCard());
    expect(await named.cassette.unavailableReason()).toBeNull();
  });

  it('forgets a reader that is unplugged', async () => {
    const { cassette, plug } = setUp();
    const reader = plug('reader');
    reader.place(new FakeCard());
    reader.emit('disconnect');
    expect(await cassette.unavailableReason()).toBe('no NFC reader is connected');
  });
});

describe('T=0 answers in two steps (contact readers)', () => {
  const scripted = (answers: number[][]) => {
    const sent: string[] = [];
    return {
      sent,
      card: {
        async transmit(command: Uint8Array) {
          sent.push(Buffer.from(command).toString('hex'));
          return Uint8Array.from(answers.shift()!);
        },
      },
    };
  };

  it('collects 61 xx with GET RESPONSE', async () => {
    const { card, sent } = scripted([[0x61, 0x02], [0xaa, 0xbb, 0x90, 0x00]]);
    const answer = await transmitWithT0Fixups(card, Uint8Array.of(0x80, 0x10, 0x00, 0x00, 0x00));
    expect(Buffer.from(answer).toString('hex')).toBe('aabb9000');
    expect(sent).toEqual(['8010000000', '00c0000002']);
  });

  it('repeats with the right Le after 6C xx', async () => {
    const { card, sent } = scripted([[0x6c, 0x05], [1, 2, 3, 4, 5, 0x90, 0x00]]);
    const answer = await transmitWithT0Fixups(card, Uint8Array.of(0x80, 0x10, 0x00, 0x00, 0x00));
    expect(Buffer.from(answer).toString('hex')).toBe('01020304059000');
    expect(sent).toEqual(['8010000000', '8010000005']);
  });

  it('leaves a complete answer alone', async () => {
    const { card } = scripted([[0x01, 0x90, 0x00]]);
    expect(Buffer.from(await transmitWithT0Fixups(card, Uint8Array.of(0x80, 0x10, 0, 0, 0))).toString('hex')).toBe('019000');
  });
});

describe('cassette configuration', () => {
  it('reads NEARCASH_CASSETTE and NEARCASH_READER', () => {
    expect(atmConfigFromEnvironment({}).cassette).toEqual({ kind: 'none' });
    expect(atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'pcsc' }).cassette).toEqual({ kind: 'pcsc', readerName: undefined });
    expect(atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'pcsc', NEARCASH_READER: 'ACR122' }).cassette).toEqual({
      kind: 'pcsc',
      readerName: 'ACR122',
    });
    expect(() => atmConfigFromEnvironment({ NEARCASH_CASSETTE: 'usb' })).toThrow(/must be "pcsc"/);
  });
});
