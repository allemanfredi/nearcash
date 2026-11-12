/**
 * The NFC readers connected to this machine, through PC/SC: the standard
 * smart-card interface (pcscd on Linux, built into macOS). Any PC/SC reader
 * works (ACR122U, ACR1252U, Identiv…): the card's APDUs go through unchanged.
 *
 * The binding is pcsc-mini, whose prebuilt binaries cover the Raspberry Pi
 * (64-bit Raspberry Pi OS) and macOS, so nothing is compiled on the Pi.
 * It is loaded only when a reader is configured (NEARCASH_CASSETTE=pcsc).
 *
 * This file is also run directly by Node (src/reader-cli.ts), so it uses
 * only TypeScript that Node can strip: no parameter properties, no enums.
 */
import { createRequire } from 'node:module';
import type { CardTransport } from '@nearcash/core';

// ---------------------------------------------------------------- the PC/SC binding, narrowed

/** The few pcsc-mini constants used here (the values are pcsc-lite's). */
export type PcscConstants = {
  ReaderStatus: { PRESENT: number; MUTE: number; EXCLUSIVE: number };
  CardMode: { SHARED: number };
  CardDisposition: { RESET: number };
};

/** The parts of pcsc-mini used here: what a test fake implements. */
export type PcscLibrary = PcscConstants & {
  Client: new () => PcscClient;
};

export interface PcscClient {
  on(event: 'reader', listener: (reader: PcscReader) => void): this;
  on(event: 'error', listener: (error: unknown) => void): this;
  start(): this;
  stop(): void;
}

export interface PcscReader {
  name(): string;
  on(event: 'change', listener: (status: { has(...flags: number[]): boolean; hasAny(...flags: number[]): boolean }) => void): this;
  on(event: 'disconnect', listener: () => void): this;
  connect(mode: number): Promise<PcscCard>;
}

export interface PcscCard {
  transmit(command: Uint8Array): Promise<Uint8Array>;
  disconnect(then: number): Promise<void>;
}

/** Loads pcsc-mini (CommonJS, with a native addon), or explains why it can't be. */
export function loadPcscLibrary(): PcscLibrary {
  try {
    return createRequire(import.meta.url)('pcsc-mini') as PcscLibrary;
  } catch (error) {
    const reason = error instanceof Error ? error.message.split('\n')[0] : String(error);
    throw new Error(`the PC/SC library cannot be loaded on ${process.platform}-${process.arch} (${reason})`);
  }
}

// ---------------------------------------------------------------- readers and cards

/** One reader and what is on it. */
type ReaderState = {
  reader: PcscReader;
  /** A card is in the reader's field and answering. */
  present: boolean;
  /** A card is in the reader but didn't answer when PC/SC powered it (MUTE): see wakeCard(). */
  mute: boolean;
  /** Another program holds the card exclusively: nobody else can talk to it. */
  heldElsewhere: boolean;
  /**
   * Changes every time a card arrives or leaves. A transport remembers the
   * value it was made with, so it never talks to a card put there later.
   */
  generation: number;
  /** The open connection to the card in the field, made on first use. */
  connection: Promise<PcscCard> | undefined;
};

/** A reader chosen to work with, or why there is none. */
export type ReaderChoice =
  | { ok: true; name: string; cardPresent: boolean; cardMute: boolean; heldElsewhere: boolean }
  | { ok: false; reason: string };

export class PcscReaders {
  private readonly library: PcscLibrary;
  /** Part of the reader's name to look for; undefined: the only reader. */
  private readonly readerName: string | undefined;
  private readonly onEvent: (message: string) => void;
  private readonly readers = new Map<string, ReaderState>();
  private client: PcscClient | undefined;
  /** Why PC/SC itself is not working (e.g. pcscd not running), if it isn't. */
  private serviceProblem: string | undefined;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  /** One APDU at a time on the wire, whoever sends it. */
  private queue: Promise<unknown> = Promise.resolve();

  /**
   * @param readerName part of the NFC reader's name (case-insensitive), needed
   *                   when several readers are connected (a YubiKey is one too)
   * @param onEvent    where to report readers and cards coming and going
   */
  constructor(options: { readerName?: string; library: PcscLibrary; onEvent?: (message: string) => void }) {
    this.library = options.library;
    this.readerName = options.readerName?.toLowerCase() || undefined;
    this.onEvent = options.onEvent ?? (() => {});
  }

  start(): void {
    this.serviceProblem = undefined;
    const client = new this.library.Client();
    this.client = client;
    client.on('reader', (reader) => this.track(reader));
    client.on('error', (error) => {
      // Typically pcscd stopped or is not installed. Try again in a while:
      // the readers come back as new "reader" events.
      this.serviceProblem = `the PC/SC service is not available (${error instanceof Error ? error.message : String(error)}); is pcscd running?`;
      this.onEvent(this.serviceProblem);
      this.readers.clear();
      client.stop();
      this.restartTimer = setTimeout(() => this.start(), 5_000);
    });
    client.start();
  }

  /**
   * Waits for PC/SC's first report: the readers already connected (and the
   * cards on them) arrive as events just after `start()`. Without this, a
   * check right at startup would wrongly find no reader.
   */
  async firstScan(waitMs = 1_000): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  stop(): void {
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.client?.stop();
    this.client = undefined;
    for (const state of this.readers.values()) this.dropConnection(state);
    this.readers.clear();
  }

  /** Names of every connected reader. */
  names(): string[] {
    return [...this.readers.keys()];
  }

  /** The reader to use: the one whose name matches, or the only one. */
  choose(): ReaderChoice {
    if (this.serviceProblem) return { ok: false, reason: this.serviceProblem };
    const state = this.chosen();
    if (typeof state === 'string') return { ok: false, reason: state };
    return { ok: true, name: state.reader.name(), cardPresent: state.present, cardMute: state.mute, heldElsewhere: state.heldElsewhere };
  }

  /**
   * Has PC/SC power a MUTE card again. PC/SC powers a card once, the moment
   * the reader's slot switch closes: a card pushed in slowly (the pusher) can
   * still be short of the contacts then, and stays MUTE even once it is all
   * the way in. Connecting to it makes PC/SC power it again, where it is now;
   * if it answers, the reader reports it present (its 'change'). Rejects when
   * it still doesn't answer.
   */
  async wakeCard(): Promise<void> {
    const state = this.chosen();
    if (typeof state === 'string') throw new Error(state);
    const card = await state.reader.connect(this.library.CardMode.SHARED);
    await card.disconnect(this.library.CardDisposition.RESET).catch(() => {});
  }

  /**
   * A transport to the card now on the chosen reader. It stops working (it
   * throws) as soon as that card leaves the field, even if another card is
   * put there: it never sends an APDU to a different card.
   */
  transportToCurrentCard(): CardTransport {
    const state = this.chosen();
    if (typeof state === 'string') throw new Error(state);
    if (!state.present) throw new Error('no card at the NFC reader');
    const generation = state.generation;
    return { transmit: (command) => this.transmit(state, generation, command) };
  }

  // ---------------------------------------------------------------- internals

  private chosen(): ReaderState | string {
    const all = [...this.readers.values()];
    if (this.readerName) {
      const match = all.filter((state) => state.reader.name().toLowerCase().includes(this.readerName!));
      if (match.length === 1) return match[0]!;
      if (match.length === 0) return `no connected reader's name contains "${this.readerName}" (connected: ${this.listForHumans()})`;
      return `several readers' names contain "${this.readerName}": ${match.map((state) => state.reader.name()).join(', ')}`;
    }
    if (all.length === 1) return all[0]!;
    if (all.length === 0) return 'no NFC reader is connected';
    return `several readers are connected (${this.listForHumans()}): set NEARCASH_READER to part of the NFC reader's name`;
  }

  private listForHumans(): string {
    return this.names().join(', ') || 'none';
  }

  private track(reader: PcscReader): void {
    const state: ReaderState = { reader, present: false, mute: false, heldElsewhere: false, generation: 0, connection: undefined };
    this.readers.set(reader.name(), state);
    this.onEvent(`reader connected: ${reader.name()}`);
    const { PRESENT, MUTE, EXCLUSIVE } = this.library.ReaderStatus;

    reader.on('change', (status) => {
      // A card that does not answer (MUTE) is as good as no card. "In use"
      // is not checked: our own shared connection sets it.
      const present = status.has(PRESENT) && !status.has(MUTE);
      state.mute = status.has(PRESENT) && status.has(MUTE);
      state.heldElsewhere = present && status.has(EXCLUSIVE);
      if (present === state.present) return;
      this.dropConnection(state);
      state.present = present;
      state.generation += 1;
      this.onEvent(present ? `card placed on ${reader.name()}` : `card removed from ${reader.name()}`);
    });
    reader.on('disconnect', () => {
      this.dropConnection(state);
      state.present = false;
      state.mute = false;
      state.generation += 1;
      this.readers.delete(reader.name());
      this.onEvent(`reader disconnected: ${reader.name()}`);
    });
  }

  private transmit(state: ReaderState, generation: number, command: Uint8Array): Promise<Uint8Array> {
    const run = async (): Promise<Uint8Array> => {
      if (state.generation !== generation || !state.present) throw new Error('the card left the NFC reader');
      if (!state.connection) {
        state.connection = state.reader.connect(this.library.CardMode.SHARED).catch((error: unknown) => {
          // pcsc-mini names the PC/SC error (e.g. SharingViolation) in `name`.
          const why = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
          throw new Error(`cannot connect to the card (${why})`);
        });
        // A failed connection is not kept: the next APDU tries again.
        state.connection.catch(() => {
          if (state.generation === generation) state.connection = undefined;
        });
      }
      const card = await state.connection;
      return transmitWithT0Fixups(card, command);
    };
    // Chain on the queue whatever the previous APDU's outcome was.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  private dropConnection(state: ReaderState): void {
    const connection = state.connection;
    state.connection = undefined;
    // RESET: the next connection starts from a freshly reset card.
    void connection?.then((card) => card.disconnect(this.library.CardDisposition.RESET)).catch(() => {});
  }
}

/**
 * Sends one command and returns its complete answer (data ‖ SW1 SW2).
 *
 * Over NFC (ISO 14443-4) a card answers in one go. Through a contact reader
 * speaking T=0, ISO 7816-4 lets it answer in two steps instead, which the
 * host must complete:
 *   61 xx  "xx more bytes are ready": ask for them with GET RESPONSE;
 *   6C xx  "wrong Le, the right one is xx": send the same command with Le = xx.
 */
export async function transmitWithT0Fixups(card: Pick<PcscCard, 'transmit'>, command: Uint8Array): Promise<Uint8Array> {
  let answer = await card.transmit(command);
  const sw1 = () => answer[answer.length - 2];
  const sw2 = () => answer[answer.length - 1]!;

  if (answer.length >= 2 && sw1() === 0x6c && command.length >= 5) {
    // Only a command that ends with Le gets 6C xx: resend it with that last byte replaced.
    const resend = Uint8Array.from(command);
    resend[resend.length - 1] = sw2();
    answer = await card.transmit(resend);
  }

  let data = answer.subarray(0, Math.max(0, answer.length - 2));
  while (answer.length >= 2 && sw1() === 0x61) {
    answer = await card.transmit(Uint8Array.of(0x00, 0xc0, 0x00, 0x00, sw2()));
    data = Uint8Array.of(...data, ...answer.subarray(0, Math.max(0, answer.length - 2)));
  }
  return Uint8Array.of(...data, ...answer.subarray(Math.max(0, answer.length - 2)));
}
