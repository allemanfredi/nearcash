/**
 * Test doubles for the ATM server: an issuance server that keeps sales in
 * memory and certifies with the public DEV issuer, and hardware that counts
 * what it was asked to do.
 */
import {
  type BirthProof,
  type CardPublicKeys,
  type CreateSaleRequest,
  DEV_DENOMINATION,
  DEV_ISSUER,
  DEV_ISSUER_SIGNER,
  type IssuanceInfo,
  type NearCashCard,
  type Sale,
  type SaleDenomination,
  type SaleStatus,
  type TrustedIssuer,
  issueCertificate,
  issueDay,
} from '@nearcash/core';
import type { OperatorLog } from '../src/server/common/operator-log.ts';
import type { Cassette, Dispenser } from '../src/server/features/hardware/hardware.ports.ts';
import type { AtmIssuanceApi } from '../src/server/features/issuance/issuance.port.ts';

export const BANKNOTE = DEV_DENOMINATION; // 0.01 ETH
export const EVM_ADDRESS = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed'; // EIP-55 example

export class FakeIssuance implements AtmIssuanceApi {
  readonly sales = new Map<string, Sale>();
  /** Requests seen by createSale, to check what the ATM asked for. */
  readonly created: CreateSaleRequest[] = [];
  simulatedPayments = true;
  /** When true, getSale throws (the issuance server is unreachable). */
  unreachable = false;
  /** How long a new quote stays payable. */
  paymentWindowMs = 60_000;
  issued = 0;
  private counter = 0;

  async issuer(): Promise<TrustedIssuer> {
    return DEV_ISSUER;
  }

  async saleDenominations(): Promise<SaleDenomination[]> {
    return [{ amount: BANKNOTE.amount, symbol: BANKNOTE.symbol, decimals: BANKNOTE.decimals }];
  }

  async info(): Promise<IssuanceInfo> {
    return { simulatedPayments: this.simulatedPayments };
  }

  async createSale(request: CreateSaleRequest): Promise<Sale> {
    this.created.push(request);
    this.counter += 1;
    const sale: Sale = {
      id: `sale-${this.counter}-0000-0000`,
      status: 'AWAITING_PAYMENT',
      amount: request.amount.toString(),
      symbol: BANKNOTE.symbol,
      decimals: BANKNOTE.decimals,
      depositAddress: `deposit-${this.counter}`,
      originAsset: request.originAsset,
      amountIn: request.amount.toString(),
      deadline: new Date(Date.now() + this.paymentWindowMs).toISOString(),
    };
    this.sales.set(sale.id, sale);
    return { ...sale };
  }

  async getSale(saleId: string): Promise<Sale> {
    if (this.unreachable) throw new Error('connection refused');
    return { ...this.require(saleId) };
  }

  /** The birth certificates the ATM sent along with the keys, in order. */
  readonly births: (BirthProof | undefined)[] = [];

  async issue(saleId: string, keys: CardPublicKeys, birth?: BirthProof): Promise<Uint8Array> {
    this.births.push(birth);
    const sale = this.require(saleId);
    if (sale.status !== 'PAID') throw new Error(`sale is ${sale.status}`);
    this.issued += 1;
    const certificate = await issueCertificate(
      {
        authPublicKey: keys.authPublicKey,
        fundsPublicKey: keys.fundsPublicKey,
        amount: BANKNOTE.amount,
        decimals: BANKNOTE.decimals,
        issuedAt: issueDay(),
        tokenId: BANKNOTE.tokenId,
        symbol: BANKNOTE.symbol,
        contractId: BANKNOTE.contractId,
      },
      DEV_ISSUER_SIGNER,
    );
    sale.status = 'ISSUED';
    return certificate.bytes;
  }

  async simulatePayment(saleId: string): Promise<Sale> {
    this.setStatus(saleId, 'PAID');
    return this.getSale(saleId);
  }

  /** What 1Click (through the issuance server) would report next. */
  setStatus(saleId: string, status: SaleStatus): void {
    this.require(saleId).status = status;
  }

  /** The id of the only (or first) sale created. */
  firstSaleId(): string {
    return [...this.sales.keys()][0]!;
  }

  private require(saleId: string): Sale {
    const sale = this.sales.get(saleId);
    if (!sale) throw new Error(`unknown sale ${saleId}`);
    return sale;
  }
}

/** Hands out cards from `next`, or fails when there is none; `unavailable` puts the ATM out of service. */
export class CountingCassette implements Cassette {
  readonly name = 'test cassette';
  /** true: behaves as the printed dummy reader (nothing issued, the card handed out blank). */
  dummy = false;
  taken = 0;
  next: (() => Promise<NearCashCard>) | undefined;
  unavailable: string | null = null;

  async unavailableReason(): Promise<string | null> {
    return this.unavailable;
  }

  async nextBlankCard(): Promise<NearCashCard> {
    this.taken += 1;
    if (!this.next) throw new Error('cassette empty');
    return this.next();
  }
}

export class CountingDispenser implements Dispenser {
  readonly name = 'test dispenser';
  dispensed = 0;
  /** When set, dispense() fails with it (e.g. a servo that can't be driven). */
  failure: Error | undefined;
  async dispense(): Promise<void> {
    if (this.failure) throw this.failure;
    this.dispensed += 1;
  }
}

/** Keeps the operator's log lines. */
export class RecordingLog implements OperatorLog {
  readonly lines: string[] = [];
  log(message: string): void {
    this.lines.push(message);
  }
  includes(text: string): boolean {
    return this.lines.some((line) => line.includes(text));
  }
}

/** Waits until `condition` holds (polling), or fails after `timeoutMs`. */
export async function waitUntil(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const giveUpAt = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > giveUpAt) throw new Error('timed out waiting for a condition');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
