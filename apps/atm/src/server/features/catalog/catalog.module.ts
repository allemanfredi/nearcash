import { Module } from '@nestjs/common';
import { HardwareModule } from '../hardware/hardware.module.ts';
import { IssuanceModule } from '../issuance/issuance.module.ts';
import { CatalogService } from './catalog.service.ts';
import { CatalogController } from './catalog.controller.ts';

/** Feature: what the screen offers (banknotes from the issuance server, payment options), or why it's out of service. */
@Module({
  imports: [IssuanceModule, HardwareModule],
  controllers: [CatalogController],
  providers: [CatalogService],
  exports: [CatalogService],
})
export class CatalogModule {}
