import { readRows } from '../api/rows';
import { topValuesQuery, type Measure } from '../charts/queries';
import type { Field } from '../model/types';
import type { Ctx } from '../sdk/types';

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

/** A column's most frequent values (by record count), for matching only; they never go to a model unless they match. */
export async function readValues(ctx: Ctx, martId: string, field: Field, signal: AbortSignal): Promise<string[]> {
  try {
    const rows = await readRows(ctx, martId, { ...topValuesQuery(field, RECORDS, []), limit: VALUE_LIMIT }, { signal });
    return [...new Set(rows.flatMap((r) => (r[field.name] === null || r[field.name] === undefined ? [] : [String(r[field.name])])))];
  } catch {
    return [];
  }
}
