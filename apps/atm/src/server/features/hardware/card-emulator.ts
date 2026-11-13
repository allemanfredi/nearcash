import { type CardTransport, bytesToHex, hexToBytes } from '@nearcash/core';
import type { OperatorLog } from '../../common/operator-log.ts';
import type { Dispenser } from './hardware.ports.ts';
import { PcscCassette } from './pcsc-cassette.ts';
import type { ReaderChoice } from './pcsc-readers.ts';

/**
 * DEVELOPMENT ONLY (NEARCASH_CASSETTE=emulator, NEARCASH_DISPENSER=emulator,
 * started by `pnpm local`): the ATM's hopper, NFC reader and turret are the
 * card emulator (applet/src/emulator), where the real NearCash applet runs in
 * jCardSim. A sale then makes a real banknote with no card: the chip's keys,
 * the birth check, the certificate and the PIN all go through the applet's
 * own code, and the ATM's own checks (PcscCassette) run on it.
 *
 * The emulator's cards are born with the public DEV production key, which
 * only the issuance server's DEV signer trusts: test banknotes only.
 */
export class CardEmulator {
  /** Where the emulator listens, e.g. http://127.0.0.1:8893. */
  readonly url: string;
  private readonly log: OperatorLog;
  /**
   * What the emulator last said about its reader: the number of the card in
   * it, null when empty; or why it can't be reached. Kept up to date by
   * polling (start), and at once after each load or hand-out.
   */
  private state: { card: number | null } | { problem: string } = { problem: 'not asked yet' };
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  /** One APDU at a time, whoever sends it (as PcscReaders does on the wire). */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(url: string, log: OperatorLog) {
    this.url = url.replace(/\/$/, '');
    this.log = log;
  }

  /** Starts following the emulator's reader; resolves after the first answer (or failure). */
  async start(pollMs = 500): Promise<void> {
    await this.refresh();
    this.pollTimer = setInterval(() => void this.refresh(), pollMs);
    this.pollTimer.unref();
  }

  stop(): void {
    clearInterval(this.pollTimer);
  }

  // ---------------------------------------------------------------- what PcscCassette asks a reader

  /** The reader, as PcscReaders.choose() describes one: a card in it or not. */
  choose(): ReaderChoice {
    if ('problem' in this.state) return { ok: false, reason: `the card emulator at ${this.url} does not answer (${this.state.problem})` };
    return { ok: true, name: 'card emulator', cardPresent: this.state.card !== null, cardMute: false, heldElsewhere: false };
  }

  /** An emulated card always answers: there is nothing to power again. */
  async wakeCard(): Promise<void> {}

  /**
   * A transport to the card now in the reader, bound to it by its number:
   * once it leaves the reader, the emulator refuses its APDUs (409), so a
   * sale never writes to the next card.
   */
  transportToCurrentCard(): CardTransport {
    if ('problem' in this.state) throw new Error(`the card emulator does not answer (${this.state.problem})`);
    const card = this.state.card;
    if (card === null) throw new Error('no card in the card emulator\'s reader');
    return {
      transmit: (command) => {
        const sent = this.queue.then(() => this.post(`/reader/apdu?card=${card}`, bytesToHex(command)));
        this.queue = sent.catch(() => {});
        return sent.then((answer) => hexToBytes(answer.trim()));
      },
    };
  }

  // ---------------------------------------------------------------- what the dispenser does

  /** The pusher: the next card of the hopper into the reader. */
  async load(): Promise<void> {
    const { card } = JSON.parse(await this.post('/load')) as { card: number };
    this.state = { card };
    this.log.log(`[emulator] card ${card} loaded into the reader`);
  }

  /** The turret: the card in the reader goes out to the customer. */
  async handOut(): Promise<void> {
    const { card } = JSON.parse(await this.post('/hand-out')) as { card: number };
    this.state = { card: null };
    this.log.log(`[emulator] card ${card} handed out`);
  }

  // ---------------------------------------------------------------- HTTP

  private async refresh(): Promise<void> {
    try {
      const response = await fetch(`${this.url}/reader`, { signal: AbortSignal.timeout(2_000) });
      this.state = (await response.json()) as { card: number | null };
    } catch (error) {
      this.state = { problem: error instanceof Error ? error.message : String(error) };
    }
  }

  private async post(path: string, body = ''): Promise<string> {
    const response = await fetch(this.url + path, { method: 'POST', body, signal: AbortSignal.timeout(10_000) });
    const text = await response.text();
    if (!response.ok) throw new Error(`card emulator ${path}: ${text}`);
    return text;
  }
}

/**
 * The cassette with the card emulator in the reader's place. Its checks
 * (a blank NearCash card, born, loaded once the sale is paid) are
 * PcscCassette's own: the same code as with the NFC reader on the Pi.
 */
export class EmulatedCassette extends PcscCassette {
  override readonly name = 'card emulator (the NearCash applet in jCardSim)';

  constructor(emulator: CardEmulator, dispenser: Dispenser) {
    super(emulator, undefined, true, () => dispenser.load());
  }
}

/** The card emulator's pusher and turret. */
export class EmulatedDispenser implements Dispenser {
  readonly name = 'card emulator\'s pusher and turret';
  readonly loadsCards = true;
  private readonly emulator: CardEmulator;

  constructor(emulator: CardEmulator) {
    this.emulator = emulator;
  }

  load(): Promise<void> {
    return this.emulator.load();
  }

  dispense(): Promise<void> {
    return this.emulator.handOut();
  }
}
