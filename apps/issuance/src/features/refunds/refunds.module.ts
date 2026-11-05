import { Module } from '@nestjs/common';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../../config/issuance-config.ts';
import { OneClickClient } from '../payments/one-click.client.ts';
import { PaymentsModule } from '../payments/payments.module.ts';
import { RESERVE, type Reserve } from '../reserve/reserve.port.ts';
import { ReserveModule } from '../reserve/reserve.module.ts';
import { SalesModule } from '../sales/sales.module.ts';
import { ChainSenderFinder } from './chain-sender-finder.ts';
import { JsonFileRefundRepository } from './json-file-refund.repository.ts';
import { ManualRefundSender } from './manual-refund-sender.ts';
import { OneClickRefundSender } from './one-click-refund-sender.ts';
import { REFUND_REPOSITORY, type RefundRepository } from './refund-repository.port.ts';
import { REFUND_SENDER, type RefundSender } from './refund-sender.port.ts';
import { RefundsScheduler } from './refunds.scheduler.ts';
import { RefundsService } from './refunds.service.ts';
import { SENDER_FINDER, type SenderFinder } from './sender-finder.port.ts';
import { SimulatedRefundSender } from './simulated-refund-sender.ts';
import { SimulatedSenderFinder } from './simulated-sender-finder.ts';

/**
 * Feature: refunds back to the address the payment came from (rules R1–R4
 * in refunds.service.ts). The adapters follow the configuration:
 *
 *   payments    reserve      who paid             how refunds go back
 *   simulated   any          example addresses    simulated
 *   1click      far          the origin chains    1Click quote paid from the FAR reserve
 *   1click      simulated    the origin chains    by hand (nothing can sign for the reserve)
 */
@Module({
  imports: [PaymentsModule, ReserveModule, SalesModule],
  providers: [
    {
      provide: REFUND_REPOSITORY,
      inject: [ISSUANCE_CONFIG],
      useFactory: ({ refunds }: IssuanceConfig): RefundRepository => new JsonFileRefundRepository(refunds.file),
    },
    {
      provide: SENDER_FINDER,
      inject: [ISSUANCE_CONFIG],
      useFactory: ({ payments, refunds }: IssuanceConfig): SenderFinder =>
        payments.kind === 'simulated' ? new SimulatedSenderFinder() : new ChainSenderFinder(refunds.rpc),
    },
    {
      provide: REFUND_SENDER,
      inject: [ISSUANCE_CONFIG, RESERVE],
      useFactory: (config: IssuanceConfig, reserve: Reserve): RefundSender => {
        if (config.payments.kind === 'simulated') return new SimulatedRefundSender(config.refunds.simulatedNetworkFee);
        if (config.reserve.kind !== 'far') {
          return new ManualRefundSender('the reserve is not in FAR (NEARCASH_RESERVE=simulated): nothing can sign for it');
        }
        return new OneClickRefundSender(new OneClickClient(config.payments.oneClick), reserve, {
          reserveAccountId: config.reserve.far.reserveAccountId,
          contractId: config.reserve.far.contractId,
        });
      },
    },
    RefundsService,
    RefundsScheduler,
  ],
  exports: [RefundsService, REFUND_SENDER, SENDER_FINDER],
})
export class RefundsModule {}
