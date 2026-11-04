import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module.ts';
import { HardwareModule } from '../hardware/hardware.module.ts';
import { IssuanceModule } from '../issuance/issuance.module.ts';
import { SaleSessionService } from './sale-session.service.ts';
import { SessionController } from './session.controller.ts';

/** Feature: the sale at the ATM, from the quote to the banknote in the tray. */
@Module({
  imports: [CatalogModule, HardwareModule, IssuanceModule],
  controllers: [SessionController],
  providers: [SaleSessionService],
})
export class SalesModule {}
