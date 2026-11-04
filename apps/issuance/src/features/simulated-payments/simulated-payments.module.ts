import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.ts';
import { SalesModule } from '../sales/sales.module.ts';
import { SimulatedPaymentsController } from './simulated-payments.controller.ts';

/**
 * Feature (development only): settle simulated payments by hand, so a whole
 * sale runs without real money. AppModule imports it only when
 * NEARCASH_PAYMENTS=simulated.
 */
@Module({
  imports: [PaymentsModule, SalesModule],
  controllers: [SimulatedPaymentsController],
})
export class SimulatedPaymentsModule {}
