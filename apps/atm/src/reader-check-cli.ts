/**
 * Checks the reader, and whether the card in it can be read: for
 * hardware/atm/cycle.py (pnpm atm:cycle), which runs it before the first
 * cycle and after each load, to see whether the pusher's stroke takes the card
 * all the way in.
 *
 *   node apps/atm/src/reader-check-cli.ts --reader             is a reader connected?
 *   node apps/atm/src/reader-check-cli.ts --card [--wait ms]   is the card in it read? (waits up to ms, default 1500)
 *
 * "Read" means that the card answered a command through the reader's contacts.
 * The ACR39U sees a card by a switch in its slot, before its contacts touch the
 * chip (its LED lights up then): a card that stops short is "in the reader"
 * but doesn't answer. It is sent a SELECT of the NearCash applet: any answer
 * means the contacts touch the chip; when the applet is there, its INFO too.
 *
 * One line on stdout, and the exit code:
 *   0  the reader is connected / the card answered
 *   1  no reader, or the PC/SC service isn't running
 *   2  a card is in the reader, but it doesn't answer: its contacts don't touch the chip
 *   3  no card in the reader
 *   4  another program holds the card (the ATM server?)
 *
 * NEARCASH_READER picks the reader when several are connected, as for
 * `pnpm atm:reader`. Runs directly with Node (no build).
 */
import { APPLET_AID, bytesToHex, cardStateName } from '@nearcash/core';
import { loadPcscLibrary } from './server/features/hardware/pcsc-readers.ts';
import type { PcscCard, PcscClient, PcscLibrary, PcscReader } from './server/features/hardware/pcsc-readers.ts';

type Status = { present: boolean; mute: boolean; exclusive: boolean };
type Entry = { reader: PcscReader; status: Status };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
let client: PcscClient | undefined;   // stopped by finish(), once started

const mode = process.argv[2];
const waitIndex = process.argv.indexOf('--wait');
const waitMs = waitIndex > 0 ? Number(process.argv[waitIndex + 1]) : 1_500;
if ((mode !== '--reader' && mode !== '--card') || !Number.isFinite(waitMs) || waitMs < 0) {
  finish(1, 'usage: reader-check-cli.ts --reader | --card [--wait ms]');
}

let library: PcscLibrary;
try {
  library = loadPcscLibrary();
} catch (error) {
  finish(1, error instanceof Error ? error.message : String(error));
}
const { PRESENT, MUTE, EXCLUSIVE } = library.ReaderStatus;
const readers = new Map<string, Entry>();
let serviceProblem: string | undefined;

client = new library.Client();
client.on('reader', (reader) => {
  const entry: Entry = { reader, status: { present: false, mute: false, exclusive: false } };
  readers.set(reader.name(), entry);
  reader.on('change', (status) => {
    entry.status = { present: status.has(PRESENT), mute: status.has(MUTE), exclusive: status.has(EXCLUSIVE) };
  });
  reader.on('disconnect', () => readers.delete(reader.name()));
});
client.on('error', (error) => {
  serviceProblem = `the PC/SC service is not available (${error instanceof Error ? error.message : String(error)}): is pcscd running?`;
});
client.start();
// PC/SC reports the readers already connected, and the cards in them, just after start.
await sleep(1_000);

const entry = chosenReader();
if (mode === '--reader') finish(0, entry.reader.name());

// --card: wait for one, up to waitMs.
for (let waited = 0; !entry.status.present && waited < waitMs; waited += 100) await sleep(100);
const { present, mute, exclusive } = entry.status;
if (!present) finish(3, 'no card in the reader: the card did not reach its slot\'s switch');
if (exclusive) finish(4, 'another program holds the card (stop the ATM server)');

// A MUTE card is not given up on: PC/SC tries to power a card once, as soon as
// the slot's switch closes. A card pushed slowly is still moving then, its
// contacts not yet on the chip: it is marked MUTE, and stays so once it is all
// the way in. Connecting makes PC/SC power it again, where it is now.
let card: PcscCard;
try {
  card = await entry.reader.connect(library.CardMode.SHARED);
} catch (error) {
  const flag = mute ? ', PC/SC marks it MUTE' : '';
  finish(2, `a card is in the reader but it does not answer (${describe(error)}${flag}): its contacts don't touch the chip (the card stopped short)`);
}
try {
  const select = await card.transmit(Uint8Array.of(0x00, 0xa4, 0x04, 0x00, APPLET_AID.length, ...APPLET_AID, 0x00));
  const sw = statusWord(select);
  if (sw !== 0x9000) finish(0, `card read: it answers (SW ${hex16(sw)}: no NearCash applet on it)`);
  const info = await card.transmit(Uint8Array.of(0x80, 0x10, 0x00, 0x00, 0x00));
  if (statusWord(info) !== 0x9000 || info.length < 5) finish(0, `card read: the NearCash applet answers (INFO: SW ${hex16(statusWord(info))})`);
  finish(0, `card read: the NearCash applet answers, v${info[0]}, ${cardStateName(info[1]!)}`);
} catch (error) {
  finish(2, `a card is in the reader but it stopped answering (${describe(error)}): its contacts barely touch the chip`);
} finally {
  await card.disconnect(library.CardDisposition.RESET).catch(() => {});
}

/** The reader to use: NEARCASH_READER's match, or the only one (else it finishes with 1). */
function chosenReader(): Entry {
  if (serviceProblem) finish(1, serviceProblem);
  const wanted = process.env.NEARCASH_READER?.toLowerCase();
  const all = [...readers.values()];
  const match = wanted ? all.filter((candidate) => candidate.reader.name().toLowerCase().includes(wanted)) : all;
  if (match.length === 1) return match[0]!;
  const names = all.map((candidate) => candidate.reader.name()).join(', ') || 'none';
  if (match.length === 0) finish(1, wanted ? `no connected reader's name contains "${wanted}" (connected: ${names})` : 'no reader is connected');
  finish(1, `several readers are connected (${names}): set NEARCASH_READER to part of the reader's name`);
}

function statusWord(response: Uint8Array): number {
  return response.length >= 2 ? (response[response.length - 2]! << 8) | response[response.length - 1]! : 0;
}

function hex16(value: number): string {
  return bytesToHex(Uint8Array.of(value >> 8, value & 0xff)).toUpperCase();
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

/** Prints the one line, stops PC/SC and exits with `code`. */
function finish(code: number, message: string): never {
  console.log(message);
  client?.stop();
  process.exit(code);
}
