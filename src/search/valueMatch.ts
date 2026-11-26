import { readRows } from '../api/rows';
import { topValuesQuery, type Measure } from '../charts/queries';
import type { Field } from '../model/types';
import { perCtx } from '../sdk/per-ctx';
import type { Ctx } from '../sdk/types';
import { SUGGEST_LIMIT } from '../filters/valueSuggest';

export const VALUE_COLUMNS = 6;
const VALUE_LIMIT = 200;
const RECORDS: Measure = { kind: 'records', aliasPath: '', recordsId: 'records' };

export const normalize = (s: string): string => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

export const VALUE_MATCHES = 20;

/** The matches of a literal by tier: equal ignoring case, equal ignoring spaces, punctuation and accents, whole-word prefix. */
export function matchTiers(literal: string, values: string[]): [string[], string[], string[]] {
  const lower = literal.trim().toLowerCase();
  if (!lower) return [[], [], []];
  const n = normalize(lower);
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${lower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu');
  return [
    values.filter((v) => v.toLowerCase() === lower),
    n ? values.filter((v) => normalize(v) === n) : [],
    values.filter((v) => re.test(v)),
  ];
}

/** How many columns' value reads a ctx keeps. The least recently used is dropped first. */
export const VALUES_CACHE_LIMIT = 64;
// Resolved reads only, per ctx: a failed or aborted read stores nothing. `complete`: the read returned fewer rows than its limit, so these are all the values.
type Entry = { values: string[]; complete: boolean };
const cacheOf = perCtx(() => new Map<string, Entry>());
// Bumped by a forget: a read that started before it must not store what it read.
const generationOf = perCtx(() => new Map<string, number>());
let resets = 0;
const generation = (ctx: Ctx, martId: string) => `${resets}:${generationOf(ctx).get(martId) ?? 0}`;
const keyOf = (martId: string, field: Field) => `${martId}\u0000${field.name}`;

/** Drops a mart's kept value reads: the grid's Refresh must not be answered from values read before it. */
export function forgetValues(ctx: Ctx, martId: string) {
  const cache = cacheOf(ctx);
  generationOf(ctx).set(martId, (generationOf(ctx).get(martId) ?? 0) + 1);
  for (const k of cache.keys()) if (k.startsWith(`${martId}\u0000`)) cache.delete(k);
}

/** Drops every kept value read: a model reload. */
export function forgetAllValues(ctx: Ctx) {
  resets++;
  cacheOf(ctx).clear();
}

/** The first suggestions of a column from its kept value read: the non-blank values, when the read is complete or holds enough of them; otherwise null. */
export function suggestFromSearch(ctx: Ctx, martId: string, field: Field): string[] | null {
  const hit = cacheOf(ctx).get(keyOf(martId, field));
  if (!hit) return null;
  const values = hit.values.filter((v) => v.trim() !== '');
  return hit.complete || values.length >= SUGGEST_LIMIT ? values.slice(0, SUGGEST_LIMIT) : null;
}

/** A column's most frequent values (by record count), for matching only; they never go to a model unless they match. Read once per mart and column until forgotten. */
export async function readValues(ctx: Ctx, martId: string, field: Field, signal: AbortSignal): Promise<string[]> {
  const cache = cacheOf(ctx);
  const key = keyOf(martId, field);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit.values;
  }
  const before = generation(ctx, martId);
  try {
    const rows = await readRows(ctx, martId, { ...topValuesQuery(field, RECORDS, []), limit: VALUE_LIMIT }, { signal });
    const values = [...new Set(rows.flatMap((r) => (r[field.name] === null || r[field.name] === undefined ? [] : [String(r[field.name])])))];
    if (!signal.aborted && generation(ctx, martId) === before) {
      cache.set(key, { values, complete: rows.length < VALUE_LIMIT });
      if (cache.size > VALUES_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
    }
    return values;
  } catch {
    return [];
  }
}
