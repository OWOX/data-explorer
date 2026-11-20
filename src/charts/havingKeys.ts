// Charts show the rows of the groups the table's HAVING filters let through, rolled up their own way.
// traverseData cannot nest queries, so the passing group keys are read once and sent to every chart query as an `in` rule.
import { useMemo } from 'react';
import type { ColumnFilter } from '../filters/build';
import type { Aggregation } from '../model/aggregation';
import type { Schema } from '../model/types';
import type { Row, TraverseFilter, TraverseOptions } from '../sdk/types';
import { buildRowQuery } from '../ui/explorer/useMartRows';
import { useChartQuery } from './useChartQuery';

/** The backend refuses an `in` list longer than this (IN_LIST_MAX_VALUES). */
export const IN_LIST_MAX = 500;

/** `off`: the grid sends no HAVING filter. `fallback`: the keys cannot be sent exactly. `read`: the keys read to make (`key` is null when the table has no group key). */
export type KeysPlan = { kind: 'off' } | { kind: 'fallback' } | { kind: 'read'; key: string | null; options: TraverseOptions };

/** What the keys read leaves the charts with: an `in` rule (null when nothing narrows them), no rows at all, or the fallback. */
export type KeysOutcome = { kind: 'rule'; rule: TraverseFilter | null } | { kind: 'empty' } | { kind: 'fallback' };

/** The keys read for the grid's current query, or why the charts cannot follow its HAVING filters exactly. */
export function keysPlan(schema: Schema, shown: string[], agg: Aggregation, filters: ColumnFilter[], slices: ColumnFilter[]): KeysPlan {
  // The grid's own rows query decides which filters are sent, so the keys read carries exactly the same list.
  const q = buildRowQuery(schema, shown, filters, 0, [], agg, slices);
  const pairs = (q.filter ?? []).filter((f) => f.function);
  if (!pairs.length) return { kind: 'off' };
  const columns = q.column ?? [];
  const keys = columns.filter((c) => !(q.aggregation ?? []).some((a) => a.column === c));
  if (keys.length > 1) return { kind: 'fallback' };
  const key = keys[0] ?? null;
  if (key !== null && ((q.dateTrunc ?? []).some((r) => r.column === key) || schema.find((f) => f.name === key)?.category === 'boolean')) return { kind: 'fallback' };
  const seen = new Set<string>();
  const aggregation = pairs.flatMap((f) => { const id = `${f.column}|${f.function}`; if (seen.has(id)) return []; seen.add(id); return [{ column: f.column, function: f.function! }]; });
  const column = [...new Set([...(key ? [key] : []), ...aggregation.map((a) => a.column)])];
  return { kind: 'read', key, options: { column, aggregation, filter: q.filter, limit: IN_LIST_MAX + 1 } };
}

/** The rule that keeps the charts to the groups in `rows`, or the reason there is none. */
export function keysOutcome(key: string | null, rows: Row[]): KeysOutcome {
  if (rows.length === 0) return { kind: 'empty' };
  if (key === null) return { kind: 'rule', rule: null };
  if (rows.length > IN_LIST_MAX) return { kind: 'fallback' };
  const values = rows.map((r) => r[key]);
  if (values.every((v) => typeof v === 'string')) return { kind: 'rule', rule: { column: key, operator: 'in', value: values as string[] } };
  if (values.every((v) => typeof v === 'number')) return { kind: 'rule', rule: { column: key, operator: 'in', value: values as number[] } };
  // A null key, or keys of mixed types, which the backend rejects.
  return { kind: 'fallback' };
}

/** What the charts do while and after the keys are read. `gate` stands in for the charts until they may read. */
export type HavingKeys = {
  gate: null | { kind: 'loading' } | { kind: 'empty' } | { kind: 'error'; error: unknown; retry: () => void };
  /** The rule to add to every chart query. */
  rule: TraverseFilter | null;
  /** The charts could not follow the HAVING filters: they show the unfiltered groups and say so. */
  fallback: boolean;
};

const NONE: HavingKeys = { gate: null, rule: null, fallback: false };

/** Reads the passing keys through the cached chart query path. `idle` (Table view, a folded band) reads nothing. */
export function useHavingKeys(martId: string, plan: KeysPlan, version: number, idle: boolean): HavingKeys {
  const read = useChartQuery(martId, plan.kind === 'read' && !idle ? plan.options : null, version);
  return useMemo((): HavingKeys => {
    if (plan.kind === 'off') return NONE;
    if (plan.kind === 'fallback') return { gate: null, rule: null, fallback: true };
    if (idle) return NONE;
    if (read.error) return { gate: { kind: 'error', error: read.error, retry: read.retry }, rule: null, fallback: false };
    if (!read.rows) return { gate: { kind: 'loading' }, rule: null, fallback: false };
    const out = keysOutcome(plan.key, read.rows);
    if (out.kind === 'empty') return { gate: { kind: 'empty' }, rule: null, fallback: false };
    if (out.kind === 'fallback') return { gate: null, rule: null, fallback: true };
    return { gate: null, rule: out.rule, fallback: false };
  }, [plan, idle, read.rows, read.error, read.retry]);
}
