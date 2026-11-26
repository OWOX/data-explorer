import { useEffect, useRef, useState } from 'react';
import { readRows } from '../../api/rows';
import { stable } from '../../charts/answers';
import { toTraverseFilters, type ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import { isGrouped, type Grouping } from '../../model/aggregation';
import type { Schema } from '../../model/types';
import { uniqueKey } from '../../model/unique-count';
import { perCtx } from '../../sdk/per-ctx';
import type { Ctx, Row, TraverseOptions } from '../../sdk/types';
import { useServices } from '../../state/store';

/**
 * Grouped (a function or a bucket on a visible column, or a data mart's Unique Count): exactly the visible columns, in schema order (a column move must not change the query), each function its own output;
 * every column without a rule is a group key. Primary keys are not added and no key tie-breaker sorts are, since a key would split the groups.
 */
function buildGroupedQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[], agg: Grouping, slices: ColumnFilter[]): TraverseOptions {
  const shown = new Set(visible);
  const column = schema.map((f) => f.name).filter((n) => shown.has(n));
  const aggregations = agg.aggregations.filter((r) => column.includes(r.column));
  // A HAVING filter is sent only with its aggregation, which the converter checks against the rules this query carries.
  const filter = toTraverseFilters(schema, filters, slices, aggregations);
  const dateTrunc = agg.dateTrunc.filter((r) => column.includes(r.column));
  const uniqueKeys = (agg.uniqueCount ?? []).map(uniqueKey);
  const sort = sorts.filter((s) => column.includes(s.field) || uniqueKeys.includes(s.field)).map((s) => ({ column: s.field, direction: s.direction }));
  const uniqueCount = agg.uniqueCount ?? [];
  return { column, ...(filter.length ? { filter } : {}), ...(aggregations.length ? { aggregation: aggregations } : {}), ...(dateTrunc.length ? { dateTrunc } : {}), ...(uniqueCount.length ? { uniqueCount: [...uniqueCount] } : {}), ...(sort.length ? { sort } : {}), limit: limit + 1 };
}

export function buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[] = [], agg?: Grouping, slices: ColumnFilter[] = []): TraverseOptions {
  if (isGrouped(agg)) return buildGroupedQuery(schema, visible, filters, limit, sorts, agg!, slices);
  const need = new Set(visible);
  schema.filter((f) => f.isPrimaryKey).forEach((f) => need.add(f.name));
  const column = schema.map((f) => f.name).filter((n) => need.has(n));
  const filter = toTraverseFilters(schema, filters, slices);
  // The reader's sorts come first; the primary keys follow (unless already sorted) so "Load more" pages stay deterministic.
  const sort = [
    ...sorts.map((s) => ({ column: s.field, direction: s.direction })),
    ...schema.filter((f) => f.isPrimaryKey && !sorts.some((s) => s.field === f.name)).map((f) => ({ column: f.name, direction: 'asc' as const })),
  ];
  return { column, ...(filter.length ? { filter } : {}), ...(sort.length ? { sort } : {}), limit: limit + 1 };
}

/** `paused`: Charts holds the grid's query back, and a key it has not read yet will not run until Table is back. */
export type GridRun = { state: 'none' } | { state: 'paused' } | { state: 'running' } | { state: 'failed' } | { state: 'done'; runId: string | null };

type RowsState = { rows: Row[] | null; error: unknown; hasMore: boolean; doneFor: string | null; shape: string; runId: string | null; errorRunId: string | null; total: number | null; /** What `total` counted (the base of the ask) and whether that read named a calculated field. */ totalBase: string | null; totalExact: boolean; /** The columns that read carried: a plain read joins every mart it names a column of, so its count is of those joins. */ totalColumns: string[] };
/** What the rows are rows of: plain rows, or groups over these columns and rules. Rows of one shape never stand in for another's. */
const isGroupedRead = (o: TraverseOptions): boolean => !!(o.aggregation?.length || o.dateTrunc?.length || o.uniqueCount?.length);
const shapeOf = (o: TraverseOptions | null): string => (o?.aggregation?.length || o?.dateTrunc?.length || o?.uniqueCount?.length ? JSON.stringify([o.column, o.aggregation, o.dateTrunc, o.uniqueCount]) : 'plain');
const NO_COUNT = { total: null, exact: false, columns: [] as string[] };

/** How many resolved reads a ctx keeps for the grid. The least recently used is dropped first. */
export const GRID_CACHE_LIMIT = 16;
// Resolved reads only, per ctx: a failed or aborted read is never stored, so Retry always reads again.
// `rows` is everything the read returned (up to its limit + 1), so a smaller page is answered from it with no read.
type Entry = { martId: string; version: number; options: TraverseOptions; rows: Row[]; columns: string[]; exact: boolean; rest: string; total: number | undefined; totalBase: string; totalColumns: string[]; totalExact: boolean; runId: string | null };
const cacheOf = perCtx(() => new Map<string, Entry>());

function remember(ctx: Ctx, key: string, entry: Entry) {
  const cache = cacheOf(ctx);
  cache.delete(key);
  cache.set(key, entry);
  // A Map keeps insertion order and a hit re-inserts its key, so the first key is the least recently used.
  if (cache.size > GRID_CACHE_LIMIT) cache.delete(cache.keys().next().value!);
}

/** The options that make rows what they are: all but the columns and the page size (and the count flag, which is not part of any result). */
const restOf = (o: TraverseOptions): string => stable({ ...o, column: undefined, limit: undefined, includeTotalRowCount: undefined });

/** Drops every cached read of a mart: Refresh must not be answered from rows read before it, also after the grid is opened again. */
export function forgetGridRows(ctx: Ctx, martId: string) {
  const cache = cacheOf(ctx);
  for (const [k, e] of cache) if (e.martId === martId) cache.delete(k);
}

/** The state a cached read puts on show for this ask. */
function viewOf(e: Entry, options: TraverseOptions, key: string, base: string): RowsState {
  const limit = (options.limit ?? 1) - 1;
  return { rows: e.rows.slice(0, limit), error: null, hasMore: e.rows.length > limit, doneFor: key, shape: shapeOf(options), runId: e.runId, errorRunId: null, total: e.total ?? null, totalBase: base, totalExact: e.totalExact, totalColumns: e.totalColumns };
}

/** The cached read that answers this ask: the same result (mart, version, filters, sort, grouping) with the columns and enough rows. */
function lookup(ctx: Ctx, martId: string, version: number, options: TraverseOptions, exact: boolean): { key: string; entry: Entry } | null {
  if (options.limit === undefined) return null;
  const pageLimit = options.limit - 1;
  const rest = restOf(options);
  const want = options.column ?? [];
  const grouped = isGroupedRead(options);
  for (const [key, e] of cacheOf(ctx)) {
    if (e.martId !== martId || e.version !== version || e.rest !== rest) continue;
    // A grouped read: other columns are other group keys. A plain read: the loaded columns may hold more; a calculated field may make OWOX group the read, so then the sets must match.
    const columnsOk = grouped ? e.columns.length === want.length && e.columns.every((c, i) => c === want[i]) : want.every((c) => e.columns.includes(c)) && (!(exact || e.exact) || want.length === e.columns.length);
    if (!columnsOk) continue;
    if (e.rows.length > pageLimit || e.rows.length < (e.options.limit ?? 0)) return { key, entry: e };
  }
  return null;
}

type Query = { dataKey: string; columns: string[]; key: string };

/**
 * `paused` keeps the key (and the rows) but reads nothing; what was read for a key is not read again when the pause ends.
 * `exact`: this read names a calculated field. OWOX may group such a read (it does when the formula aggregates), so its count is reused only by a read of the same columns (it is not part of any key).
 */
export function useMartRows(martId: string, options: TraverseOptions | null, version: number, paused = false, exact = false) {
  const { ctx } = useServices();
  const [state, setState] = useState<RowsState>({ rows: null, error: null, hasMore: false, doneFor: null, shape: 'plain', runId: null, errorRunId: null, total: null, totalBase: null, totalExact: false, totalColumns: [] });
  // Each traverseData call is a billed warehouse run. Everything but the column list (filters, sort, limit,
  // version) is the data key: when it changes the rows are re-read. When columns only shrink, the loaded rows
  // already hold them, so the query identity stays and nothing is fetched; a column that was never loaded re-reads.
  const columns = options?.column;
  // A grouped query is the exception: every column without a rule is a group key, so fewer columns are different rows, not a subset of them.
  const grouped = !!(options?.aggregation?.length || options?.dateTrunc?.length || options?.uniqueCount?.length);
  const dataKey = `${martId}:${version}:${JSON.stringify({ ...options, column: grouped ? options?.column : undefined })}`;
  const [query, setQuery] = useState<Query>({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  if (query.dataKey !== dataKey || !(columns ?? []).every((c) => query.columns.includes(c))) {
    setQuery({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  }
  const key = query.key;
  const readKey = useRef<string | null>(null);
  // The count is asked once per result. `base` is the data key without limit and sort (Load more and a sort keep the result), and without
  // the columns of a plain read (a hidden column does not make another result; a never-loaded one is checked against `columns`).
  const base = `${martId}:${version}:${JSON.stringify({ ...options, column: grouped ? options?.column : undefined, limit: undefined, sort: undefined })}`;
  // The last read that asked: what it was and what it counted (undefined: it came without a count). A covered read leaves it as it is.
  const counted = useRef<{ base: string; columns: string[]; exact: boolean; total: number | undefined } | null>(null);
  useEffect(() => {
    if (!options || paused || readKey.current === key) return;
    const hit = lookup(ctx, martId, version, options, exact);
    if (hit) {
      // The render already shows this hit; this commits it to state and refs and marks the entry recently used.
      const cache = cacheOf(ctx);
      cache.delete(hit.key);
      cache.set(hit.key, hit.entry);
      readKey.current = key;
      // The count this result carries covers the next read of the same base, as it did when it was read.
      const e = hit.entry;
      counted.current = { base, columns: e.totalColumns, exact: e.totalExact, total: e.total };
      // eslint-disable-next-line react-hooks/set-state-in-effect -- a hit has no promise to answer through
      setState(viewOf(hit.entry, options, key, base));
      return;
    }
    const ac = new AbortController();
    const pageLimit = (options.limit ?? 1) - 1;
    let runId: string | null = null;
    const sent = options.column ?? [];
    const c = counted.current;
    // OWOX may group a read that names a calculated field (it does when the formula aggregates) by its other columns, so there fewer columns can be another result: the sets must match.
    const covered = !!c && c.base === base && sent.every((n) => c.columns.includes(n)) && (!(exact || c.exact) || (sent.length === c.columns.length));
    const ask = !covered;
    let total = ask ? undefined : c?.total;
    // The flag goes on this copy only: it is not part of the caller's options or of any key.
    const sentOptions = ask ? { ...options, includeTotalRowCount: true } : options;
    readRows(ctx, martId, sentOptions, { signal: ac.signal, onRunId: (id) => { runId = id ?? null; }, onTotalRowCount: (n) => { if (ask) total = n; } }).then(
      (rows) => {
        if (ac.signal.aborted) return;
        readKey.current = key;
        if (ask) counted.current = { base, columns: sent, exact, total };
        const totalExact = ask ? exact : !!c?.exact;
        const totalColumns = ask ? sent : c?.columns ?? sent;
        if (options.limit !== undefined) remember(ctx, key, { martId, version, options, rows, columns: sent, exact, rest: restOf(options), total, totalBase: base, totalColumns, totalExact, runId });
        setState({ rows: rows.slice(0, pageLimit), error: null, hasMore: rows.length > pageLimit, doneFor: key, shape: shapeOf(options), runId, errorRunId: null, total: total ?? null, totalBase: base, totalExact, totalColumns });
      },
      (error) => { if (!ac.signal.aborted) setState({ rows: null, error, hasMore: false, doneFor: key, shape: shapeOf(options), runId: null, errorRunId: runId, total: null, totalBase: null, totalExact: false, totalColumns: [] }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, martId, key, paused]);
  // A cached read answers on this very render, so Undo or Charts to Table paint with no busy frame (the effect only commits it).
  const hit = options && !paused && state.doneFor !== key ? lookup(ctx, martId, version, options, exact) : null;
  const view = hit ? viewOf(hit.entry, options!, key, base) : state;
  // The previous rows stay visible while a newer request is in flight; an old error does not.
  const loading = view.doneFor !== key;
  // Except rows of another shape (ungrouped rows under a grouped query, or the reverse, or other group keys): they would be read
  // with the wrong headers and counted with the wrong label, so nothing is shown until the new rows arrive.
  const stale = loading && view.shape !== shapeOf(options);
  const run: GridRun = !options ? { state: 'none' } : loading && paused ? { state: 'paused' } : loading ? { state: 'running' } : view.error ? { state: 'failed' } : { state: 'done', runId: view.runId };
  return { rows: stale ? null : view.rows, loading, error: loading ? null : view.error, hasMore: stale ? false : view.hasMore, run, errorRunId: loading ? null : view.errorRunId, total: stale ? null : view.total,
    // The count a card may use: the one counted for this very result (Load more and a sort keep it), and whether a calculated field made it. Another filter has none until its read answers.
    counted: !stale && view.totalBase === base && view.total !== null ? { total: view.total, exact: view.totalExact, columns: view.totalColumns } : NO_COUNT };
}
