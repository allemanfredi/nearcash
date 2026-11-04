import { type Sale, bytesToHex } from '@nearcash/core';
import { Body, Controller, Get, HttpCode, Logger, Param, Post } from '@nestjs/common';
import { CallingAtm } from '../../common/atm-auth.guard.ts';
import { SalesService } from './sales.service.ts';
import { parseCardKeys, parseCreateSale } from './sales.requests.ts';

/**
 *   POST /sales              {amount, originAsset, refundTo?} → sale with deposit address
 *   GET  /sales/:id          sale, payment status refreshed
 *   POST /sales/:id/issue    {authPublicKey, fundsPublicKey} (hex) → {certificate} (hex)
 */
@Controller('sales')
export class SalesController {
  private readonly logger = new Logger('Sales');

  constructor(private readonly sales: SalesService) {}

  @Post()
  async create(@Body() body: Record<string, unknown>, @CallingAtm() atm: string): Promise<Sale> {
    const sale = await this.sales.createSale(parseCreateSale(body));
    this.logger.log(`[${atm}] sale ${sale.id}: ${sale.amount} ${sale.symbol}, pay ${sale.amountIn} ${sale.originAsset} to ${sale.depositAddress}`);
    return sale;
  }

  @Get(':id')
  get(@Param('id') id: string): Promise<Sale> {
    return this.sales.getSale(id);
  }

  @Post(':id/issue')
  @HttpCode(200)
  async issue(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @CallingAtm() atm: string,
  ): Promise<{ certificate: string }> {
    const certificate = await this.sales.issue(id, parseCardKeys(body));
    this.logger.log(`[${atm}] sale ${id}: banknote issued`);
    return { certificate: bytesToHex(certificate) };
  }
}
