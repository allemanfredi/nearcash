/**
 * Buys one banknote from the ATM started by `pnpm local`, without a browser,
 * then checks it as the person receiving it would:
 *
 *   pnpm local:sale
 *
 * 1. The sale, as the kiosk page on the ATM's iPhone makes it, through the
 *    same API and the page's own server (packages/kiosk-api): the banknote,
 *    the first way to pay, a PIN; the payment (simulated); then every stage
 *    until the banknote is handed out.
 * 2. The banknote the customer now holds (the card emulator's last card
 *    handed out), checked with the wallet app's own check (packages/core,
 *    checkBanknote): issued, the certificate signed by the issuer, its keys
 *    those of this chip, and the chip answering a fresh challenge.
 * 3. The hand-over: the receiver changes the PIN, which works only with the
 *    PIN chosen at the ATM.
 *
 * Exit code 0 when all three pass.
 */
// The project's own code (packages/core, TypeScript: Node runs it as it is).
import {
  CardState,
  DEV_ISSUER,
  NearCashCard,
  bytesToHex,
  cardStateName,
  checkBanknote,
  formatAmount,
  hexToBytes,
} from '../packages/core/src/index.ts';
import { EMULATOR_URL, KIOSK_URL } from './local.mjs';

const API = `${KIOSK_URL}/api`;
const PIN = '2468';
/** The receiver's new PIN, after the hand-over. */
const NEW_PIN = '1357';
/** A sale takes about 15 s: each step stays on screen at least 3 s. */
const SALE_TIMEOUT_MS = 90_000;
/** Stages a sale ends in without a banknote (packages/kiosk-api, Stage). */
const FAILED_ENDS = ['expired', 'refunded', 'cancelled', 'failed'];

try {
  // ---------------------------------------------------------------- 1. the sale
  const setup = await call('GET', '/setup').catch((error) => {
    throw new Error(`${error.message}\n  Is \`pnpm local\` running? Start it first, in another terminal.`);
  });
  if (setup.outOfService) throw new Error(`the ATM is out of service: ${setup.outOfService}`);
  if (!setup.simulatedPayments) throw new Error('payments are real on this ATM: this script only pays simulated ones');

  // Anything still on the screen from an earlier run: back to the start.
  const previous = await call('GET', '/session');
  if (previous && previous.stage === 'awaiting_payment') await call('POST', '/session/cancel');
  if (previous) await call('POST', '/session/finish');

  const [banknote] = setup.banknotes;
  const [option] = setup.paymentOptions;
  console.log(`1. Buying a ${banknote.label} banknote, paying with ${option.token} on ${option.network}, PIN ${PIN}.`);
  let session = await call('POST', '/session', { amount: banknote.amount, paymentOptionId: option.id, pin: PIN });
  console.log(`   sale ${session.reference}: deposit address ${session.payment.depositAddress}, amount ${session.payment.amount} ${session.payment.token}`);
  if (session.payment.simulated) console.log("   (simulated payments are counted 1:1 in the banknote's own token: no swap, no money)");

  console.log('   paying (simulated)…');
  await call('POST', '/session/simulate-payment');

  // Follow the sale as the page does: each new stage, until it ends.
  const deadline = Date.now() + SALE_TIMEOUT_MS;
  let shown = '';
  while (session.stage !== 'dispensed') {
    if (Date.now() > deadline) throw new Error(`the sale did not finish within ${SALE_TIMEOUT_MS / 1000} s (stuck at "${shown}")`);
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    session = await call('GET', '/session');
    if (session.stage !== shown) {
      shown = session.stage;
      console.log(`   → ${shown}`);
    }
    if (FAILED_ENDS.includes(session.stage)) {
      throw new Error(`the sale ended "${session.stage}"${session.problem ? `: ${session.problem}` : ''}`);
    }
  }
  await call('POST', '/session/finish');
  console.log(`   ✔ the ${session.banknote} banknote was handed out (sale ${session.reference}).`);

  // ---------------------------------------------------------------- 2. the receiver's check
  // The wallet app trusts the public DEV issuer key in its Debug builds: the key `pnpm local` signs with.
  console.log('2. Checking the banknote as the wallet app does…');
  const card = new NearCashCard({ transmit: (command) => handedOutCard(command) });
  const check = await checkBanknote(card, [DEV_ISSUER]);
  if (!check.valid) throw new Error(`the banknote is not valid: ${check.failure}: ${check.detail}`);
  const { certificate, info } = check;
  const value = `${formatAmount(certificate.amount, certificate.decimals)} ${certificate.symbol}`;
  if (value !== session.banknote) throw new Error(`the certificate says ${value}, the ATM sold ${session.banknote}`);
  console.log(`   ✔ valid: ${value}, issued by "${check.issuer.name}", card ${cardStateName(info.state)},`);
  console.log(`     its value in the account ${check.accountId}, ${info.pinTriesRemaining} PIN tries left.`);

  // ---------------------------------------------------------------- 3. the hand-over
  console.log(`3. Handing it over: the receiver changes the PIN from ${PIN} to ${NEW_PIN}…`);
  await card.changePin(PIN, NEW_PIN);
  const after = await card.info();
  if (after.state !== CardState.ISSUED) throw new Error(`after the hand-over the card is ${cardStateName(after.state)}`);
  console.log('   ✔ the PIN chosen at the ATM opened it: the banknote now has the receiver\'s PIN.');

  console.log('\n✔ every step passed: sale, payment, keys, birth check, certificate, PIN, hand-out, receiver\'s check, hand-over.');
  process.exit(0);
} catch (error) {
  console.error(`✘ ${error instanceof Error ? error.message : error}`);
  process.exit(1);
}

/** One APDU to the card the customer holds: the card emulator's last card handed out. */
async function handedOutCard(command) {
  const response = await fetch(`${EMULATOR_URL}/handed-out/apdu`, {
    method: 'POST',
    body: bytesToHex(command),
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`card emulator: ${text}`);
  return hexToBytes(text.trim());
}

/** One call to the kiosk API; the answer's JSON, or an error with the server's message. */
async function call(method, path, body) {
  const response = await fetch(API + path, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${method} /api${path}: ${response.status} ${json?.error ?? text}`);
  return json;
}
