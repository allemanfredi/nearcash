/**
 * Checks the issuance server's configuration against the real services,
 * without moving any money:
 *
 *   pnpm issuance:check
 *
 *  1. certificates: the issuer contract's configuration, and that the key
 *     it writes into certificates is the one MPC derives for it (with
 *     NEARCASH_SKIP_MPC: only the contract's banknotes, MPC is not used);
 *  2. payments: a dry-run 1Click quote for every denomination, with the
 *     configured recipient type (CONFIDENTIAL_INTENTS needs the partner key),
 *     plus a public INTENTS quote as a reference for the route;
 *  3. reserve: the FAR reserve's account, and a dry-run 1Click quote of a
 *     transfer to a card (FAR → FAR), which must deliver the whole amount.
 *
 * It builds the same modules as the server (a Nest application context,
 * without HTTP) and reads what it needs from them.
 */
import 'reflect-metadata';
import { bytesToHex, formatAmount } from '@nearcash/core';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.ts';
import { issuanceConfigFromEnvironment, loadIssuanceEnvironment } from './config/issuance-config.ts';
import { CERTIFICATE_AUTHORITY, type CertificateAuthority } from './features/certificates/certificate-authority.port.ts';
import { MpcCertificateAuthority } from './features/certificates/mpc-certificate-authority.ts';
import { SkipMpcCertificateAuthority } from './features/certificates/skip-mpc-certificate-authority.ts';
import { OneClickGateway } from './features/payments/one-click.gateway.ts';
import { FarReserve } from './features/reserve/far.reserve.ts';
import { RESERVE, type Reserve } from './features/reserve/reserve.port.ts';
import { payableAtFaceValue } from './features/sales/face-value.ts';

const env = loadIssuanceEnvironment();
const config = issuanceConfigFromEnvironment(env);
const app = await NestFactory.createApplicationContext(AppModule.forRoot(config), { logger: false });
const authority = app.get<CertificateAuthority>(CERTIFICATE_AUTHORITY);
const reserve = app.get<Reserve>(RESERVE);

let problems = 0;
const ok = (text: string) => console.log(`  ✓ ${text}`);
const bad = (text: string) => {
  problems += 1;
  console.log(`  ✗ ${text}`);
};

// ------------------------------------------------------------------ 1. certificates
console.log(`certificates: ${authority.signer.name}`);
const issuerKey = bytesToHex(await authority.signer.publicKey());
ok(`issuer key ${issuerKey}`);
if (authority instanceof MpcCertificateAuthority) {
  const denominations = await Promise.all((await authority.denominations()).map((amount) => authority.denomination(amount)));
  ok(`denominations: ${denominations.map((d) => `${formatAmount(d.amount, d.decimals)} ${d.symbol}`).join(', ')}`);
  const contract = await authority.contractConfig();
  if (contract.issuer_public_key === issuerKey) ok('the contract writes the MPC-derived key into certificates');
  else bad(`contract issuer_public_key ${contract.issuer_public_key} ≠ MPC key ${issuerKey}`);
}
if (authority instanceof SkipMpcCertificateAuthority) {
  const denominations = await Promise.all((await authority.denominations()).map((amount) => authority.denomination(amount)));
  ok(`denominations (from the issuer contract): ${denominations.map((d) => `${formatAmount(d.amount, d.decimals)} ${d.symbol}`).join(', ')}`);
  console.log('  ! NEARCASH_SKIP_MPC: certificates are signed here with the public DEV key, MPC is not checked');
}

// ------------------------------------------------------------------ 2. payments
// The check talks to 1Click even when the server simulates payments.
const originAsset = env.NEARCASH_CHECK_ORIGIN_ASSET ?? 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
// A neutral placeholder for the customer-refund variant: 1Click rejects
// well-known burn addresses such as 0x…dead. Without NEARCASH_CHECK_REFUND_TO
// the quotes refund into the reserve, as for customers who give no address.
const refundTo = env.NEARCASH_CHECK_REFUND_TO;
console.log(`payments: 1Click dry-run quotes from ${originAsset}`);
const confidential = new OneClickGateway(config.payments.oneClick);
const reference = new OneClickGateway({ baseUrl: config.payments.oneClick.baseUrl, recipientType: 'INTENTS' });
// The reference quote needs a real public token id: FAR's IMT ids are not listed by 1Click.
const referenceAsset =
  env.NEARCASH_CHECK_REFERENCE_ASSET ?? config.reserveTokenId ?? 'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';

for (const amount of await authority.denominations()) {
  const denomination = await authority.denomination(amount);
  const label = `${formatAmount(amount, denomination.decimals)} ${denomination.symbol}`;
  // What the sales service asks for (NEARCASH_RESERVE_TOKEN, or the contract's token).
  const destinationAsset = config.reserveTokenId ?? denomination.tokenId;
  const request = {
    originAsset,
    destinationAsset,
    amount,
    conversionPaidBy: payableAtFaceValue(originAsset, destinationAsset) ? ('bank' as const) : ('customer' as const),
    recipient: config.reserveAccountId,
    refund: refundTo ? ({ kind: 'customer', address: refundTo } as const) : ({ kind: 'reserve' } as const),
    deadline: new Date(Date.now() + 30 * 60_000),
  };
  try {
    // Implicit Intents accounts are lowercase hex.
    // The public reference route refunds to a placeholder address on the origin chain.
    const { amountIn } = await reference.checkQuote({
      ...request,
      destinationAsset: referenceAsset,
      recipient: '0x1111111111111111111111111111111111111111',
      refund: { kind: 'customer', address: refundTo ?? '0x2222222222222222222222222222222222222222' },
    });
    ok(`${label}: route available publicly, the customer would pay ${amountIn}`);
  } catch (error) {
    bad(`${label}: no public route (${short(error)})`);
  }
  try {
    const { amountIn } = await confidential.checkQuote(request);
    ok(`${label}: confidential quote to the reserve OK, the customer would pay ${amountIn}`);
  } catch (error) {
    bad(`${label}: confidential quote refused — ${short(error)}`);
  }
}

// ------------------------------------------------------------------ 3. reserve
console.log(`reserve: ${reserve.name}`);
if (reserve instanceof FarReserve && config.reserve.kind === 'far') {
  const { far } = config.reserve;
  ok(`account ${far.reserveAccountId} on ${far.contractId}`);
  const smallest = (await authority.denominations()).reduce((a, b) => (a < b ? a : b));
  const denomination = await authority.denomination(smallest);
  const tokenId = config.reserveTokenId ?? denomination.tokenId;
  const label = `${formatAmount(smallest, denomination.decimals)} ${denomination.symbol}`;
  try {
    await reserve.checkCardTransfer(tokenId, smallest);
    ok(`a ${label} transfer to a card through 1Click arrives whole (no fee)`);
  } catch (error) {
    bad(`transfer to a card refused — ${short(error)}`);
  }
} else {
  bad('FAR reserve not configured (NEARCASH_RESERVE=far, NEARCASH_RESERVE_ACCOUNT, NEARCASH_RESERVE_PRIVATE_KEY)');
}

await app.close();
console.log(problems === 0 ? '\nall checks passed' : `\n${problems} problem(s)`);
process.exitCode = problems === 0 ? 0 : 1;

function short(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  const message = /"message":"([^"]+)"/.exec(text)?.[1];
  return (message ?? text).slice(0, 160);
}
