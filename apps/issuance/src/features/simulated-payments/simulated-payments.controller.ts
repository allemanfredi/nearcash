import type { Sale } from '@nearcash/core';
import { Body, Controller, HttpCode, Inject, Param, Post } from '@nestjs/common';
import { DomainError } from '../../common/domain-error.ts';
import { PAYMENT_GATEWAY, type PaymentGateway } from '../payments/payment-gateway.port.ts';
import { SimulatedGateway } from '../payments/simulated.gateway.ts';
import { SalesService } from '../sales/sales.service.ts';

/**
 * DEVELOPMENT ONLY, registered only when payments are simulated:
 *   POST /dev/sales/:id/pay      mark the deposit as paid (SUCCESS); body {"excess": "<amount>"}:
 *                                the customer paid that much more (smallest unit), refunded to the reserve
 *   POST /dev/sales/:id/refund   mark it as refunded (the swap failed): all of it goes to the reserve
 * Refunds then go back to the sender with the next refunds sweep.
 */
@Controller('dev/sales')
export class SimulatedPaymentsController {
  private readonly gateway: SimulatedGateway;

  constructor(
    @Inject(PAYMENT_GATEWAY) gateway: PaymentGateway,
    private readonly sales: SalesService,
  ) {
    // The module is only imported with simulated payments; a real gateway here is a wiring mistake.
    if (!(gateway instanceof SimulatedGateway)) throw new Error('simulated-payment routes need the simulated gateway');
    this.gateway = gateway;
  }

  @Post(':id/pay')
  @HttpCode(200)
  pay(@Param('id') id: string, @Body() body: Record<string, unknown> | undefined): Promise<Sale> {
    this.gateway.settle(this.sales.depositAddressOf(id), 'SUCCESS', parseExcess(body?.excess));
    return this.sales.getSale(id);
  }

  @Post(':id/refund')
  @HttpCode(200)
  refund(@Param('id') id: string): Promise<Sale> {
    this.gateway.settle(this.sales.depositAddressOf(id), 'REFUNDED');
    return this.sales.getSale(id);
  }
}

/** The optional "excess" of a simulated payment: a whole number of the smallest unit, as a string. */
function parseExcess(value: unknown): bigint {
  if (value === undefined || value === null) return 0n;
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) throw new DomainError('invalid-request', 'excess must be a whole number, as a string');
  return BigInt(value);
}
