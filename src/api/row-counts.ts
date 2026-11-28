import type { Schema } from '../model/types';
import type { Ctx, TraverseFilter, TraverseOptions } from '../sdk/types';
import { uniqueKey } from '../model/unique-count';
import { hasPrimaryKey } from '../records/relationships';
import { readRows } from './rows';

const ROW_COUNTS_COLLECTION = 'row-counts';
const COUNT_MAX_AGE_MS = 24 * 3600_000;
const COUNT_MIN_AGE_MS = 3600_000;
type CountDoc = { dataMartId: string; count: number; at: string; unique?: boolean };

/** A mart's count: of its unique records when it has a primary key (`unique`), else of its rows. */
export type Counted = { value: number | null; unique: boolean };

const CATEGORY_ORDER: Schema[number]['category'][] = ['boolean', 'date', 'time', 'number', 'string', 'other'];

/** The narrowest field that is not calculated, so the one-row read touches the least data. */
export function countField(schema: Schema): string | null {
  for (const category of CATEGORY_ORDER) {
    const hit = schema.find((f) => f.category === category && !f.isCalculated);
    if (hit) return hit.name;
  }
  return null;
}

/** The mart's row count, COUNT(*), from the total of a one-row read. */
export async function countRows(ctx: Ctx, martId: string, schema: Schema, filter?: TraverseFilter[]): Promise<number | null> {
  const field = countField(schema);
  if (field === null) return null;
  const options: TraverseOptions = { column: [field], limit: 1, includeTotalRowCount: true, ...(filter ? { filter } : {}) };
  let total: number | undefined;
  await readRows(ctx, martId, options, { onTotalRowCount: (n) => { total = n; } });
  if (total === undefined) throw new Error('The row count did not arrive');
  return total;
}

/** The mart's unique records, one warehouse query: the Unique Count of the main mart. A value that is not a number is an error, never 0. */
async function countUnique(ctx: Ctx, martId: string, filter?: TraverseFilter[]): Promise<number> {
  const options: TraverseOptions = { uniqueCount: [''], ...(filter ? { filter } : {}) };
  const rows = await readRows(ctx, martId, options);
  const value = rows[0]?.[uniqueKey('')];
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('The unique count did not arrive');
  return value;
}

/** The one count a card shows: unique records for a mart with a primary key (1 query), else its rows (2 queries). */
export async function countMart(ctx: Ctx, martId: string, schema: Schema, filter?: TraverseFilter[]): Promise<Counted> {
  if (hasPrimaryKey(schema)) return { value: await countUnique(ctx, martId, filter), unique: true };
  return { value: await countRows(ctx, martId, schema, filter), unique: false };
}

/** A count taken after the last update never expires by age. An older one is kept for an hour. */
function fresh(at: number, upd: number, now: number): boolean {
  if (!Number.isFinite(at)) return false;
  if (!Number.isFinite(upd)) return now - at < COUNT_MAX_AGE_MS;
  if (at >= upd) return true;
  return now - at < COUNT_MIN_AGE_MS;
}

export interface RowCounter {
  count(id: string, schema: Schema, updatedAt: string | null): Promise<Counted>;
  recount(id: string, schema: Schema): Promise<Counted>;
  /** Keeps a count the caller already has (the grid's total), as if it had been measured now. */
  store(id: string, count: number, unique: boolean): Promise<void>;
}

export function createRowCounter(ctx: Ctx): RowCounter {
  const col = ctx.collections<CountDoc>(ROW_COUNTS_COLLECTION);

  async function measure(id: string, schema: Schema): Promise<Counted> {
    const counted = await countMart(ctx, id, schema);
    if (counted.value === null) return counted;
    await col.put(id, { dataMartId: id, count: counted.value, at: new Date().toISOString(), unique: counted.unique }).catch(() => undefined);
    return counted;
  }

  return {
    async count(id, schema, updatedAt) {
      const cached = await col.get(id).catch(() => null);
      // A count made the other way (rows, or unique records), or by an older version with no flag, is not this mart's count now.
      const unique = hasPrimaryKey(schema);
      if (cached && cached.document.unique === unique && fresh(Date.parse(cached.document.at), updatedAt ? Date.parse(updatedAt) : NaN, Date.now())) return { value: cached.document.count, unique };
      return measure(id, schema);
    },
    recount: measure,
    store: (id, count, unique) => col.put(id, { dataMartId: id, count, at: new Date().toISOString(), unique }).then(() => undefined, () => undefined),
  };
}
