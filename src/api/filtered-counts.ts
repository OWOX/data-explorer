import { stable } from '../charts/answers';
import { FILTERED_COUNT_LIMIT } from '../config';
import type { Schema } from '../model/types';
import type { Ctx, TraverseFilter } from '../sdk/types';
import { perCtx } from '../sdk/per-ctx';
import { hasPrimaryKey } from '../records/relationships';
import { countMart, type Counted } from './row-counts';

type Entry = { martId: string; n: number; unique: boolean };
type Store = { entries: Map<string, Entry>; reading: Map<string, { martId: string; read: Promise<Counted> }> };

const storeOf = perCtx<Store>(() => ({ entries: new Map(), reading: new Map() }));

const localDay = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** The key of one count: the mart, the rules, the mart's last update, and, for a relative date rule, the local day. */
export function filteredKey(martId: string, rules: readonly TraverseFilter[], updatedAt: string | null, now = new Date()): string {
  const day = rules.some((r) => r.operator === 'relative_date') ? localDay(now) : '';
  return stable([martId, rules, updatedAt, day]);
}

/** The mart a key was made for. */
export const martOfKey = (key: string): string => (JSON.parse(key) as unknown[])[0] as string;

/** The cached count for the key, with whether it counts unique records, or undefined. */
export function cachedFiltered(ctx: Ctx, key: string): { n: number; unique: boolean } | undefined {
  const { entries } = storeOf(ctx);
  const hit = entries.get(key);
  if (!hit) return undefined;
  entries.delete(key);
  entries.set(key, hit);
  return { n: hit.n, unique: hit.unique };
}

function put(ctx: Ctx, key: string, martId: string, n: number, unique: boolean): void {
  const { entries } = storeOf(ctx);
  entries.delete(key);
  entries.set(key, { martId, n, unique });
  while (entries.size > FILTERED_COUNT_LIMIT) entries.delete(entries.keys().next().value as string);
}

/** Reads the count unless cached. A read already under way for the same key is shared. A failure is never cached. */
export function countFiltered(ctx: Ctx, key: string, martId: string, schema: Schema, rules: readonly TraverseFilter[]): Promise<Counted> {
  const hit = cachedFiltered(ctx, key);
  // An entry made the other way (rows, or unique records) is not this mart's count now: read again and replace it.
  if (hit !== undefined && hit.unique === hasPrimaryKey(schema)) return Promise.resolve({ value: hit.n, unique: hit.unique });
  const { reading } = storeOf(ctx);
  const under = reading.get(key);
  if (under) return under.read;
  const read = countMart(ctx, martId, schema, [...rules])
    .then((c) => { if (c.value !== null && reading.get(key)?.read === read) put(ctx, key, martId, c.value, c.unique); return c; })
    .finally(() => { if (reading.get(key)?.read === read) reading.delete(key); });
  reading.set(key, { martId, read });
  return read;
}

/** Stores a count the caller already has (the grid's total). */
export function rememberFiltered(ctx: Ctx, key: string, n: number, unique: boolean): void {
  put(ctx, key, martOfKey(key), n, unique);
}

/** Drops every entry of a mart (the grid's Refresh). */
export function forgetFiltered(ctx: Ctx, martId: string): void {
  const { entries, reading } = storeOf(ctx);
  for (const [key, e] of entries) if (e.martId === martId) entries.delete(key);
  // A read under way began before the refresh: it must neither be joined nor cached.
  for (const [key, r] of reading) if (r.martId === martId) reading.delete(key);
}
