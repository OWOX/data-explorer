import { useEffect, useRef, useState } from 'react';
import { readRows } from '../../api/rows';
import { toTraverseFilters, type ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import { isGrouped, type Grouping } from '../../model/aggregation';
import type { Schema } from '../../model/types';
import { uniqueKey } from '../../model/unique-count';
import type { Row, TraverseOptions } from '../../sdk/types';
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
const shapeOf = (o: TraverseOptions | null): string => (o?.aggregation?.length || o?.dateTrunc?.length || o?.uniqueCount?.length ? JSON.stringify([o.column, o.aggregation, o.dateTrunc, o.uniqueCount]) : 'plain');
const NO_COUNT = { total: null, exact: false, columns: [] as string[] };
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
        setState({ rows: rows.slice(0, pageLimit), error: null, hasMore: rows.length > pageLimit, doneFor: key, shape: shapeOf(options), runId, errorRunId: null, total: total ?? null, totalBase: base, totalExact: ask ? exact : !!c?.exact, totalColumns: ask ? sent : c?.columns ?? sent });
      },
      (error) => { if (!ac.signal.aborted) setState({ rows: null, error, hasMore: false, doneFor: key, shape: shapeOf(options), runId: null, errorRunId: runId, total: null, totalBase: null, totalExact: false, totalColumns: [] }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, martId, key, paused]);
  // The previous rows stay visible while a newer request is in flight; an old error does not.
  const loading = state.doneFor !== key;
  // Except rows of another shape (ungrouped rows under a grouped query, or the reverse, or other group keys): they would be read
  // with the wrong headers and counted with the wrong label, so nothing is shown until the new rows arrive.
  const stale = loading && state.shape !== shapeOf(options);
  const run: GridRun = !options ? { state: 'none' } : loading && paused ? { state: 'paused' } : loading ? { state: 'running' } : state.error ? { state: 'failed' } : { state: 'done', runId: state.runId };
  return { rows: stale ? null : state.rows, loading, error: loading ? null : state.error, hasMore: stale ? false : state.hasMore, run, errorRunId: loading ? null : state.errorRunId, total: stale ? null : state.total,
    // The count a card may use: the one counted for this very result (Load more and a sort keep it), and whether a calculated field made it. Another filter has none until its read answers.
    counted: !stale && state.totalBase === base && state.total !== null ? { total: state.total, exact: state.totalExact, columns: state.totalColumns } : NO_COUNT };
}
