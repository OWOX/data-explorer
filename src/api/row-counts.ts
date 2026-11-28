import type { Schema } from '../model/types';
import type { Ctx, TraverseFilter, TraverseOptions } from '../sdk/types';
import { readRows } from './rows';

const ROW_COUNTS_COLLECTION = 'row-counts';
const COUNT_MAX_AGE_MS = 24 * 3600_000;
const COUNT_MIN_AGE_MS = 3600_000;
type CountDoc = { dataMartId: string; count: number; at: string };

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

/** A count taken after the last update never expires by age. An older one is kept for an hour. */
function fresh(at: number, upd: number, now: number): boolean {
  if (!Number.isFinite(at)) return false;
  if (!Number.isFinite(upd)) return now - at < COUNT_MAX_AGE_MS;
  if (at >= upd) return true;
  return now - at < COUNT_MIN_AGE_MS;
}

export interface RowCounter {
  count(id: string, schema: Schema, updatedAt: string | null): Promise<number | null>;
  recount(id: string, schema: Schema): Promise<number | null>;
  /** Keeps a count the caller already has (the grid's total), as if it had been measured now. */
  store(id: string, count: number): Promise<void>;
}

export function createRowCounter(ctx: Ctx): RowCounter {
  const col = ctx.collections<CountDoc>(ROW_COUNTS_COLLECTION);

  async function measure(id: string, schema: Schema): Promise<number | null> {
    const n = await countRows(ctx, id, schema);
    if (n === null) return null;
    await col.put(id, { dataMartId: id, count: n, at: new Date().toISOString() }).catch(() => undefined);
    return n;
  }

  return {
    async count(id, schema, updatedAt) {
      const cached = await col.get(id).catch(() => null);
      if (cached && fresh(Date.parse(cached.document.at), updatedAt ? Date.parse(updatedAt) : NaN, Date.now())) return cached.document.count;
      return measure(id, schema);
    },
    recount: measure,
    store: (id, count) => col.put(id, { dataMartId: id, count, at: new Date().toISOString() }).then(() => undefined, () => undefined),
  };
}
