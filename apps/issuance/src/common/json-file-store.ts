import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';

/**
 * Records in a JSON file, by id, rewritten after every change. Writes go to
 * a temporary file renamed over the old one: a crash never leaves a
 * half-written file. Without a file, records live in memory only (tests).
 *
 * Every read returns a copy: changing it changes nothing until it is put back.
 */
export class JsonFileStore<T> {
  private readonly file: string | undefined;
  private readonly idOf: (record: T) => string;
  private readonly records = new Map<string, T>();

  constructor(file: string | undefined, idOf: (record: T) => string) {
    this.file = file;
    this.idOf = idOf;
    if (file && existsSync(file)) {
      for (const record of JSON.parse(readFileSync(file, 'utf8')) as T[]) this.records.set(idOf(record), record);
    }
  }

  get(id: string): T | undefined {
    const record = this.records.get(id);
    return record === undefined ? undefined : structuredClone(record);
  }

  /** Every record, oldest first (a Map keeps insertion order). */
  list(): T[] {
    return [...this.records.values()].map((record) => structuredClone(record));
  }

  /** Saves the record; durable when it returns. */
  put(record: T): void {
    this.records.set(this.idOf(record), structuredClone(record));
    if (this.file) {
      const temporary = `${this.file}.tmp`;
      writeFileSync(temporary, JSON.stringify([...this.records.values()], null, 2));
      renameSync(temporary, this.file);
    }
  }
}
