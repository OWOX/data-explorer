import { useEffect, useRef, useState } from 'react';
import { readRows } from '../../api/rows';
import { toTraverseFilters, type ColumnFilter } from '../../filters/build';
import type { SortKey } from '../../model/sort';
import { isGrouped, type Aggregation } from '../../model/aggregation';
import type { Schema } from '../../model/types';
import type { Row, TraverseOptions } from '../../sdk/types';
import { useServices } from '../../state/store';

export function defaultColumns(schema: Schema): string[] {
  return schema.filter((f) => !f.isCalculated).slice(0, 5).map((f) => f.name);
}

/**
 * Grouped (a function or a bucket on a visible column): exactly the visible columns, in schema order (a column move must not change the query), each function its own output;
 * every column without a rule is a group key. Primary keys are not added and no key tie-breaker sorts are, since a key would split the groups.
 */
function buildGroupedQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[], agg: Aggregation, slices: ColumnFilter[]): TraverseOptions {
  const shown = new Set(visible);
  const column = schema.map((f) => f.name).filter((n) => shown.has(n));
  const aggregations = agg.aggregations.filter((r) => column.includes(r.column));
  // A HAVING filter is sent only with its aggregation, which the converter checks against the rules this query carries.
  const filter = toTraverseFilters(schema, filters, slices, aggregations);
  const dateTrunc = agg.dateTrunc.filter((r) => column.includes(r.column));
  const sort = sorts.filter((s) => column.includes(s.field)).map((s) => ({ column: s.field, direction: s.direction }));
  return { column, ...(filter.length ? { filter } : {}), ...(aggregations.length ? { aggregation: aggregations } : {}), ...(dateTrunc.length ? { dateTrunc } : {}), ...(sort.length ? { sort } : {}), limit: limit + 1 };
}

export function buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[] = [], agg?: Aggregation, slices: ColumnFilter[] = []): TraverseOptions {
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

/** The query behind the rows on the grid, for Copy SQL. */
/** `paused`: Charts holds the grid's query back, and a key it has not read yet will not run until Table is back. */
export type GridRun = { state: 'none' } | { state: 'paused' } | { state: 'running' } | { state: 'failed' } | { state: 'done'; runId: string | null };

type RowsState = { rows: Row[] | null; error: unknown; hasMore: boolean; doneFor: string | null; shape: string; runId: string | null };
/** What the rows are rows of: plain rows, or groups over these columns and rules. Rows of one shape never stand in for another's. */
const shapeOf = (o: TraverseOptions | null): string => (o?.aggregation?.length || o?.dateTrunc?.length ? JSON.stringify([o.column, o.aggregation, o.dateTrunc]) : 'plain');
type Query = { dataKey: string; columns: string[]; key: string };

/** `paused` keeps the key (and the rows) but reads nothing; what was read for a key is not read again when the pause ends. */
export function useMartRows(martId: string, options: TraverseOptions | null, version: number, paused = false) {
  const { ctx } = useServices();
  const [state, setState] = useState<RowsState>({ rows: null, error: null, hasMore: false, doneFor: null, shape: 'plain', runId: null });
  // Each traverseData call is a billed warehouse run. Everything but the column list (filters, sort, limit,
  // version) is the data key: when it changes the rows are re-read. When columns only shrink, the loaded rows
  // already hold them, so the query identity stays and nothing is fetched; a column that was never loaded re-reads.
  const columns = options?.column;
  // A grouped query is the exception: every column without a rule is a group key, so fewer columns are different rows, not a subset of them.
  const grouped = !!(options?.aggregation?.length || options?.dateTrunc?.length);
  const dataKey = `${martId}:${version}:${JSON.stringify({ ...options, column: grouped ? options?.column : undefined })}`;
  const [query, setQuery] = useState<Query>({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  if (query.dataKey !== dataKey || !(columns ?? []).every((c) => query.columns.includes(c))) {
    setQuery({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  }
  const key = query.key;
  const readKey = useRef<string | null>(null);
  useEffect(() => {
    if (!options || paused || readKey.current === key) return;
    const ac = new AbortController();
    const pageLimit = (options.limit ?? 1) - 1;
    let runId: string | null = null;
    readRows(ctx, martId, options, { signal: ac.signal, onRunId: (id) => { runId = id ?? null; } }).then(
      (rows) => { if (!ac.signal.aborted) { readKey.current = key; setState({ rows: rows.slice(0, pageLimit), error: null, hasMore: rows.length > pageLimit, doneFor: key, shape: shapeOf(options), runId }); } },
      (error) => { if (!ac.signal.aborted) setState({ rows: null, error, hasMore: false, doneFor: key, shape: shapeOf(options), runId: null }); },
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
  return { rows: stale ? null : state.rows, loading, error: loading ? null : state.error, hasMore: stale ? false : state.hasMore, run };
}
