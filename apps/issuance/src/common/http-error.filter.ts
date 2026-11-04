import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, type DomainErrorKind } from './domain-error.ts';

const STATUS: Record<DomainErrorKind, number> = {
  'invalid-request': 400,
  'not-found': 404,
  'payment-required': 402,
  conflict: 409,
  'needs-operator': 500,
};

/**
 * Every error leaves the API as {"error": "…"} with a meaningful status:
 * domain errors by kind, Nest's own (401 from the ATM guard, 404 for unknown
 * routes) as they are, anything else as 500 — logged, not shown in detail.
 */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpErrorFilter');

  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let message = 'internal error';
    if (error instanceof DomainError) {
      status = STATUS[error.kind];
      message = error.message;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      message = status === 404 ? 'not found' : error.message;
    }
    if (status === 500) this.logger.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
    response.status(status).json({ error: message });
  }
}
