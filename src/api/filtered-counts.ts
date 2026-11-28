import { stable } from '../charts/answers';
import { FILTERED_COUNT_LIMIT } from '../config';
import type { Schema } from '../model/types';
import type { Ctx, TraverseFilter } from '../sdk/types';
import { perCtx } from '../sdk/per-ctx';
import { countRows } from './row-counts';

type Entry = { martId: string; n: number };
type Store = { entries: Map<string, Entry>; reading: Map<string, Promise<number | null>> };

const storeOf = perCtx<Store>(() => ({ entries: new Map(), reading: new Map() }));

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The key of one count: the mart, the rules, the mart's last update, and, for a relative date rule, the local day. */
export function filteredKey(martId: string, rules: readonly TraverseFilter[], updatedAt: string | null, now = new Date()): string {
  const day = rules.some((r) => r.operator === 'relative_date') ? localDay(now) : '';
  return stable([martId, rules, updatedAt, day]);
}

/** The cached count for the key, or undefined. */
export function cachedFiltered(ctx: Ctx, key: string): number | undefined {
  const { entries } = storeOf(ctx);
  const hit = entries.get(key);
  if (!hit) return undefined;
  entries.delete(key);
  entries.set(key, hit);
  return hit.n;
}

function put(ctx: Ctx, key: string, martId: string, n: number): void {
  const { entries } = storeOf(ctx);
  entries.delete(key);
  entries.set(key, { martId, n });
  while (entries.size > FILTERED_COUNT_LIMIT) entries.delete(entries.keys().next().value as string);
}

/** Reads the count unless cached. A read already under way for the same key is shared. A failure is never cached. */
export function countFiltered(ctx: Ctx, key: string, martId: string, schema: Schema, rules: readonly TraverseFilter[]): Promise<number | null> {
  const hit = cachedFiltered(ctx, key);
  if (hit !== undefined) return Promise.resolve(hit);
  const { reading } = storeOf(ctx);
  const under = reading.get(key);
  if (under) return under;
  const read = countRows(ctx, martId, schema, [...rules])
    .then((n) => { if (n !== null) put(ctx, key, martId, n); return n; })
    .finally(() => { reading.delete(key); });
  reading.set(key, read);
  return read;
}

/** Stores a count the caller already has (the grid's total). */
export function rememberFiltered(ctx: Ctx, key: string, n: number): void {
  const martId = (JSON.parse(key) as unknown[])[0] as string;
  put(ctx, key, martId, n);
}

/** Drops every entry of a mart (the grid's Refresh). */
export function forgetFiltered(ctx: Ctx, martId: string): void {
  const { entries } = storeOf(ctx);
  for (const [key, e] of entries) if (e.martId === martId) entries.delete(key);
}
