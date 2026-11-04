import { Controller, Get, Header } from '@nestjs/common';
import type { Setup } from '@nearcash/kiosk-api';
import { CatalogService } from './catalog.service.ts';

/**
 *   GET /api/setup   what can be sold and how it can be paid
 */
@Controller('api/setup')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  setup(): Promise<Setup> {
    return this.catalog.setup();
  }
}
