import type { ReturnedRefund } from './refund-record.ts';

/**
 * Where the refunds of each sale are kept. It must survive restarts: rule
 * R3 (a refund is sent at most once) depends on remembering every attempt.
 */
export interface RefundRepository {
  /** The refunds of a sale, oldest first (empty if none). */
  get(saleId: string): ReturnedRefund[];
  /** Saves them; durable when it returns. */
  put(saleId: string, refunds: ReturnedRefund[]): void;
}

/** Injection token of the RefundRepository. */
export const REFUND_REPOSITORY = Symbol('REFUND_REPOSITORY');
