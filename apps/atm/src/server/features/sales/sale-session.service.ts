/**
 * The ATM's sale, one at a time, from the quote to the banknote in the tray.
 *
 *   start()   the customer picked a banknote, how to pay (network and token),
 *             maybe a refund address, and a PIN → the issuance server makes
 *             the quote (deposit address)
 *   watch     the ATM polls the ISSUANCE SERVER (never the customer, never
 *             the chain) until the sale is PAID, refunded or expired
 *   issue     paid → the pusher loads the next blank card into the reader
 *             (with the servos) and it generates its keys →
 *             the server funds and certifies it (NEAR MPC) → certificate and
 *             PIN are written and the card is verified → it is dispensed
 *             (with the printed dummy reader: nothing is issued, the card is
 *             dispensed blank, to test the sale and the mechanics)
 *             Each step shows on the kiosk for minStepMs at least, even when
 *             it is simulated or takes no time.
 *
 * The PIN is chosen before paying, so the banknote comes out on its own as
 * soon as the money arrives. It lives only in memory and is dropped once
 * written to the card (or when the sale ends without a card).
 */
import { type Sale, type TrustedIssuer, prepareCard, writeCertificate } from '@nearcash/core';
import { Inject, Injectable } from '@nestjs/common';
import {
  type SessionView,
  type Stage,
  type StartRequest,
  findPaymentOption,
  PIN_MAX_LENGTH,
  PIN_MIN_LENGTH,
  refundAddressProblem,
} from '@nearcash/kiosk-api';
import { DomainError } from '../../common/domain-error.ts';
import { OPERATOR_LOG, type OperatorLog } from '../../common/operator-log.ts';
import { ATM_CONFIG, type AtmConfig } from '../../config/atm-config.ts';
import { CatalogService } from '../catalog/catalog.service.ts';
import { CASSETTE, type Cassette, DISPENSER, type Dispenser } from '../hardware/hardware.ports.ts';
import { type AtmIssuanceApi, ISSUANCE, TRUSTED_ISSUERS } from '../issuance/issuance.port.ts';
import { FINAL_STAGES, type SaleSession, toSessionView } from './sale-session.ts';

@Injectable()
export class SaleSessionService {
  private session: SaleSession | undefined;
  /** True while start() waits for the issuance server: no second sale meanwhile. */
  private starting = false;

  constructor(
    @Inject(ISSUANCE) private readonly issuance: AtmIssuanceApi,
    @Inject(CASSETTE) private readonly cassette: Cassette,
    @Inject(DISPENSER) private readonly dispenser: Dispenser,
    @Inject(TRUSTED_ISSUERS) private readonly trustedIssuers: readonly TrustedIssuer[],
    private readonly catalog: CatalogService,
    @Inject(ATM_CONFIG) private readonly config: Pick<AtmConfig, 'pollMs' | 'graceMs' | 'minStepMs'>,
    @Inject(OPERATOR_LOG) private readonly log: OperatorLog,
  ) {}

  /** The current sale as the screen shows it, or null when the ATM is free. */
  view(): SessionView | null {
    return this.session ? toSessionView(this.session) : null;
  }

  /** Starts a sale: checks the request, then has the issuance server make the quote. */
  async start(request: StartRequest): Promise<SessionView> {
    if (this.starting || (this.session && !FINAL_STAGES.has(this.session.stage))) {
      throw new DomainError('conflict', 'a sale is already in progress');
    }
    this.starting = true;
    try {
      const setup = await this.catalog.setup();
      // Never take a payment that can't become a banknote.
      if (setup.outOfService) throw new DomainError('unavailable', `out of service: ${setup.outOfService}`);
      if (!setup.banknotes.some((banknote) => banknote.amount === request.amount)) {
        throw new DomainError('invalid-request', 'this banknote is not on sale');
      }
      const option = findPaymentOption(request.paymentOptionId);
      if (!option) throw new DomainError('invalid-request', 'unknown payment option');
      // A refund address is optional (customers paying from an exchange give
      // one). Without it, the issuance server returns refunds to the sender.
      const refundTo = request.refundTo || undefined;
      if (refundTo) {
        const addressProblem = refundAddressProblem(option.addressKind, refundTo);
        if (addressProblem) throw new DomainError('invalid-request', addressProblem);
      }
      if (!new RegExp(`^[0-9]{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(request.pin)) {
        throw new DomainError('invalid-request', `the PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits`);
      }

      const sale = await this.issuance.createSale({
        amount: BigInt(request.amount),
        originAsset: option.assetId,
        ...(refundTo ? { refundTo } : {}),
      });
      const session: SaleSession = {
        sale,
        option,
        refundTo: refundTo ?? null,
        pin: request.pin,
        stage: 'awaiting_payment',
        simulated: setup.simulatedPayments,
      };
      this.session = session;
      this.log.log(
        `[sale ${sale.id}] ${toSessionView(session).banknote}, pay with ${option.token} on ${option.network}, ` +
          (refundTo ? `refunds to ${refundTo}` : 'refunds back to the sender'),
      );
      void this.watch(session);
      return toSessionView(session);
    } finally {
      this.starting = false;
    }
  }

  /** The customer gives up before paying. */
  cancel(): SessionView {
    const session = this.requireSession();
    if (session.stage !== 'awaiting_payment') throw new DomainError('conflict', 'only an unpaid sale can be cancelled');
    session.stage = 'cancelled';
    session.pin = '';
    this.log.log(`[sale ${session.sale.id}] cancelled by the customer`);
    return toSessionView(session);
  }

  /** The customer is done with a finished sale: the ATM is free again. */
  finish(): void {
    const session = this.requireSession();
    if (!FINAL_STAGES.has(session.stage)) throw new DomainError('conflict', 'the sale is still in progress');
    this.session = undefined;
  }

  /** DEVELOPMENT ONLY: pays the current sale, when the issuance server simulates payments. */
  async simulatePayment(): Promise<void> {
    const session = this.requireSession();
    if (!session.simulated) throw new DomainError('not-found', 'payments are real: they cannot be simulated');
    if (session.stage !== 'awaiting_payment') throw new DomainError('conflict', 'the sale is not waiting for a payment');
    await this.issuance.simulatePayment(session.sale.id);
  }

  // ------------------------------------------------------------ internals

  private requireSession(): SaleSession {
    if (!this.session) throw new DomainError('not-found', 'no sale in progress');
    return this.session;
  }

  /** Polls the issuance server until the sale is paid (then issues) or ends without payment. */
  private async watch(session: SaleSession): Promise<void> {
    const id = session.sale.id;
    const giveUpAt = new Date(session.sale.deadline).getTime() + this.config.graceMs;

    for (;;) {
      let sale: Sale | undefined;
      try {
        sale = await this.issuance.getSale(id);
      } catch (error) {
        this.log.log(`[sale ${id}] cannot reach the issuance server, retrying: ${message(error)}`);
      }
      if (sale) {
        session.sale = sale;
        if (sale.status === 'PAID' || sale.status === 'ISSUED') break;
        if (sale.status === 'REFUNDED' || sale.status === 'FAILED' || sale.status === 'EXPIRED') {
          if (session.stage === 'awaiting_payment') {
            session.stage = sale.status === 'REFUNDED' ? 'refunded' : sale.status === 'EXPIRED' ? 'expired' : 'failed';
            if (sale.status === 'FAILED') session.problem = 'The payment failed.';
          }
          session.pin = '';
          this.log.log(`[sale ${id}] ended without payment: ${sale.status}`);
          return;
        }
      }
      if (Date.now() > giveUpAt) {
        this.fail(session, 'Lost contact with the issuance server.');
        return;
      }
      await sleep(this.config.pollMs);
    }

    if (session.stage === 'cancelled') {
      // Paid after the customer walked away: nobody is there to take the
      // banknote, so none is made. The sale stays PAID at the issuance server.
      this.log.log(`[sale ${id}] OPERATOR: paid after it was cancelled. No banknote dispensed; resolve it with the issuance server.`);
      return;
    }
    await this.issue(session);
  }

  /** Paid: make the banknote and hand it out. A card that fails is never dispensed. */
  private async issue(session: SaleSession): Promise<void> {
    if (this.cassette.dummy) return this.handOutBlankCard(session);
    const id = session.sale.id;
    try {
      const { card, prepared } = await this.step(session, 'preparing', async () => {
        const card = await this.cassette.nextBlankCard();
        return { card, prepared: await prepareCard(card) };
      });
      // The chip's birth certificate goes along: the issuance server checks it before funding.
      const certificate = await this.step(session, 'certifying', () => this.issuance.issue(id, prepared.keys, prepared.birth));
      await this.step(session, 'writing', async () => {
        await writeCertificate(card, certificate, session.pin, this.trustedIssuers);
        session.pin = '';
      });
      await this.step(session, 'dispensing', () => this.dispenser.dispense());
      session.stage = 'dispensed';
      this.log.log(`[sale ${id}] banknote dispensed`);
    } catch (error) {
      this.fail(session, message(error));
    }
  }

  /**
   * Paid, with the printed dummy reader in the turret (NEARCASH_CASSETTE=dummy):
   * there is no chip to talk to, so nothing is issued (no card keys, no
   * funding, no certificate, no PIN) and the card comes out blank. The kiosk
   * still shows every step, each for minStepMs, as for a real banknote: a demo
   * shows the whole issuing. The sale stays PAID at the issuance server: with
   * real payments, the money waits in the reserve until the operator refunds it.
   */
  private async handOutBlankCard(session: SaleSession): Promise<void> {
    const id = session.sale.id;
    session.pin = '';
    this.log.log(
      `[sale ${id}] DUMMY READER: nothing is issued, the card comes out blank; ` +
        (session.simulated
          ? 'payments are simulated, no money moved'
          : 'OPERATOR: the sale stays PAID at the issuance server, refund the money from the reserve'),
    );
    try {
      // The card goes into the dummy as into the reader; the next two only show.
      await this.step(session, 'preparing', () => this.dispenser.load());
      for (const stage of ['certifying', 'writing'] as const) await this.step(session, stage, async () => {});
      await this.step(session, 'dispensing', () => this.dispenser.dispense());
      session.stage = 'dispensed';
      this.log.log(`[sale ${id}] blank card dispensed (dummy reader)`);
    } catch (error) {
      this.fail(session, message(error));
    }
  }

  /**
   * One issuing step: the kiosk shows `stage` while `work` runs, and for
   * minStepMs at least (a faster step waits the rest), so the customer, or a
   * demo video, sees every step. A step that fails stops at once.
   */
  private async step<T>(session: SaleSession, stage: Stage, work: () => Promise<T>): Promise<T> {
    session.stage = stage;
    const started = Date.now();
    const result = await work();
    await sleep(started + this.config.minStepMs - Date.now());
    return result;
  }

  private fail(session: SaleSession, problem: string): void {
    session.stage = 'failed';
    session.problem = problem;
    session.pin = '';
    this.log.log(`[sale ${session.sale.id}] OPERATOR: failed at the ATM: ${problem}`);
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
