import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiError } from '@nearcash/kiosk-api';
import { DomainError, type DomainErrorKind } from './domain-error.ts';

const STATUS: Record<DomainErrorKind, number> = {
  'invalid-request': 400,
  'not-found': 404,
  conflict: 409,
  unavailable: 503,
};

/**
 * Every error reaches the kiosk page as {"error": "…"} (shared/api.ts):
 * domain errors by kind, Nest's own (401 from the kiosk-key guard, 404 for
 * unknown routes) as they are, anything else as 500 — logged.
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
    const body: ApiError = { error: message };
    response.status(status).setHeader('Cache-Control', 'no-store').json(body);
  }
}
