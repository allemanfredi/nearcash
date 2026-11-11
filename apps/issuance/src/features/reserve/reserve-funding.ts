/**
 * Putting money into the reserve by hand: USDC sent from Base, delivered to
 * the reserve inside FAR as USDC on Ethereum (the reserve's token). Used by
 * `pnpm issuance:fund-reserve` (src/fund-reserve.ts).
 *
 * Why the reserve needs money of its own: a customer paying in USDC on
 * another chain sends exactly the banknote's value and the bank pays the
 * conversion (sales/face-value.ts), so the reserve adds a little from its
 * own balance to every card it funds.
 */
import { USDC } from '../sales/face-value.ts';

/** USDC has 6 decimals on every chain the ATM takes it from. */
const USDC_DECIMALS = 6;

/** The margin of the conversion, in basis points: below it, 1Click refunds instead of delivering less. */
export const FUNDING_SLIPPAGE_BASIS_POINTS = 100;

/**
 * "5" or "2.5" (USDC) → smallest unit (6 decimals). Refuses anything else:
 * a typo here would ask for the wrong amount of real money.
 */
export function parseUsdc(text: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!match) throw new Error(`"${text}" is not a USDC amount (e.g. 5 or 2.5, at most ${USDC_DECIMALS} decimals)`);
  const whole = BigInt(match[1]!);
  const fraction = BigInt((match[2] ?? '').padEnd(USDC_DECIMALS, '0'));
  const amount = whole * 10n ** BigInt(USDC_DECIMALS) + fraction;
  if (amount === 0n) throw new Error('the amount must be more than 0');
  return amount;
}

/** A Base address, where a failed conversion is refunded. */
export function isEvmAddress(text: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(text);
}

export type FundingRequest = {
  /** What you send on Base, smallest unit. */
  amount: bigint;
  /** The reserve's account inside FAR. */
  reserveAccountId: string;
  /** Where a failed conversion goes: your Base address, or (undefined) the reserve itself. */
  refundTo?: string;
  /** After it, 1Click refunds whatever was not converted. */
  deadline: Date;
};

/**
 * The 1Click quote: USDC on Base in, USDC on Ethereum out, the reserve
 * inside FAR as recipient (CONFIDENTIAL_INTENTS, as for every payment).
 *
 * EXACT_INPUT: you send exactly `amount`; the reserve receives what the
 * conversion leaves (about 0.02 % less on 2026-11-11).
 *
 * Refunds: to your Base address if you give one; otherwise into the
 * reserve, as USDC on Base. Either way the money is not lost, and the
 * reserve never refunds to a card.
 */
export function fundingQuote(request: FundingRequest) {
  const refund = request.refundTo
    ? { refundTo: request.refundTo, refundType: 'ORIGIN_CHAIN' }
    : { refundTo: request.reserveAccountId, refundType: 'CONFIDENTIAL_INTENTS' };
  return {
    dry: false,
    swapType: 'EXACT_INPUT',
    slippageTolerance: FUNDING_SLIPPAGE_BASIS_POINTS,
    originAsset: USDC.base,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: USDC.ethereum,
    amount: request.amount.toString(),
    recipient: request.reserveAccountId,
    recipientType: 'CONFIDENTIAL_INTENTS',
    ...refund,
    deadline: request.deadline.toISOString(),
  };
}

/**
 * What a 1Click status means for you, sending the money. `final`: nothing
 * will change any more.
 */
export function describeFundingStatus(status: string): { text: string; final: boolean } {
  switch (status) {
    case 'PENDING_DEPOSIT':
      return { text: 'waiting for your USDC on Base', final: false };
    case 'KNOWN_DEPOSIT_TX':
      return { text: 'your transaction is seen, waiting for Base to confirm it', final: false };
    case 'INCOMPLETE_DEPOSIT':
      return { text: 'less than the amount arrived: send the rest before the deadline, or it is refunded', final: false };
    case 'PROCESSING':
      return { text: 'received, converting into USDC on Ethereum', final: false };
    case 'SUCCESS':
      return { text: 'done: the reserve received the USDC', final: true };
    case 'REFUNDED':
      return { text: 'refunded: the conversion did not happen', final: true };
    case 'FAILED':
      return { text: 'failed', final: true };
    default:
      return { text: `1Click says ${status || 'nothing'}`, final: false };
  }
}
