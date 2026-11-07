/**
 * Tests the NFC reader and the card on it, without the ATM server:
 *
 *   pnpm atm:reader                    lists the readers, waits for a card, shows it
 *   NEARCASH_READER=acr pnpm atm:reader   picks the reader whose name contains "acr"
 *
 * For a blank card it shows the state; for a banknote it runs the full
 * receiver check (certificate, keys, AUTH), as the wallet app would. It only
 * reads: it never changes the card.
 *
 * Trusted issuers: NEARCASH_TRUSTED_ISSUER (compressed hex) if set,
 * otherwise the testnet MPC issuer and the public DEV issuer.
 *
 * Runs directly with Node (no build), so it and what it imports use only
 * TypeScript that Node can strip.
 */
import {
  CardState,
  DEV_ISSUER,
  NearCashCard,
  type TrustedIssuer,
  bytesToHex,
  cardStateName,
  checkBanknote,
  ethereumAddress,
  formatAmount,
  hexToBytes,
} from '@nearcash/core';
import { PcscReaders, loadPcscLibrary } from './server/features/hardware/pcsc-readers.ts';

/** The testnet issuer contract's MPC key (pnpm issuer:admin public-key). */
const TESTNET_MPC_ISSUER: TrustedIssuer = {
  name: 'NearCash · NEAR MPC (testnet)',
  publicKey: hexToBytes('03e38503df708b9f40ee5a6f7669732229bf1feafe4492ccac028e7e2b778337f8'),
};

const trusted: TrustedIssuer[] = process.env.NEARCASH_TRUSTED_ISSUER
  ? [{ name: 'configured issuer', publicKey: hexToBytes(process.env.NEARCASH_TRUSTED_ISSUER) }]
  : [TESTNET_MPC_ISSUER, DEV_ISSUER];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const readers = new PcscReaders({
  readerName: process.env.NEARCASH_READER,
  library: loadPcscLibrary(),
  onEvent: (message) => console.log(`  · ${message}`),
});
readers.start();

try {
  await readers.firstScan();
  console.log(`readers: ${readers.names().join(', ') || 'none'}`);

  let choice = readers.choose();
  if (!choice.ok) throw new Error(choice.reason);
  console.log(`using: ${choice.name}`);
  if (!choice.cardPresent) console.log('put a card on the reader (waiting up to 60 s)…');
  for (let waited = 0; !choice.ok || !choice.cardPresent; waited += 250) {
    if (waited >= 60_000) throw new Error('no card was placed on the reader');
    await sleep(250);
    choice = readers.choose();
    if (!choice.ok) throw new Error(choice.reason);
  }

  if (choice.heldElsewhere) throw new Error('another program holds the card exclusively (close it, or pick another reader)');

  const card = new NearCashCard(readers.transportToCurrentCard());
  await card.select();
  const info = await card.info();
  console.log(`card: NearCash applet v${info.version}, state ${cardStateName(info.state)}, PIN tries ${info.pinTriesRemaining}`);
  if (info.fundsPublicKey) console.log(`  account inside FAR (Ethereum address of F): ${ethereumAddress(info.fundsPublicKey)}`);
  if (info.authPublicKey) console.log(`  key A: ${bytesToHex(info.authPublicKey)}`);

  if (info.state === CardState.ISSUED || info.state === CardState.SPENT) {
    const check = await checkBanknote(card, trusted);
    if (check.valid) {
      const { certificate } = check;
      console.log(`✔ valid banknote: ${formatAmount(certificate.amount, certificate.decimals)} ${certificate.symbol}, issuer ${check.issuer.name}`);
      console.log(`  issued ${new Date(certificate.issuedAt * 1000).toISOString().slice(0, 10)}, token ${certificate.tokenId}`);
    } else {
      console.log(`✘ ${check.failure}: ${check.detail}`);
    }
  } else if (info.state === CardState.EMPTY) {
    console.log('✔ blank card: ready for the ATM');
  }
} catch (error) {
  console.error(`✘ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  readers.stop();
}
