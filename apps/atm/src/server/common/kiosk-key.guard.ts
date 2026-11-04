import { timingSafeEqual } from 'node:crypto';
import { type CanActivate, type ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { KIOSK_KEY_HEADER } from '@nearcash/kiosk-api';
import { ATM_CONFIG, type AtmConfig } from '../config/atm-config.ts';

/**
 * Pairing: with a kiosk key configured, every API call must carry it
 * (X-Kiosk-Key). Only the paired iPhone drives the ATM, not anyone on the
 * network. Without a key (development) every screen may.
 */
@Injectable()
export class KioskKeyGuard implements CanActivate {
  constructor(@Inject(ATM_CONFIG) private readonly config: AtmConfig) {}

  canActivate(context: ExecutionContext): boolean {
    if (!this.config.kioskKey) return true;
    const request = context.switchToHttp().getRequest<Request>();
    const given = Buffer.from(String(request.headers[KIOSK_KEY_HEADER.toLowerCase()] ?? ''));
    const expected = Buffer.from(this.config.kioskKey);
    // Constant-time comparison: the key can't be guessed byte by byte.
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
      throw new UnauthorizedException('this screen is not paired with the ATM');
    }
    return true;
  }
}
