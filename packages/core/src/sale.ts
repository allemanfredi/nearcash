/**
 * Selling a banknote at the ATM — "blank paper in the cassette".
 *
 * The cassette holds BLANK cards: no funds, no certificate. Value is created
 * only by the issuance server, after it has seen the payment itself:
 *
 *   1. ATM → issuance   createSale(amount)        the server makes a 1Click quote paying the bank's reserve
 *   2. user pays the deposit address shown on the display
 *   3. ATM → issuance   waitForPayment            the server asks 1Click, never the ATM
 *   4. ATM              prepareCard               a blank card creates its keys (signed by its chip key)
 *   5. ATM → issuance   issue(sale, keys, birth)  the server checks the chip's birth, funds the card inside FAR,
 *                                                 MPC signs its certificate
 *   6. ATM              writeCertificate + PIN    the banknote drops
 *
 * The ATM holds no key that creates value. A stolen cassette is worthless
 * plastic; a tampered ATM cannot fake a 1Click payment, and each payment
 * buys exactly one card.
 */
import type { BirthProof } from './birth.ts';
import { bytesToHex, hexToBytes } from './bytes.ts';
import type { NearCashCard } from './card.ts';
import type { Certificate } from './certificate.ts';
import { compressPublicKey } from './certificate.ts';
import { prepareCard, writeCertificate } from './issuance.ts';
import type { TrustedIssuer } from './verify.ts';

/** Life of a sale, as the issuance server reports it. */
export type SaleStatus =
  | 'AWAITING_PAYMENT' // quote made, nothing received yet
  | 'PAID' // 1Click reported SUCCESS: the reserve has the money
  | 'REFUNDED' // the swap failed, the user got the money back: no card
  | 'FAILED'
  | 'EXPIRED'
  | 'ISSUED'; // a card has been funded and certified for this payment

export type Sale = {
  id: string;
  status: SaleStatus;
  /** Banknote value, smallest unit, decimal string. */
  amount: string;
  symbol: string;
  decimals: number;
  /** Where and what the user pays (1Click quote). */
  depositAddress: string;
  originAsset: string;
  /** Amount the user must send, smallest unit of the origin asset. */
  amountIn: string;
  /** After this, an unpaid sale is dead (ISO time). */
  deadline: string;
};

/** A banknote the issuance server can sell, with what an ATM needs to display it. */
export type SaleDenomination = {
  /** Value, smallest unit of the token. */
  amount: bigint;
  symbol: string;
  decimals: number;
};

/** How the issuance server is set up, for ATM displays. */
export type IssuanceInfo = {
  /** True when payments are simulated (development): the /dev routes exist. */
  simulatedPayments: boolean;
};

export type CardPublicKeys = {
  /** Any SEC1 encoding; sent compressed. */
  authPublicKey: Uint8Array;
  fundsPublicKey: Uint8Array;
};

/**
 * A new sale. `refundTo` is optional: the customer's own address on the
 * chain they pay from (for payments sent from an exchange). Without it the
 * issuance server sends any refund back to the address the payment came from.
 */
export type CreateSaleRequest = { amount: bigint; originAsset: string; refundTo?: string };

/** What the ATM can ask the issuance server. */
export interface IssuanceApi {
  createSale(request: CreateSaleRequest): Promise<Sale>;
  getSale(saleId: string): Promise<Sale>;
  /**
   * Funds the card and returns its MPC-signed certificate (bytes). Only for
   * a PAID sale, and (unless the server skips birth certificates for a demo)
   * only for a card born in the bank's factory.
   */
  issue(saleId: string, keys: CardPublicKeys, birth?: BirthProof): Promise<Uint8Array>;
}

/** The issuance server's HTTP API (apps/issuance), authenticated with the ATM's token. */
export class HttpIssuanceClient implements IssuanceApi {
  readonly baseUrl: string;
  private readonly token: string;

  constructor(baseUrl: string, atmToken: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.token = atmToken;
  }

  createSale(request: CreateSaleRequest): Promise<Sale> {
    return this.request<Sale>('POST', '/sales', {
      amount: request.amount.toString(),
      originAsset: request.originAsset,
      ...(request.refundTo ? { refundTo: request.refundTo } : {}),
    });
  }

  getSale(saleId: string): Promise<Sale> {
    return this.request<Sale>('GET', `/sales/${encodeURIComponent(saleId)}`);
  }

  /** The issuer the issuance server signs with (name and compressed public key). */
  async issuer(): Promise<TrustedIssuer> {
    const { name, publicKey } = await this.request<{ name: string; publicKey: string }>('GET', '/issuer');
    return { name, publicKey: hexToBytes(publicKey) };
  }

  /** Allowed banknote amounts, smallest unit. */
  async denominations(): Promise<bigint[]> {
    const { denominations } = await this.request<{ denominations: string[] }>('GET', '/denominations');
    return denominations.map(BigInt);
  }

  /** Allowed banknotes with their token symbol and decimals. */
  async saleDenominations(): Promise<SaleDenomination[]> {
    const { banknotes } = await this.request<{ banknotes: { amount: string; symbol: string; decimals: number }[] }>(
      'GET',
      '/denominations',
    );
    return banknotes.map((banknote) => ({ ...banknote, amount: BigInt(banknote.amount) }));
  }

  /** How the issuance server is set up (simulated or real payments). */
  info(): Promise<IssuanceInfo> {
    return this.request<IssuanceInfo>('GET', '/info');
  }

  /**
   * DEVELOPMENT ONLY: marks the sale's deposit as paid. Works only when the
   * issuance server simulates payments; a real one answers 404.
   */
  simulatePayment(saleId: string): Promise<Sale> {
    return this.request<Sale>('POST', `/dev/sales/${encodeURIComponent(saleId)}/pay`);
  }

  async issue(saleId: string, keys: CardPublicKeys, birth?: BirthProof): Promise<Uint8Array> {
    const { certificate } = await this.request<{ certificate: string }>(
      'POST',
      `/sales/${encodeURIComponent(saleId)}/issue`,
      {
        authPublicKey: bytesToHex(compressPublicKey(keys.authPublicKey)),
        fundsPublicKey: bytesToHex(compressPublicKey(keys.fundsPublicKey)),
        ...(birth
          ? {
              birth: {
                chipPublicKey: bytesToHex(birth.chipPublicKey),
                birthSignature: bytesToHex(birth.birthSignature),
                keysSignature: bytesToHex(birth.keysSignature),
              },
            }
          : {}),
      },
    );
    return hexToBytes(certificate);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`issuance server ${method} ${path} failed (${response.status}): ${text}`);
    return JSON.parse(text) as T;
  }
}

/** A sale that ended without a payment the issuance server accepted. */
export class SaleNotPaidError extends Error {
  readonly sale: Sale;
  constructor(sale: Sale) {
    super(`sale ${sale.id} ended as ${sale.status}: no banknote`);
    this.name = 'SaleNotPaidError';
    this.sale = sale;
  }
}

/**
 * Polls the issuance server until the sale is PAID. Throws SaleNotPaidError if it is
 * refunded, failed or expired, or after `timeoutMs`.
 */
export async function waitForPayment(
  issuance: IssuanceApi,
  saleId: string,
  options: { pollMs?: number; timeoutMs?: number; onStatus?: (sale: Sale) => void } = {},
): Promise<Sale> {
  const pollMs = options.pollMs ?? 3_000;
  const giveUpAt = Date.now() + (options.timeoutMs ?? 30 * 60_000);
  for (;;) {
    const sale = await issuance.getSale(saleId);
    options.onStatus?.(sale);
    if (sale.status === 'PAID' || sale.status === 'ISSUED') return sale;
    if (sale.status === 'REFUNDED' || sale.status === 'FAILED' || sale.status === 'EXPIRED') {
      throw new SaleNotPaidError(sale);
    }
    if (Date.now() > giveUpAt) throw new Error(`gave up waiting for the payment of sale ${saleId}`);
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Steps 4–6 for a PAID sale: a blank card creates its keys, the issuance server funds
 * and certifies it, the ATM writes the certificate and the user's PIN, and
 * verifies the card before it drops.
 */
export async function dispenseBanknote(
  card: NearCashCard,
  issuance: IssuanceApi,
  saleId: string,
  pin: string,
  trustedIssuers: readonly TrustedIssuer[],
): Promise<Certificate> {
  const prepared = await prepareCard(card);
  const certificate = await issuance.issue(saleId, prepared.keys, prepared.birth);
  return writeCertificate(card, certificate, pin, trustedIssuers);
}
