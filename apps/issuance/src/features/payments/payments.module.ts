import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { PAYMENT_GATEWAY, type PaymentGateway } from './payment-gateway.port.ts';
import { OneClickGateway } from './one-click.gateway.ts';
import { SimulatedGateway } from './simulated.gateway.ts';
import { PaymentsController } from './payments.controller.ts';

/** Feature: how customers pay (1Click quotes into the reserve, or simulated). */
@Module({
  controllers: [PaymentsController],
  providers: [
    {
      provide: PAYMENT_GATEWAY,
      inject: [ISSUANCE_CONFIG],
      useFactory: ({ payments }: IssuanceConfig): PaymentGateway =>
        payments.kind === '1click' ? new OneClickGateway(payments.oneClick) : new SimulatedGateway(),
    },
  ],
  exports: [PAYMENT_GATEWAY],
})
export class PaymentsModule {}
