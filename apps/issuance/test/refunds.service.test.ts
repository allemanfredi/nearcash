/**
 * The refund rules (RefundsService, R1–R4), built directly with test
 * doubles through its constructor — the same dependencies Nest injects.
 */
import { describe, expect, it } from 'vitest';
import type { Clock } from '../src/common/clock.ts';
import type { IssuanceConfig } from '../src/config/issuance-config.ts';
import { SimulatedGateway } from '../src/features/payments/simulated.gateway.ts';
import { JsonFileRefundRepository } from '../src/features/refunds/json-file-refund.repository.ts';
import type { RefundOutcome, RefundReturn, RefundSender } from '../src/features/refunds/refund-sender.port.ts';
import { RefundsService } from '../src/features/refunds/refunds.service.ts';
import type { Deposit, SenderFinder } from '../src/features/refunds/sender-finder.port.ts';
import { CertificatesService } from '../src/features/certificates/certificates.service.ts';
import { JsonFileSaleRepository } from '../src/features/sales/json-file-sale.repository.ts';
import { SalesService } from '../src/features/sales/sales.service.ts';
import { CountingReserve, TEN, TestAuthority } from './fakes.ts';

const USDC_BASE = 'nep141:base-0x833589fcd6edb6e08f4c7c32d4f71b54bda02913.omft.near';
const SENDER = '0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed';

/** A clock the test moves by hand. */
class ManualClock implements Clock {
  time = new Date('2026-11-04T12:00:00Z');
  now(): Date {
    return new Date(this.time);
  }
}

/** Who paid: a fixed answer, counting the questions. */
class FixedSenderFinder implements SenderFinder {
  readonly name = 'fixed';
  sender: string | null = SENDER;
  asked: Deposit[] = [];
  async findSender(deposit: Deposit): Promise<string | null> {
    this.asked.push(deposit);
    return this.sender;
  }
}

/** Sends nothing: answers with the next scripted outcome (default: sent), or throws. */
class ScriptedRefundSender implements RefundSender {
  readonly name = 'scripted';
  readonly calls: RefundReturn[] = [];
  next: (RefundOutcome | Error)[] = [];
  async send(refund: RefundReturn): Promise<RefundOutcome> {
    this.calls.push(refund);
    const outcome = this.next.shift() ?? { kind: 'sent', reference: `ref-${this.calls.length}` };
    if (outcome instanceof Error) throw outcome;
    return outcome;
  }
}

function setup() {
  const clock = new ManualClock();
  const gateway = new SimulatedGateway();
  const sales = new JsonFileSaleRepository();
  const refunds = new JsonFileRefundRepository();
  const senders = new FixedSenderFinder();
  const refundSender = new ScriptedRefundSender();
  const config = {
    reserveAccountId: 'bank-reserve.far',
    paymentWindowMinutes: 30,
    refunds: { sweepSeconds: 0, watchHours: 24 },
  } as IssuanceConfig;
  const salesService = new SalesService(sales, gateway, new CountingReserve(), new CertificatesService(new TestAuthority()), clock, config);
  const service = new RefundsService(sales, refunds, gateway, senders, refundSender, clock, config);
  return { clock, gateway, sales, refunds, senders, refundSender, salesService, service };
}

/** A sale whose customer gave no refund address (refunds come to the reserve). */
async function saleWithoutRefundAddress(context: ReturnType<typeof setup>) {
  return context.salesService.createSale({ amount: TEN, originAsset: USDC_BASE });
}

describe('refunds back to the sender', () => {
  it('a failed swap: everything that was paid goes back to the address that paid, once', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');

    await context.service.sweep();
    expect(context.refundSender.calls).toEqual([{ asset: USDC_BASE, amount: TEN, recipient: SENDER }]);
    expect(context.senders.asked[0]).toMatchObject({ originAsset: USDC_BASE, depositAddress: sale.depositAddress });
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ amount: TEN.toString(), state: 'sent', sender: SENDER, reference: 'ref-1' }]);

    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(1); // R3: never twice
  });

  it('an overpayment: only what was paid beyond the quote goes back, and the banknote is still sold', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'SUCCESS', 5_000n);
    await context.service.sweep();
    expect(context.refundSender.calls).toEqual([{ asset: USDC_BASE, amount: 5_000n, recipient: SENDER }]);
    expect((await context.salesService.getSale(sale.id)).status).toBe('PAID');
  });

  it('a second refund for the same deposit later: only the new part goes back', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'SUCCESS', 5_000n);
    await context.service.sweep();
    context.gateway.settle(sale.depositAddress, 'SUCCESS', 7_000n); // 1Click's total grew by 2 000
    await context.service.sweep();
    expect(context.refundSender.calls.map((call) => call.amount)).toEqual([5_000n, 2_000n]);
  });

  it('R1: a sale with the customer’s own refund address is never touched (1Click refunds it directly)', async () => {
    const context = setup();
    const sale = await context.salesService.createSale({ amount: TEN, originAsset: USDC_BASE, refundTo: '0xcustomer' });
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    await context.service.sweep();
    expect(context.senders.asked).toHaveLength(0);
    expect(context.refundSender.calls).toHaveLength(0);
  });

  it('R2: when who paid can’t be told for sure, nothing is sent and an operator decides', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    context.senders.sender = null;
    await context.service.sweep();
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(0);
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ state: 'needs-operator', note: /sending address/ }]);
  });

  it('R3: an error while sending means the outcome is unknown: no retry, an operator checks', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    context.refundSender.next = [new Error('relay timeout')];
    await context.service.sweep();
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(1);
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ state: 'needs-operator', note: /outcome unknown/ }]);
  });

  it('R3: an attempt still "sending" after a restart is not sent again', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    // What a crash in the middle of send() leaves behind.
    context.refunds.put(sale.id, [{ amount: TEN.toString(), state: 'sending', sender: SENDER, at: context.clock.now().toISOString() }]);
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(0);
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ state: 'needs-operator', note: /interrupted/ }]);
  });

  it('when nothing left the reserve (no quote now), the next sweep tries again', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    context.refundSender.next = [{ kind: 'not-sent', reason: '1Click is down' }];
    await context.service.sweep();
    expect(context.service.refundsOf(sale.id)).toEqual([]);
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(2);
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ state: 'sent' }]);
  });

  it('R4: a refund too small to pay for its own transfer is kept, and recorded as kept', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.gateway.settle(sale.depositAddress, 'SUCCESS', 3n);
    context.refundSender.next = [{ kind: 'too-small', reason: 'Amount is too low' }];
    await context.service.sweep();
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(1);
    expect(context.service.refundsOf(sale.id)).toMatchObject([{ amount: '3', state: 'kept', note: 'Amount is too low' }]);
  });

  it('a sale is watched until `watchHours` after its deadline', async () => {
    const context = setup();
    const sale = await saleWithoutRefundAddress(context);
    context.clock.time = new Date(new Date(sale.deadline).getTime() + 25 * 3_600_000);
    context.gateway.settle(sale.depositAddress, 'REFUNDED');
    await context.service.sweep();
    expect(context.refundSender.calls).toHaveLength(0);
  });
});
