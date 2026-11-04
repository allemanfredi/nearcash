import { ConsoleLogger } from '@nestjs/common';

/** Nest's own start-up chatter (one line per module and route): hidden. */
const FRAMEWORK_CONTEXTS = new Set(['NestFactory', 'InstanceLoader', 'RoutesResolver', 'RouterExplorer', 'NestApplication']);

/**
 * Nest's console logger without the framework's start-up lines, so the
 * operator sees only what the server does (sales, issued banknotes,
 * problems). Errors and warnings always pass.
 */
export class QuietLogger extends ConsoleLogger {
  override log(message: unknown, ...rest: unknown[]): void {
    const context = rest.at(-1);
    if (typeof context === 'string' && FRAMEWORK_CONTEXTS.has(context)) return;
    super.log(message, ...rest);
  }
}
