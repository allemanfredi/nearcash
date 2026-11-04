import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import { ISSUANCE_CONFIG, type IssuanceConfig } from '../config/issuance-config.ts';

/** The request, once an ATM has been recognised. */
type AtmRequest = Request & { atmName?: string };

/**
 * Every route is for ATMs only: "Authorization: Bearer <ATM token>", one of
 * NEARCASH_ATM_TOKENS. ATMs hold no key that creates value; the token only
 * lets them ask for quotes and for the certificates of paid sales.
 */
@Injectable()
export class AtmAuthGuard implements CanActivate {
  constructor(@Inject(ISSUANCE_CONFIG) private readonly config: IssuanceConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AtmRequest>();
    const header = request.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : '';
    const atmName = this.config.atmTokens.get(token);
    if (!atmName) throw new UnauthorizedException('unknown ATM');
    request.atmName = atmName;
    return true;
  }
}

/** The name of the calling ATM (set by AtmAuthGuard), for the operator log. */
export const CallingAtm = createParamDecorator(
  (_data: unknown, context: ExecutionContext): string => context.switchToHttp().getRequest<AtmRequest>().atmName ?? '?',
);
