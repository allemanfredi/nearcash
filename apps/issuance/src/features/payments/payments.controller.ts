import type { IssuanceInfo } from '@nearcash/core';
import { Controller, Get, Inject } from '@nestjs/common';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.port.ts';

/**
 *   GET /info   {simulatedPayments}: lets an ATM display show a test mode
 */
@Controller()
export class PaymentsController {
  constructor(@Inject(PAYMENT_GATEWAY) private readonly gateway: PaymentGateway) {}

  @Get('info')
  info(): IssuanceInfo {
    return { simulatedPayments: this.gateway.simulated };
  }
}
