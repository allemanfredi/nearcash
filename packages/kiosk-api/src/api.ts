/**
 * The kiosk API: what the page on the ATM's screen (apps/kiosk) and the
 * ATM server on the Raspberry Pi (apps/atm) say to each other. The page
 * calls it on its own origin: the page's server (Vite) forwards /api to the
 * ATM server, which only listens on the Pi itself.
 *
 *   GET  /api/setup                     what can be sold and how it can be paid
 *   GET  /api/session                   the current sale, or null
 *   POST /api/session                   StartRequest → start a sale (the issuance server makes the quote)
 *   POST /api/session/cancel            give up a sale nobody has paid yet
 *   POST /api/session/finish            the customer is done: back to the start screen
 *   POST /api/session/simulate-payment  DEVELOPMENT ONLY: pay a sale (simulated payments)
 *
 * The page holds no secret: the ATM's token for the issuance server, the
 * cards and the dispenser are all on the ATM server. When the server has a
 * kiosk key, every request carries it in the KIOSK_KEY_HEADER header.
 */
import type { PaymentOption } from './payment-options.ts';

export const KIOSK_KEY_HEADER = 'X-Kiosk-Key';

/** PIN rules of the card (docs/protocol.md §5.7). */
export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 8;

export type Setup = {
  /**
   * Banknotes on sale. `amount` is in the token's smallest unit; `value` is
   * the amount for display, thousands grouped ("10,000"); `label` is value
   * and symbol together ("10,000 USDC").
   */
  banknotes: { amount: string; value: string; symbol: string; label: string }[];
  paymentOptions: readonly PaymentOption[];
  /** Development: payments are simulated and can be paid from the screen. */
  simulatedPayments: boolean;
  /**
   * Test: the printed dummy reader stands in for the NFC reader. A paid sale
   * issues nothing and the card comes out blank (the screen says so).
   */
  dummyReader: boolean;
  /**
   * Why the ATM can't sell right now (e.g. no card reader connected), or
   * null. When set, the screen shows "out of service" and no sale can start.
   */
  outOfService: string | null;
};

export type StartRequest = {
  /** One of Setup.banknotes[].amount. */
  amount: string;
  /** One of Setup.paymentOptions[].id. */
  paymentOptionId: string;
  /**
   * Optional: where a refund goes, on the chain the customer pays from. For
   * customers who pay from an exchange, whose sending address isn't theirs.
   * Without it, the issuance server sends any refund back to the address
   * the payment came from.
   */
  refundTo?: string;
  /** The banknote's PIN, set on the card once the payment arrives. */
  pin: string;
};

/**
 * Where a sale is. The happy path:
 *   awaiting_payment → preparing → certifying → writing → dispensing → dispensed
 * (with the dummy reader: awaiting_payment → dispensing → dispensed, a blank card)
 * and the ends without a banknote: expired, refunded, cancelled, failed.
 */
export type Stage =
  | 'awaiting_payment' // the quote is shown, waiting for the customer's deposit
  | 'preparing' // paid: a blank card from the cassette generates its keys
  | 'certifying' // the issuance server funds the card and NEAR MPC signs its certificate
  | 'writing' // certificate and PIN are written, the card is verified
  | 'dispensing' // the card goes to the tray
  | 'dispensed' // done: take the banknote
  | 'expired' // nobody paid in time
  | 'refunded' // the swap failed: the money went back to the refund address
  | 'cancelled' // the customer gave up before paying
  | 'failed'; // something broke: the operator must look (see `reference`)

export type SessionView = {
  stage: Stage;
  /** Short code the customer can give the operator (start of the sale id). */
  reference: string;
  /** The banknote being bought, e.g. "10 USDC". */
  banknote: string;
  payment: {
    token: string;
    network: string;
    /** What to send, in the token's units, e.g. "10.020613". */
    amount: string;
    depositAddress: string;
    /** ISO time: after this an unpaid quote is dead. */
    deadline: string;
    /** The address the customer gave for refunds, or null: refunds go back to the sending address. */
    refundTo: string | null;
    simulated: boolean;
  };
  /** Shown on the "failed" screen. */
  problem?: string;
};

/** Error body of every non-2xx answer. */
export type ApiError = { error: string };
