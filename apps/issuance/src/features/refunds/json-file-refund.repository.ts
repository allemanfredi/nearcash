import { JsonFileStore } from '../../common/json-file-store.ts';
import type { ReturnedRefund, SaleRefunds } from './refund-record.ts';
import type { RefundRepository } from './refund-repository.port.ts';

/** Refunds in a JSON file (see JsonFileStore); without a file, in memory only (tests). */
export class JsonFileRefundRepository implements RefundRepository {
  private readonly store: JsonFileStore<SaleRefunds>;

  constructor(file?: string) {
    this.store = new JsonFileStore<SaleRefunds>(file, (record) => record.saleId);
  }

  get(saleId: string): ReturnedRefund[] {
    return this.store.get(saleId)?.refunds ?? [];
  }

  put(saleId: string, refunds: ReturnedRefund[]): void {
    this.store.put({ saleId, refunds });
  }
}
