import { JsonFileStore } from '../../common/json-file-store.ts';
import type { SaleRecord } from './sale-record.ts';
import type { SaleRepository } from './sale-repository.port.ts';

/** Sales in a JSON file (see JsonFileStore); without a file, in memory only (tests). */
export class JsonFileSaleRepository implements SaleRepository {
  private readonly store: JsonFileStore<SaleRecord>;

  constructor(file?: string) {
    this.store = new JsonFileStore<SaleRecord>(file, (record) => record.id);
  }

  get(id: string): SaleRecord | undefined {
    return this.store.get(id);
  }

  put(record: SaleRecord): void {
    this.store.put(record);
  }

  list(): SaleRecord[] {
    return this.store.list();
  }
}
