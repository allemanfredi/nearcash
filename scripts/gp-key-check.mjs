#!/usr/bin/env node
/**
 * Finds out, OFFLINE, which GlobalPlatform key a card uses, from one
 * authentication attempt's trace: no further attempt on the card.
 *
 *   node scripts/gp-key-check.mjs <host challenge> <INITIALIZE UPDATE response> [<key> …]
 *   node scripts/gp-key-check.mjs [<key> …] < gp-debug-output.txt
 *
 * The two values come from `gp -d` (pnpm test:card with NEARCASH_GP_DEBUG=1):
 * the 8 bytes after "80 50 .. .. 08" in the INITIALIZE UPDATE command, and the
 * card's 28-byte answer. Given the whole output on stdin, it finds them itself.
 *
 * SCP02 (GlobalPlatform 2.2, appendix E): the card proves it knows the key
 * with its card cryptogram, a triple-DES MAC under a session key derived from
 * the static key. For each candidate key this computes the cryptogram the card
 * would send, and compares it with the one it sent. The candidates: the
 * default test key 404142…4F and other well-known vendor keys, each used as it
 * is and diversified with the card's KDD by EMV CPG 2.04 and by VISA2, the
 * schemes cards ship with; and any <key> given (32 hex digits), the same three
 * ways: check a key from the card's seller here before using it on the card.
 * A match is certain (a wrong key matches with probability 2^-64); no match
 * means the key is something else: ask the card's seller.
 */
import { createCipheriv } from 'node:crypto';
import { readFileSync } from 'node:fs';

// Well-known keys cards ship with (GlobalPlatform's test key first).
const WELL_KNOWN = {
  'the default test key 404142…4F': '404142434445464748494A4B4C4D4E4F',
  'GEMXPRESSOSAMPLE (Gemalto)': '47454D5850524553534F53414D504C45',
  '00…00': '00000000000000000000000000000000',
  'FF…FF': 'FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF',
  '00 01 02 … 0F': '000102030405060708090A0B0C0D0E0F',
  '01 23 … 32 10': '0123456789ABCDEFFEDCBA9876543210',
  '11 22 … 88, twice': '11223344556677881122334455667788',
  '11…11': '11111111111111111111111111111111',
  'C0 C1 … CF': 'C0C1C2C3C4C5C6C7C8C9CACBCCCDCECF',
};

const hex = (bytes) => Buffer.from(bytes).toString('hex').toUpperCase();

/** Triple DES (two-key, 16 bytes) in CBC mode with a zero IV, no padding. */
function tdesCbc(key16, data) {
  const cipher = createCipheriv('des-ede-cbc', key16, Buffer.alloc(8));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** Triple DES in ECB mode, one or more 8-byte blocks. */
function tdesEcb(key16, data) {
  const cipher = createCipheriv('des-ede-ecb', key16, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** ISO 9797-1 method 2 padding: 80, then zeros to a multiple of 8. */
function pad80(data) {
  const length = Math.ceil((data.length + 1) / 8) * 8;
  const padded = Buffer.alloc(length);
  data.copy(padded);
  padded[data.length] = 0x80;
  return padded;
}

/** SCP02 session ENC key: 3DES-CBC(static ENC, 0182 ‖ sequence counter ‖ 00…). */
function sessionEncKey(staticEnc, sequenceCounter) {
  const derivation = Buffer.alloc(16);
  derivation[0] = 0x01;
  derivation[1] = 0x82;
  sequenceCounter.copy(derivation, 2);
  return tdesCbc(staticEnc, derivation);
}

/** SCP02 card cryptogram: full 3DES MAC over host challenge ‖ sequence counter ‖ card challenge. */
function cardCryptogram(staticEnc, hostChallenge, sequenceCounter, cardChallenge) {
  const data = pad80(Buffer.concat([hostChallenge, sequenceCounter, cardChallenge]));
  return tdesCbc(sessionEncKey(staticEnc, sequenceCounter), data).subarray(-8);
}

/** A diversified key: the master key encrypts two 8-byte blocks made from the KDD. */
function diversify(master, first, second) {
  return tdesEcb(master, Buffer.concat([first, second]));
}

/** EMV CPG 2.04: KDD bytes 4–9, then F0 01 / 0F 01 (key 1, ENC). */
function emvEnc(master, kdd) {
  const id = kdd.subarray(4, 10);
  return diversify(master, Buffer.concat([id, Buffer.from([0xf0, 0x01])]), Buffer.concat([id, Buffer.from([0x0f, 0x01])]));
}

/** VISA2: KDD bytes 0–1 and 4–7, then F0 01 / 0F 01 (key 1, ENC). */
function visa2Enc(master, kdd) {
  const id = Buffer.concat([kdd.subarray(0, 2), kdd.subarray(4, 8)]);
  return diversify(master, Buffer.concat([id, Buffer.from([0xf0, 0x01])]), Buffer.concat([id, Buffer.from([0x0f, 0x01])]));
}

/**
 * The host challenge, the 28-byte answer and the keys to try besides the
 * well-known ones: from the arguments (host challenge, answer, keys) or, when
 * the first argument is not a 16-digit host challenge, the keys from the
 * arguments and the rest from gp -d's output on stdin.
 */
function readInputs() {
  const args = process.argv.slice(2).map((value) => value.replace(/[^0-9a-fA-F]/g, ''));
  if (args.length >= 2 && args[0].length === 16) {
    return { host: Buffer.from(args[0], 'hex'), response: Buffer.from(args[1], 'hex'), keys: args.slice(2) };
  }
  const keys = args;
  let text;
  try {
    text = readFileSync(0, 'utf8');
  } catch {
    usage();
  }
  // INITIALIZE UPDATE: CLA 80, INS 50, P1, P2, Lc 08, then the host challenge.
  const flat = text.replace(/[^0-9a-fA-F\n]/g, '').toUpperCase();
  const command = /8050[0-9A-F]{4}08([0-9A-F]{16})/.exec(flat.replace(/\n/g, ''));
  if (!command) usage('no INITIALIZE UPDATE (80 50 .. .. 08 …) in the input');
  // Its answer: 28 bytes then 9000, on a line of its own after the command.
  const lines = flat.split('\n');
  const answer = lines.map((line) => /([0-9A-F]{56})9000$/.exec(line)).find(Boolean);
  if (!answer) usage('no 28-byte answer ending in 9000 in the input');
  return { host: Buffer.from(command[1], 'hex'), response: Buffer.from(answer[1], 'hex'), keys };
}

function usage(problem) {
  if (problem) console.error(`✘ ${problem}`);
  console.error('usage: node scripts/gp-key-check.mjs <host challenge hex> <INITIALIZE UPDATE response hex> [<key hex> …]');
  console.error('       node scripts/gp-key-check.mjs [<key hex> …] < output-of-gp-with-d.txt');
  process.exit(2);
}

const { host, response, keys } = readInputs();
for (const key of keys) if (key.length !== 32) usage(`a key is 32 hex digits (16 bytes): ${key}`);
if (host.length !== 8 || response.length !== 28) usage('expected an 8-byte host challenge and a 28-byte answer');
const kdd = response.subarray(0, 10);
const keyVersion = response[10];
const scp = response[11];
const sequenceCounter = response.subarray(12, 14);
const cardChallenge = response.subarray(14, 20);
const cryptogram = response.subarray(20, 28);
console.log(`KDD ${hex(kdd)} · key version ${keyVersion} · SCP0${scp} · counter ${hex(sequenceCounter)}`);
if (scp !== 2) console.log(`⚠ the card speaks SCP0${scp}, not SCP02: this check only knows SCP02`);

// Every master key, used three ways: as it is, EMV-diversified, VISA2-diversified.
const masters = [
  ...keys.map((key) => [`your key ${key.toUpperCase()}`, key]),
  ...Object.entries(WELL_KNOWN),
];
const schemes = [
  ['as it is', (master) => master, (key) => key],
  ['EMV CPG 2.04 diversified', (master) => emvEnc(master, kdd), (key) => `emv:${key}`],
  ['VISA2 diversified', (master) => visa2Enc(master, kdd), (key) => `visa2:${key}`],
];
const matches = [];
for (const [name, keyHex] of masters) {
  for (const [scheme, derive, option] of schemes) {
    const key = Buffer.from(keyHex, 'hex');
    if (cardCryptogram(derive(key), host, sequenceCounter, cardChallenge).equals(cryptogram)) {
      matches.push(`${name}, ${scheme}  →  NEARCASH_GP_KEY=${option(keyHex.toUpperCase())}`);
    }
  }
}
if (matches.length > 0) {
  for (const match of matches) console.log(`✔ ${match}`);
  console.log("that is the card's key: use it, once.");
} else {
  console.log(`✘ none of ${masters.length * schemes.length} candidates (${masters.length} keys, each as it is, EMV- and VISA2-diversified)`);
  console.log("the key is another one: ask the card's seller, and check it here before using it on the card.");
}
process.exitCode = matches.length > 0 ? 0 : 1;
