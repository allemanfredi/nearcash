import { type Sale, formatAmount } from '@nearcash/core';
import type { PaymentOption, SessionView, Stage } from '@nearcash/kiosk-api';

/** The sale in progress at the ATM. */
export type SaleSession = {
  sale: Sale;
  option: PaymentOption;
  /** The customer's refund address, or null: refunds go back to the sending address. */
  refundTo: string | null;
  /** The banknote's PIN: emptied as soon as it is no longer needed. */
  pin: string;
  stage: Stage;
  simulated: boolean;
  problem?: string;
};

/** Stages after which nothing more happens: the screen can go back to the start. */
export const FINAL_STAGES: ReadonlySet<Stage> = new Set(['dispensed', 'expired', 'refunded', 'cancelled', 'failed']);

/** What the screen may know about a sale: never the PIN. */
export function toSessionView(session: SaleSession): SessionView {
  const { sale, option } = session;
  const banknote = `${formatAmount(BigInt(sale.amount), sale.decimals)} ${sale.symbol}`;
  // Simulated payments are 1:1 in the banknote's own token (no swap), so the
  // amount to "send" is the banknote's value. Real quotes are in the origin
  // asset's units.
  const amount = session.simulated
    ? formatAmount(BigInt(sale.amountIn), sale.decimals)
    : formatAmount(BigInt(sale.amountIn), option.decimals);
  return {
    stage: session.stage,
    reference: sale.id.slice(0, 8).toUpperCase(),
    banknote,
    payment: {
      token: session.simulated ? sale.symbol : option.token,
      network: option.network,
      amount,
      depositAddress: sale.depositAddress,
      deadline: sale.deadline,
      refundTo: session.refundTo,
      simulated: session.simulated,
    },
    ...(session.problem ? { problem: session.problem } : {}),
  };
}
