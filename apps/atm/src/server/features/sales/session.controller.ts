import { Body, Controller, Get, HttpCode, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { SessionView, StartRequest } from '@nearcash/kiosk-api';
import { DomainError } from '../../common/domain-error.ts';
import { SaleSessionService } from './sale-session.service.ts';

/**
 *   GET  /api/session                   the current sale, or null
 *   POST /api/session                   StartRequest → start a sale (creates the quote)
 *   POST /api/session/cancel            give up a sale nobody has paid yet
 *   POST /api/session/finish            the customer is done: back to the start screen
 *   POST /api/session/simulate-payment  DEVELOPMENT ONLY: pay a sale (simulated payments)
 */
@Controller('api/session')
export class SessionController {
  constructor(private readonly sessions: SaleSessionService) {}

  // Nest sends an empty body for a null result; the page expects JSON
  // ("null" when no sale is in progress), so these answers are written here.
  @Get()
  view(@Res() response: Response): void {
    sendJson(response, this.sessions.view());
  }

  @Post()
  start(@Body() body: Record<string, unknown> | undefined): Promise<SessionView> {
    return this.sessions.start(toStartRequest(body));
  }

  @Post('cancel')
  @HttpCode(200)
  cancel(): SessionView {
    return this.sessions.cancel();
  }

  @Post('finish')
  finish(@Res() response: Response): void {
    this.sessions.finish();
    sendJson(response, null);
  }

  @Post('simulate-payment')
  async simulatePayment(@Res() response: Response): Promise<void> {
    await this.sessions.simulatePayment();
    sendJson(response, this.sessions.view());
  }
}

/** 200 with a JSON body, never cached (it changes every second). */
function sendJson(response: Response, body: SessionView | null): void {
  response.status(200).setHeader('Cache-Control', 'no-store').json(body);
}

/** The JSON body of POST /api/session: strings, trimmed; refundTo may be left out (or empty). */
function toStartRequest(body: Record<string, unknown> | undefined): StartRequest {
  const field = (name: keyof StartRequest): string => {
    const value = body?.[name];
    if (typeof value !== 'string') throw new DomainError('invalid-request', `${name} is required`);
    return value.trim();
  };
  const refundTo = body?.refundTo === undefined || body.refundTo === null ? '' : field('refundTo');
  return {
    amount: field('amount'),
    paymentOptionId: field('paymentOptionId'),
    ...(refundTo ? { refundTo } : {}),
    pin: field('pin'),
  };
}
