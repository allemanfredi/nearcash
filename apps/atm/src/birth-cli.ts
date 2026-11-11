/**
 * The factory step: gives a blank card its birth certificate
 * (docs/protocol.md §5.8), on the bank's offline production station.
 *
 *   pnpm card:birth --new-key <file>   creates the production key in <file> (once, offline)
 *                                      and prints its public key for the issuer contract
 *   pnpm card:birth --key <file>       gives birth to the blank card on the reader
 *   pnpm card:birth --dev              the same with the public DEV production key (tests only:
 *                                      anyone can make chips with it)
 *
 * On the card: CHIP_KEY (the chip creates C), the production key signs C
 * here, STORE_BIRTH writes the signature, GET_BIRTH reads it back and it is
 * checked. A card already born is left as it is. NEARCASH_READER picks the
 * reader when several are connected, as for `pnpm atm:reader`.
 *
 * Whoever holds the production key can make chips the issuer certifies: keep
 * the file on a machine that never goes online, and never in this repository.
 *
 * Runs directly with Node (no build), so it and what it imports use only
 * TypeScript that Node can strip.
 */
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import {
  CardState,
  DEV_PRODUCTION_SECRET_KEY,
  NearCashCard,
  bytesToHex,
  cardStateName,
  hexToBytes,
  newProductionSecretKey,
  productionPublicKeyOf,
  signBirth,
  verifyBirthSignature,
} from '@nearcash/core';
import { PcscReaders, loadPcscLibrary } from './server/features/hardware/pcsc-readers.ts';

const USAGE = [
  'usage:',
  '  pnpm card:birth --new-key <file>   create the production key (once, offline)',
  '  pnpm card:birth --key <file>       give birth to the blank card on the reader',
  '  pnpm card:birth --dev              the same with the public DEV production key (tests only)',
].join('\n');

const [option, path, ...rest] = process.argv.slice(2);
if (rest.length > 0) fail(USAGE);

switch (option) {
  case '--new-key':
    if (!path) fail(USAGE);
    createProductionKey(path);
    break;
  case '--key':
    if (!path) fail(USAGE);
    await giveBirth(readProductionKey(path), 'production key');
    break;
  case '--dev':
    if (path) fail(USAGE);
    console.log('⚠ the public DEV production key: only an issuer that trusts it (development) accepts this card');
    await giveBirth(DEV_PRODUCTION_SECRET_KEY, 'DEV production key');
    break;
  default:
    fail(USAGE);
}

/** A new random production key, written only readable by its owner. Never overwrites one. */
function createProductionKey(file: string): void {
  if (existsSync(file)) fail(`${file} exists: a production key is never overwritten (chips born with it would be lost)`);
  const secret = newProductionSecretKey();
  writeFileSync(file, `${bytesToHex(secret)}\n`, { mode: 0o600 });
  chmodSync(file, 0o600); // in case the umask widened it
  const publicKey = bytesToHex(productionPublicKeyOf(secret));
  console.log(`production key written to ${file} (secret: keep it offline, and a copy in a safe)`);
  console.log(`public key: ${publicKey}`);
  console.log('the issuer contract must name it: pnpm issuer:admin set-production-key <public key>');
}

/** The secret from a file made by --new-key (64 hex digits). Warns if others can read it. */
function readProductionKey(file: string): Uint8Array {
  if (!existsSync(file)) fail(`${file} not found`);
  if ((statSync(file).mode & 0o077) !== 0) console.log(`⚠ ${file} can be read by other users: chmod 600 ${file}`);
  const text = readFileSync(file, 'utf8').trim();
  if (!/^[0-9a-f]{64}$/.test(text)) fail(`${file} does not hold a production key (64 lowercase hex digits)`);
  return hexToBytes(text);
}

/** Waits for a card, then CHIP_KEY → sign → STORE_BIRTH → check. */
async function giveBirth(productionSecret: Uint8Array, keyName: string): Promise<void> {
  const productionPublic = productionPublicKeyOf(productionSecret);
  const readers = new PcscReaders({ readerName: process.env.NEARCASH_READER, library: loadPcscLibrary() });
  readers.start();
  try {
    const card = new NearCashCard(await waitForCard(readers));
    await card.select();
    const info = await card.info();
    if (info.version < 2) throw new Error(`the applet on this card is v${info.version}: install v2 (birth certificates) first`);

    const existing = await card.readBirth();
    if (existing) {
      const ours = verifyBirthSignature(existing.chipPublicKey, existing.birthSignature, productionPublic);
      console.log(`already born, chip key C ${bytesToHex(existing.chipPublicKey)}`);
      console.log(ours ? `✔ by this ${keyName}: nothing to do` : `✘ by another production key than this ${keyName}`);
      if (!ours) process.exitCode = 1;
      return;
    }
    if (info.state !== CardState.EMPTY) {
      throw new Error(`the card is ${cardStateName(info.state)}: only a blank card (EMPTY) can be born`);
    }

    const chipPublicKey = await card.chipKey();
    await card.storeBirth(signBirth(chipPublicKey, productionSecret));

    // Read it back: what the card will give the issuer must verify.
    const birth = await card.readBirth();
    if (!birth || !verifyBirthSignature(birth.chipPublicKey, birth.birthSignature, productionPublic)) {
      throw new Error('the card does not give back a birth certificate that verifies');
    }
    console.log(`✔ born: chip key C ${bytesToHex(birth.chipPublicKey)}`);
    console.log(`  ${keyName} ${bytesToHex(productionPublic)}`);
  } catch (error) {
    console.error(`✘ ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  } finally {
    readers.stop();
  }
}

/** The connection to the card on the reader, waiting up to 60 s for one (as `pnpm atm:reader`). */
async function waitForCard(readers: PcscReaders) {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await readers.firstScan();
  let choice = readers.choose();
  if (!choice.ok) throw new Error(choice.reason);
  console.log(`using: ${choice.name}`);
  if (!choice.cardPresent) console.log('put a blank card on the reader (waiting up to 60 s)…');
  for (let waited = 0; !choice.ok || !choice.cardPresent; waited += 250) {
    if (waited >= 60_000) throw new Error('no card was placed on the reader');
    await sleep(250);
    choice = readers.choose();
    if (!choice.ok) throw new Error(choice.reason);
  }
  if (choice.heldElsewhere) throw new Error('another program holds the card exclusively (close it, or pick another reader)');
  return readers.transportToCurrentCard();
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
