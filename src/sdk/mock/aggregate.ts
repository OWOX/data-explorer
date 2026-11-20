// The mock's traverseData grouping: aggregation and dateTrunc over rows, as the API names the outputs.
import { aggregatedKey, type AggFn, type AggregationRule, type DateTruncRule } from '../../model/aggregation';
import type { Row } from '../types';

type Rule = AggregationRule;
type Trunc = DateTruncRule;

const pad = (n: number) => String(n).padStart(2, '0');

/** The first day of the bucket a date or timestamp falls in, as `YYYY-MM-DD` (the mock does not convert time zones). */
export function truncDate(value: unknown, unit: Trunc['unit']): string | null {
  if (value === null || value === undefined || value === '') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (unit === 'DAY') return `${y}-${pad(mo)}-${pad(d)}`;
  if (unit === 'MONTH') return `${y}-${pad(mo)}-01`;
  if (unit === 'QUARTER') return `${y}-${pad(Math.floor((mo - 1) / 3) * 3 + 1)}-01`;
  if (unit === 'YEAR') return `${y}-01-01`;
  // WEEK: the Monday on or before (ISO weeks)
  const day = new Date(Date.UTC(y, mo - 1, d));
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return `${day.getUTCFullYear()}-${pad(day.getUTCMonth() + 1)}-${pad(day.getUTCDate())}`;
}

const cmp = (a: unknown, b: unknown) => (typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), undefined, { numeric: true }));

/** The rows in the order of the sort keys (a stable sort; an empty list keeps the order), each key read from the column `keyOf` names. */
export function sortRows<S extends { direction: 'asc' | 'desc' }>(rows: Row[], sort: S[], keyOf: (s: S) => string): Row[] {
  if (!sort.length) return rows;
  return [...rows].sort((x, y) => {
    for (const s of sort) {
      const k = keyOf(s);
      const d = cmp(x[k] ?? '', y[k] ?? '');
      if (d !== 0) return s.direction === 'asc' ? d : -d;
    }
    return 0;
  });
}

function percentile(sorted: unknown[], p: number): unknown {
  if (!sorted.length) return null;
  // Linear interpolation between the closest ranks, like the warehouses' continuous percentile.
  const nums = sorted.map(Number);
  const at = (nums.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return nums[lo]! + (nums[hi]! - nums[lo]!) * (at - lo);
}

function aggregate(fn: AggFn, values: unknown[]): unknown {
  const present = values.filter((v) => v !== null && v !== undefined);
  switch (fn) {
    case 'COUNT': return present.length;
    case 'COUNT_DISTINCT': return new Set(present.map(String)).size;
    case 'ANY_VALUE': return present[0] ?? null;
    case 'STRING_AGG': return present.length ? [...new Set(present.map(String))].sort().join(', ') : null;
    case 'SUM': return present.length ? present.reduce<number>((a, v) => a + Number(v), 0) : null;
    case 'AVG': return present.length ? Math.round((present.reduce<number>((a, v) => a + Number(v), 0) / present.length) * 100) / 100 : null;
    case 'MIN': return present.length ? [...present].sort(cmp)[0] : null;
    case 'MAX': return present.length ? [...present].sort(cmp).at(-1) : null;
    case 'P25': return percentile([...present].sort(cmp), 0.25);
    case 'P50': return percentile([...present].sort(cmp), 0.5);
    case 'P75': return percentile([...present].sort(cmp), 0.75);
    case 'P95': return percentile([...present].sort(cmp), 0.95);
  }
}

/**
 * Groups `rows` by every listed column that has no function (a bucketed date by its bucket start); each function is its own
 * output named `"<column> | <TOKEN>"`. A sort rule names a group key, or an aggregated column (its first function).
 */
export type UniqueSource = { key: string; pk: string[] };

/** Distinct primary-key tuples among `rows`; a row whose key is all null does not count, and a source with no key counts rows. */
export function distinctKeys(rows: Row[], pk: string[]): number {
  if (!pk.length) return rows.length;
  return new Set(rows.filter((r) => pk.some((k) => r[k] !== null && r[k] !== undefined)).map((r) => JSON.stringify(pk.map((k) => r[k] ?? null)))).size;
}

export function aggregateRows(rows: Row[], columns: string[], aggregation: Rule[], dateTrunc: Trunc[], sort: { column: string; direction: 'asc' | 'desc' }[], uniq: UniqueSource[] = []): Row[] {
  const fnsOf = (c: string) => aggregation.filter((r) => r.column === c).map((r) => r.function);
  const unitOf = (c: string) => dateTrunc.find((r) => r.column === c)?.unit;
  const keys = columns.filter((c) => fnsOf(c).length === 0);
  const keyValue = (r: Row, c: string) => { const u = unitOf(c); return u ? truncDate(r[c], u) : (r[c] ?? null); };
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const id = JSON.stringify(keys.map((c) => keyValue(r, c)));
    const g = groups.get(id);
    if (g) g.push(r); else groups.set(id, [r]);
  }
  const out: Row[] = [...groups.values()].map((members) => Object.fromEntries([...columns.flatMap((c) => {
    const fns = fnsOf(c);
    return fns.length ? fns.map((fn) => [aggregatedKey(c, fn), aggregate(fn, members.map((r) => r[c]))] as const) : [[c, keyValue(members[0]!, c)] as const];
  }), ...uniq.map((u) => [u.key, distinctKeys(members, u.pk)] as const)]));
  const sortKey = (column: string) => (fnsOf(column).length ? aggregatedKey(column, fnsOf(column)[0]!) : column);
  return sortRows(out, sort, (s) => sortKey(s.column));
}
