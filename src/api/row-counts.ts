import type { Schema } from '../model/types';
import { uniqueKey } from '../model/unique-count';
import type { Ctx, TraverseOptions } from '../sdk/types';
import { hasPrimaryKey } from '../records/relationships';
import { readRows } from './rows';

const ROW_COUNTS_COLLECTION = 'row-counts';
const COUNT_MAX_AGE_MS = 24 * 3600_000;
type CountDoc = { dataMartId: string; count: number; at: string };

export function countOptions(schema: Schema): { options: TraverseOptions; key: string } | null {
  if (hasPrimaryKey(schema)) return { options: { uniqueCount: [''] }, key: uniqueKey('') };
  // The backend allows COUNT only on string, boolean and other fields (number: SUM/AVG/MIN/MAX, date and time: MIN/MAX).
  const first = schema.find((f) => f.category === 'string' || f.category === 'boolean' || f.category === 'other');
  if (!first) return null;
  return { options: { column: [first.name], aggregation: [{ column: first.name, function: 'COUNT' }] }, key: `${first.name} | COUNT` };
}

export interface RowCounter {
  count(id: string, schema: Schema): Promise<number | null>;
  recount(id: string, schema: Schema): Promise<number | null>;
}

export function createRowCounter(ctx: Ctx): RowCounter {
  const col = ctx.collections<CountDoc>(ROW_COUNTS_COLLECTION);

  async function measure(id: string, schema: Schema): Promise<number | null> {
    const plan = countOptions(schema);
    if (!plan) return null;
    const [row] = await readRows(ctx, id, plan.options);
    const n = Number(row?.[plan.key]);
    if (!Number.isFinite(n)) throw new Error('Row count returned no number');
    await col.put(id, { dataMartId: id, count: n, at: new Date().toISOString() }).catch(() => undefined);
    return n;
  }

  return {
    async count(id, schema) {
      const cached = await col.get(id).catch(() => null);
      if (cached && Date.now() - Date.parse(cached.document.at) < COUNT_MAX_AGE_MS) return cached.document.count;
      return measure(id, schema);
    },
    recount: measure,
  };
}
