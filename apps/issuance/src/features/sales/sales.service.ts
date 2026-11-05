/**
 * Selling a banknote: the only place where banknotes get their value.
 *
 * Rules, each enforced here and covered by test/sales.service.test.ts:
 *  1. Only the issuance server creates quotes; the recipient is always the
 *     bank's reserve. A refund goes to the address the customer gave or,
 *     without one, into the reserve, which sends it back to the address
 *     the payment came from (features/refunds). Never to a card.
 *  2. A card is funded and certified only after the server itself has read
 *     SUCCESS for that quote from the payment gateway. ATMs are never believed.
 *  3. One payment buys exactly one card: the first card presented is bound
 *     to the sale; any other card is refused, the same card gets the same
 *     certificate back (safe retry).
 *  4. A card is never funded twice: if a transfer was started but its result
 *     is unknown (crash), the sale stops for a manual check.
 *  5. The certificate carries the issue day only (no time of purchase).
 */
import { randomUUID } from 'node:crypto';
import {
  type CardPublicKeys,
  type Sale,
  bytesToHex,
  compressPublicKey,
  ethereumAddress,
  hexToBytes,
  issueDay,
} from '@nearcash/core';
import { Inject, Injectable } from '@nestjs/common';
import { CLOCK, type Clock } from '../../common/clock.ts';
import { DomainError } from '../../common/domain-error.ts';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { CertificatesService } from '../certificates/certificates.service.ts';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway.port.ts';
import { RESERVE, type Reserve } from '../reserve/reserve.port.ts';
import { type SaleRecord, toPublicSale } from './sale-record.ts';
import { SALE_REPOSITORY, type SaleRepository } from './sale-repository.port.ts';

/** `refundTo`: optional, the customer's own address on the chain they pay from. */
export type CreateSaleRequest = { amount: bigint; originAsset: string; refundTo?: string };

@Injectable()
export class SalesService {
  /** One issue() at a time per sale: no double funding by concurrent calls. */
  private readonly locks = new Map<string, Promise<unknown>>();

  constructor(
    @Inject(SALE_REPOSITORY) private readonly sales: SaleRepository,
    @Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway,
    @Inject(RESERVE) private readonly reserve: Reserve,
    private readonly certificates: CertificatesService,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ISSUANCE_CONFIG) private readonly config: IssuanceConfig,
  ) {}

  /** Rule 1: a quote paying the reserve exactly the banknote's value. */
  async createSale(request: CreateSaleRequest): Promise<Sale> {
    const denomination = await this.certificates.denomination(request.amount);
    if (!request.originAsset) throw new DomainError('invalid-request', 'originAsset is required');

    const deadline = new Date(this.clock.now().getTime() + this.config.paymentWindowMinutes * 60_000);
    const quote = await this.gateway.createQuote({
      originAsset: request.originAsset,
      destinationAsset: this.reserveToken(denomination.tokenId),
      amountOut: request.amount,
      recipient: this.config.reserveAccountId,
      refund: request.refundTo ? { kind: 'customer', address: request.refundTo } : { kind: 'reserve' },
      deadline,
    });

    const record: SaleRecord = {
      id: randomUUID(),
      status: 'AWAITING_PAYMENT',
      amount: request.amount.toString(),
      symbol: denomination.symbol,
      decimals: denomination.decimals,
      depositAddress: quote.depositAddress,
      originAsset: quote.originAsset,
      amountIn: quote.amountIn,
      deadline: quote.deadline,
      ...(request.refundTo ? { refundTo: request.refundTo } : {}),
      createdAt: this.clock.now().toISOString(),
    };
    this.sales.put(record);
    return toPublicSale(record);
  }

  /** The sale, with its payment status refreshed from the gateway. */
  async getSale(id: string): Promise<Sale> {
    const record = this.requireSale(id);
    if (record.status === 'AWAITING_PAYMENT' || record.status === 'PAID') {
      const payment = await this.gateway.status(record.depositAddress);
      const next =
        payment === 'SUCCESS'
          ? 'PAID'
          : payment === 'REFUNDED'
            ? 'REFUNDED'
            : payment === 'FAILED'
              ? 'FAILED'
              : this.clock.now() > new Date(record.deadline)
                ? 'EXPIRED'
                : 'AWAITING_PAYMENT';
      if (next !== record.status) {
        record.status = next;
        this.sales.put(record);
      }
    }
    return toPublicSale(record);
  }

  /** Rules 2–5: fund the card inside FAR, then have its certificate signed. */
  issue(id: string, keys: CardPublicKeys): Promise<Uint8Array> {
    // Serialise per sale (rule 4 relies on it).
    const previous = this.locks.get(id) ?? Promise.resolve();
    const run = previous.catch(() => undefined).then(() => this.issueNow(id, keys));
    this.locks.set(id, run);
    return run;
  }

  /** The deposit address of a sale (development: to settle a simulated payment). */
  depositAddressOf(id: string): string {
    return this.requireSale(id).depositAddress;
  }

  private async issueNow(id: string, keys: CardPublicKeys): Promise<Uint8Array> {
    const record = this.requireSale(id);
    let authKey: string;
    let fundsKey: string;
    try {
      authKey = bytesToHex(compressPublicKey(keys.authPublicKey));
      fundsKey = bytesToHex(compressPublicKey(keys.fundsPublicKey));
    } catch {
      throw new DomainError('invalid-request', 'card keys are not valid secp256k1 keys');
    }

    // Rule 3: the first card presented owns this payment.
    if (record.card && (record.card.authPublicKey !== authKey || record.card.fundsPublicKey !== fundsKey)) {
      throw new DomainError('conflict', 'this payment already belongs to another card');
    }
    if (record.certificate) return hexToBytes(record.certificate); // same card, safe retry

    // Rule 2: ask the gateway, now. Never the ATM, never a cached answer.
    const payment = await this.gateway.status(record.depositAddress);
    if (payment !== 'SUCCESS') {
      throw new DomainError('payment-required', `payment not confirmed (${payment}): no banknote`);
    }

    const denomination = await this.certificates.denomination(BigInt(record.amount));
    if (!record.card) {
      record.card = {
        authPublicKey: authKey,
        fundsPublicKey: fundsKey,
        accountId: ethereumAddress(keys.fundsPublicKey),
        issuedAt: issueDay(this.clock.now()), // rule 5
      };
      record.status = 'PAID';
      this.sales.put(record);
    }

    // Rule 4: fund once. Mark the attempt before making it.
    if (!record.fundingReference) {
      if (record.fundingStarted) {
        throw new DomainError('needs-operator', 'funding of this card was interrupted: check the reserve before retrying');
      }
      record.fundingStarted = true;
      this.sales.put(record);
      record.fundingReference = await this.reserve.fundCard({
        cardAccountId: record.card.accountId,
        tokenId: this.reserveToken(denomination.tokenId),
        amount: denomination.amount,
      });
      this.sales.put(record);
    }

    // The card is funded: have the certificate signed (MPC) and remember it.
    const certificate = await this.certificates.certify({
      authPublicKey: hexToBytes(record.card.authPublicKey),
      fundsPublicKey: hexToBytes(record.card.fundsPublicKey),
      amount: denomination.amount,
      decimals: denomination.decimals,
      issuedAt: record.card.issuedAt,
      tokenId: denomination.tokenId,
      symbol: denomination.symbol,
      contractId: denomination.contractId,
    });
    record.certificate = bytesToHex(certificate.bytes);
    record.status = 'ISSUED';
    this.sales.put(record);
    return certificate.bytes;
  }

  /**
   * The token the reserve receives and sends to cards: NEARCASH_RESERVE_TOKEN
   * if set (e.g. while the issuer contract still names a placeholder token),
   * otherwise the banknote's token in the issuer contract.
   */
  private reserveToken(banknoteTokenId: string): string {
    return this.config.reserveTokenId ?? banknoteTokenId;
  }

  private requireSale(id: string): SaleRecord {
    const record = this.sales.get(id);
    if (!record) throw new DomainError('not-found', `unknown sale ${id}`);
    return record;
  }
}
