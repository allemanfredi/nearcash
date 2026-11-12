/**
 * Tests a real card end to end, on the reader of this machine (the Raspberry
 * Pi): the whole life of a banknote, with the public DEV keys, so the test
 * banknote is worth nothing and no network is needed.
 *
 *   pnpm test:card <[user@]raspberry>        builds and installs the applet, runs this, resets the card
 *   node apps/atm/src/card-test-cli.ts       this alone, on the Pi, on a card with the applet freshly installed
 *   node apps/atm/src/card-test-cli.ts --wait   only waits until a card is in the reader (up to 60 s), sending it nothing
 *   node apps/atm/src/card-test-cli.ts --blank  only checks that the card is blank again (EMPTY, never born): after a reset
 *   node apps/atm/src/card-test-cli.ts --state  only prints the card's state, one line: "state: NONE" (no NearCash
 *                                               applet) or its applet's (EMPTY … SPENT); for pnpm card:reset
 *
 * The card must be blank (EMPTY) and never born. The steps, in order:
 *   1. SELECT and INFO: the applet answers, protocol v2, EMPTY;
 *   2. birth (docs/protocol.md §5.8): CHIP_KEY, STORE_BIRTH with the DEV
 *      production key, GET_BIRTH gives back a birth that verifies;
 *   3. GENERATE_KEYS: the chip makes A and F (secp256k1) and signs them with C;
 *   4. a DEV-issuer certificate, FINALIZE with PIN 1234, and the receiver's
 *      check (certificate, keys, AUTH over a fresh challenge);
 *   5. a wrong PIN is refused and costs one try; CHANGE_PIN 1234 → 5678;
 *   6. SIGN_ONCE over an ERC-191 digest: the signature recovers F (what NEAR
 *      Intents checks), the card is SPENT, the same digest gives the same
 *      signature again, another digest is refused;
 *   7. the receiver's check now reports the banknote SPENT.
 * It stops at the first step that fails, and leaves the card SPENT:
 * scripts/card-test.sh then reinstalls the applet, which wipes it.
 *
 * NEARCASH_READER picks the reader when several are connected, as for
 * `pnpm atm:reader`. Runs directly with Node (no build), so it and what it
 * imports use only TypeScript that Node can strip.
 */
import {
  CardError,
  CardState,
  DEV_DENOMINATION,
  DEV_ISSUER,
  DEV_ISSUER_SIGNER,
  DEV_PRODUCTION_PUBLIC_KEY,
  DEV_PRODUCTION_SECRET_KEY,
  NearCashCard,
  PROTOCOL_VERSION,
  birthProblem,
  bytesToHex,
  cardStateName,
  checkBanknote,
  erc191Digest,
  personalizeCard,
  prepareCard,
  signBirth,
  toRecoverableSignature,
  verifyBirthSignature,
} from '@nearcash/core';
import { PcscReaders, loadPcscLibrary } from './server/features/hardware/pcsc-readers.ts';

/** A step that failed: already reported, it stops the test. */
class StepFailed extends Error {}

const FIRST_PIN = '1234';
const NEW_PIN = '5678';
const WRONG_PIN = '9999';

const readers = new PcscReaders({ readerName: process.env.NEARCASH_READER, library: loadPcscLibrary() });
readers.start();
let failed = false;

try {
  if (process.argv.includes('--wait')) {
    // scripts/card-test.sh waits here before GlobalPlatformPro talks to the card:
    // gp authenticates on every call, and a card counts failed authentications.
    await waitForCardPresent(readers);
    process.exit(0);
  }
  if (process.argv.includes('--blank')) {
    // after scripts/card-test.sh reinstalled the applet: ready for another test?
    const card = new NearCashCard(await waitForCard(readers));
    await step('the card is blank again, ready for another test', async () => {
      await card.select();
      const info = await card.info();
      if (info.state !== CardState.EMPTY) throw new Error(`the card is ${cardStateName(info.state)}`);
      if (await card.readBirth()) throw new Error('the card is still born');
      return `EMPTY, never born, ${info.pinTriesRemaining} PIN tries`;
    });
    readers.stop();
    process.exit(0);
  }
  if (process.argv.includes('--state')) {
    // scripts/card-test.sh --reset (pnpm card:reset) reads it before wiping the
    // card: a card that holds a banknote is worth a question first.
    const card = new NearCashCard(await waitForCard(readers));
    let hasApplet = true;
    try {
      await card.select();
    } catch (error) {
      if (!(error instanceof CardError)) throw error;
      hasApplet = false;   // the card refused the SELECT: no NearCash applet on it
    }
    console.log(`state: ${hasApplet ? cardStateName((await card.info()).state) : 'NONE'}`);
    readers.stop();
    process.exit(0);
  }
  const card = new NearCashCard(await waitForCard(readers));

  await step('1. the applet answers, protocol v2, blank', async () => {
    await card.select();
    const info = await card.info();
    if (info.version !== PROTOCOL_VERSION) throw new Error(`protocol v${info.version}, expected v${PROTOCOL_VERSION}`);
    if (info.state !== CardState.EMPTY) {
      throw new Error(`the card is ${cardStateName(info.state)}: reinstall the applet for a blank card (pnpm test:card does)`);
    }
    if (await card.readBirth()) throw new Error('the card is already born: reinstall the applet (pnpm test:card does)');
    return `${info.pinTriesRemaining} PIN tries`;
  });

  await step('2. birth with the DEV production key', async () => {
    const chipPublicKey = await card.chipKey();
    await card.storeBirth(signBirth(chipPublicKey, DEV_PRODUCTION_SECRET_KEY));
    const birth = await card.readBirth();
    if (!birth || !verifyBirthSignature(birth.chipPublicKey, birth.birthSignature, DEV_PRODUCTION_PUBLIC_KEY)) {
      throw new Error('GET_BIRTH does not give back a birth certificate that verifies');
    }
    return `chip key C ${bytesToHex(birth.chipPublicKey).slice(0, 18)}…`;
  });

  const prepared = await step('3. the chip makes its keys A and F, signed by C', async () => {
    const prepared = await prepareCard(card);
    if (!prepared.birth) throw new Error('a born card must sign its keys with C');
    const problem = birthProblem(prepared.birth, prepared.keys, DEV_PRODUCTION_PUBLIC_KEY);
    if (problem) throw new Error(problem);
    return prepared;
  }, (prepared) => `F's Intents account ${prepared.accountId}`);

  await step('4. DEV certificate, FINALIZE, the receiver\'s check (AUTH)', async () => {
    // stores the certificate, sets the first PIN (FINALIZE) and runs the
    // receiver's check against the DEV issuer: it throws if the check fails
    const certificate = await personalizeCard(card, prepared, DEV_DENOMINATION, FIRST_PIN, DEV_ISSUER_SIGNER);
    return `${certificate.bytes.length}-byte certificate, ISSUED`;
  });

  const digest = erc191Digest(`NearCash card test ${new Date().toISOString()}`);
  await step('5. a wrong PIN is refused; CHANGE_PIN', async () => {
    try {
      await card.signOnce(WRONG_PIN, digest);
      throw new Error('SIGN_ONCE signed with a wrong PIN');
    } catch (error) {
      if (!(error instanceof CardError) || error.pinTriesLeft === undefined) throw error;
    }
    const info = await card.info();
    if (info.state !== CardState.ISSUED) throw new Error(`after a wrong PIN the card is ${cardStateName(info.state)}`);
    const triesAfterWrongPin = info.pinTriesRemaining;
    await card.changePin(FIRST_PIN, NEW_PIN);
    return `${triesAfterWrongPin} tries left after the wrong one; PIN now ${NEW_PIN}`;
  });

  await step('6. SIGN_ONCE: F signs once, the card is SPENT', async () => {
    const signature = await card.signOnce(NEW_PIN, digest);
    // what NEAR Intents checks: the signature, made low-s, recovers F (it throws otherwise)
    toRecoverableSignature(signature, digest, prepared.keys.fundsPublicKey);
    const info = await card.info();
    if (info.state !== CardState.SPENT) throw new Error(`after SIGN_ONCE the card is ${cardStateName(info.state)}`);
    const again = await card.signOnce(NEW_PIN, digest);
    if (bytesToHex(again) !== bytesToHex(signature)) throw new Error('the same digest gave another signature');
    try {
      await card.signOnce(NEW_PIN, erc191Digest('another redemption'));
      throw new Error('a SPENT card signed another digest');
    } catch (error) {
      if (!(error instanceof CardError)) throw error;
    }
    return 'same digest → same signature, another digest refused';
  });

  await step('7. the receiver\'s check reports it SPENT', async () => {
    const check = await checkBanknote(card, [DEV_ISSUER]);
    if (check.valid || check.failure !== 'SPENT') {
      throw new Error(check.valid ? 'a spent card passed as valid' : `${check.failure}: ${check.detail}`);
    }
    return 'AUTH signs the SPENT state';
  });

  console.log('\n✔ the card works: every step passed');
} catch (error) {
  failed = true;
  if (!(error instanceof StepFailed)) console.error(`✘ ${error instanceof Error ? error.message : String(error)}`);
} finally {
  readers.stop();
}
process.exitCode = failed ? 1 : 0;

/**
 * Runs one step and prints ✔ or ✘ with what it found. `describe` turns the
 * step's result into the line printed after ✔ (by default the result itself,
 * when it is a string).
 */
async function step<T>(name: string, run: () => Promise<T>, describe?: (result: T) => string): Promise<T> {
  try {
    const result = await run();
    const detail = describe ? describe(result) : typeof result === 'string' ? result : '';
    console.log(`✔ ${name}${detail ? `: ${detail}` : ''}`);
    return result;
  } catch (error) {
    console.error(`✘ ${name}: ${error instanceof Error ? error.message : String(error)}`);
    throw new StepFailed(name);
  }
}

/** The connection to the card on the reader, waiting up to 60 s for one (as `pnpm atm:reader`). */
async function waitForCard(pcsc: PcscReaders) {
  await waitForCardPresent(pcsc);
  const choice = pcsc.choose();
  if (!choice.ok) throw new Error(choice.reason);
  if (choice.heldElsewhere) throw new Error('another program holds the card exclusively (stop the ATM server, or pick another reader)');
  return pcsc.transportToCurrentCard();
}

/** Waits up to 60 s until a card is in the reader, without sending it anything. */
async function waitForCardPresent(pcsc: PcscReaders): Promise<void> {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
  await pcsc.firstScan();
  let choice = pcsc.choose();
  if (!choice.ok) throw new Error(choice.reason);
  console.log(`reader: ${choice.name}`);
  if (!choice.cardPresent) console.log('put the card in the reader (waiting up to 60 s)…');
  for (let waited = 0; !choice.ok || !choice.cardPresent; waited += 250) {
    if (waited >= 60_000) throw new Error('no card was put in the reader');
    await sleep(250);
    choice = pcsc.choose();
    if (!choice.ok) throw new Error(choice.reason);
  }
}
