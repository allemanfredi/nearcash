/**
 * Puts money into the bank's reserve: you send USDC from Base, the reserve
 * receives USDC on Ethereum inside FAR (its token, the one cards get).
 *
 *   pnpm issuance:fund-reserve 5                     you will send exactly 5 USDC on Base
 *   pnpm issuance:fund-reserve 5 --refund-to 0x…     a failed conversion goes back to 0x… on Base
 *   pnpm issuance:fund-reserve --status <address>    follow a deposit address made before
 *
 * It asks 1Click for a deposit address on Base whose recipient is the
 * reserve (confidential), shows it with a QR code for your wallet, and waits
 * until 1Click says the USDC reached the reserve. Nothing moves until you
 * send. Without --refund-to, a failed conversion is refunded into the
 * reserve itself, as USDC on Base: the money stays the bank's.
 *
 * Settings come from .env.issuance (the reserve's account, the 1Click
 * partner key), like the issuance server's.
 */
import { formatAmount } from '@nearcash/core';
import QRCode from 'qrcode';
import { issuanceConfigFromEnvironment, loadIssuanceEnvironment } from './config/issuance-config.ts';
import { OneClickClient } from './features/payments/one-click.client.ts';
import {
  FUNDING_SLIPPAGE_BASIS_POINTS,
  describeFundingStatus,
  fundingQuote,
  isEvmAddress,
  parseUsdc,
} from './features/reserve/reserve-funding.ts';
import { USDC } from './features/sales/face-value.ts';

/** How long the deposit address takes payments: then 1Click refunds what has not been converted. */
const DEPOSIT_MINUTES = 30;
const POLL_MS = 5_000;
const USAGE = [
  'usage:',
  '  pnpm issuance:fund-reserve <USDC amount> [--refund-to <your Base address>]',
  '  pnpm issuance:fund-reserve --status <deposit address>',
].join('\n');

/** The part of 1Click's answers this script reads. */
type QuoteAnswer = {
  quote?: { depositAddress?: string; amountInFormatted?: string; amountOutFormatted?: string; minAmountOut?: string };
};
type StatusAnswer = {
  status?: string;
  swapDetails?: { depositedAmountFormatted?: string; amountOutFormatted?: string; refundedAmountFormatted?: string; refundReason?: string | null };
  quoteResponse?: { quoteRequest?: { deadline?: string } };
};

const config = issuanceConfigFromEnvironment(loadIssuanceEnvironment());
// Real money: refuse a configuration that would not send it to the real reserve, in its token.
if (config.reserve.kind !== 'far') fail('NEARCASH_RESERVE is not "far" in .env.issuance: there is no real reserve to fund');
if (config.reserveTokenId !== USDC.ethereum) {
  fail(`the reserve's token (NEARCASH_RESERVE_TOKEN) is ${config.reserveTokenId ?? 'not set'}, not USDC on Ethereum: this script would fill the wrong token`);
}
const client = new OneClickClient(config.payments.oneClick);
const reserveAccountId = config.reserve.far.reserveAccountId;

const args = process.argv.slice(2);
if (args[0] === '--status') {
  const depositAddress = args[1];
  if (!depositAddress || args.length > 2) fail(USAGE);
  await follow(depositAddress);
} else {
  await fund(args);
}

/** Makes the deposit address, shows it, then follows it. */
async function fund(args: string[]): Promise<void> {
  const [amountText, ...options] = args;
  if (!amountText || amountText.startsWith('--')) fail(USAGE);
  let refundTo: string | undefined;
  if (options.length > 0) {
    if (options[0] !== '--refund-to' || options.length !== 2) fail(USAGE);
    refundTo = options[1]!;
    if (!isEvmAddress(refundTo)) fail(`--refund-to: "${refundTo}" is not a Base address (0x and 40 hex digits)`);
  }
  let amount: bigint;
  try {
    amount = parseUsdc(amountText);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }

  const deadline = new Date(Date.now() + DEPOSIT_MINUTES * 60_000);
  let answer: QuoteAnswer;
  try {
    answer = await client.call<QuoteAnswer>('POST', '/v0/quote', fundingQuote({ amount, reserveAccountId, refundTo, deadline }));
  } catch (error) {
    // e.g. an amount under 1Click's minimum for Base.
    fail(`1Click refused the quote: ${error instanceof Error ? error.message : String(error)}`);
  }
  const quote = answer.quote;
  if (!quote?.depositAddress) fail(`1Click answered without a deposit address: ${JSON.stringify(answer)}`);

  const send = formatAmount(amount, 6);
  const atLeast = quote.minAmountOut ? formatAmount(BigInt(quote.minAmountOut), 6) : '?';
  console.log('');
  console.log(`  Send exactly ${send} USDC on Base to:`);
  console.log('');
  console.log(`  ${quote.depositAddress}`);
  console.log('');
  console.log(await QRCode.toString(quote.depositAddress, { type: 'terminal', small: true }));
  console.log(`  The reserve (${shortAccount(reserveAccountId)}) receives about ${quote.amountOutFormatted ?? '?'} USDC on Ethereum,`);
  console.log(`  at least ${atLeast} (a ${FUNDING_SLIPPAGE_BASIS_POINTS / 100} % margin; beyond it 1Click refunds instead).`);
  console.log(`  Only USDC, only on Base. Send before ${deadline.toLocaleTimeString()}; after that it is refunded`);
  console.log(`  ${refundTo ? `to ${refundTo} on Base` : 'into the reserve, as USDC on Base'}.`);
  console.log('');
  await follow(quote.depositAddress, deadline);
}

/**
 * Asks 1Click every few seconds until the deposit is done, refunded or
 * failed. Stops too when the deadline passed and nothing arrived: that
 * address must not be paid any more.
 */
async function follow(depositAddress: string, knownDeadline?: Date): Promise<void> {
  // Ctrl+C stops watching, nothing else: the deposit goes on without the script.
  process.on('SIGINT', () => {
    console.log(`\n  Stopped watching. To follow it again: pnpm issuance:fund-reserve --status ${depositAddress}`);
    process.exit(130);
  });

  let last = '';
  for (;;) {
    let answer: StatusAnswer | undefined;
    try {
      answer = await client.call<StatusAnswer>('GET', `/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`);
    } catch (error) {
      console.log(`  ${time()}  cannot read the status, trying again (${error instanceof Error ? error.message : String(error)})`);
    }
    if (answer) {
      const status = answer.status ?? '';
      const { text, final } = describeFundingStatus(status);
      if (status !== last) {
        console.log(`  ${time()}  ${text}`);
        last = status;
      }
      if (final) {
        report(status, answer);
        return;
      }
      // The deadline 1Click was asked for (the quote's own `deadline` is days later: see one-click.gateway.ts).
      const deadlineText = knownDeadline?.toISOString() ?? answer.quoteResponse?.quoteRequest?.deadline;
      if (status === 'PENDING_DEPOSIT' && deadlineText && Date.now() > new Date(deadlineText).getTime()) {
        console.log(`  ${time()}  the deadline passed and nothing arrived: do not send to this address any more.`);
        process.exitCode = 1;
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
}

/** The outcome, with the amounts 1Click reports. */
function report(status: string, answer: StatusAnswer): void {
  const details = answer.swapDetails ?? {};
  if (details.depositedAmountFormatted) console.log(`  received on Base:      ${details.depositedAmountFormatted} USDC`);
  if (status === 'SUCCESS' && details.amountOutFormatted) console.log(`  delivered to reserve:  ${details.amountOutFormatted} USDC on Ethereum`);
  if (details.refundedAmountFormatted && details.refundedAmountFormatted !== '0') {
    console.log(`  refunded:              ${details.refundedAmountFormatted} USDC${details.refundReason ? ` (${details.refundReason})` : ''}`);
  }
  if (status !== 'SUCCESS') process.exitCode = 1;
}

function shortAccount(account: string): string {
  return account.length > 16 ? `${account.slice(0, 8)}…${account.slice(-6)}` : account;
}

function time(): string {
  return new Date().toLocaleTimeString();
}

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}
