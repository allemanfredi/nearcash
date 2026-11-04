import type { SaleRecord } from './sale-record.ts';

/**
 * Where sales are kept. It must survive restarts: the rule "each payment
 * buys exactly one card" depends on remembering which card a payment went to.
 */
export interface SaleRepository {
  /** A copy of the sale, or undefined. */
  get(id: string): SaleRecord | undefined;
  /** Saves the sale; durable when it returns. */
  put(record: SaleRecord): void;
  /** Copies of every sale, oldest first. */
  list(): SaleRecord[];
}

/** Injection token of the SaleRepository. */
export const SALE_REPOSITORY = Symbol('SALE_REPOSITORY');
