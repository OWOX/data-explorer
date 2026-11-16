import { useEffect, useState } from 'react';
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
 * Grouped (a function or a bucket on a visible column): exactly the visible columns, in grid order, each function its own output;
 * every column without a rule is a group key. Primary keys are not added and no key tie-breaker sorts are, since a key would split the groups.
 */
function buildGroupedQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[], agg: Aggregation): TraverseOptions {
  const known = new Set(schema.map((f) => f.name));
  const column = visible.filter((n) => known.has(n));
  const filter = toTraverseFilters(schema, filters);
  const aggregations = agg.aggregations.filter((r) => column.includes(r.column));
  const dateTrunc = agg.dateTrunc.filter((r) => column.includes(r.column));
  const sort = sorts.filter((s) => column.includes(s.field)).map((s) => ({ column: s.field, direction: s.direction }));
  return { column, ...(filter.length ? { filter } : {}), ...(aggregations.length ? { aggregation: aggregations } : {}), ...(dateTrunc.length ? { dateTrunc } : {}), ...(sort.length ? { sort } : {}), limit: limit + 1 };
}

export function buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, sorts: SortKey[] = [], agg?: Aggregation): TraverseOptions {
  if (isGrouped(agg)) return buildGroupedQuery(schema, visible, filters, limit, sorts, agg!);
  const need = new Set(visible);
  schema.filter((f) => f.isPrimaryKey).forEach((f) => need.add(f.name));
  const column = schema.map((f) => f.name).filter((n) => need.has(n));
  const filter = toTraverseFilters(schema, filters);
  // The reader's sorts come first; the primary keys follow (unless already sorted) so "Load more" pages stay deterministic.
  const sort = [
    ...sorts.map((s) => ({ column: s.field, direction: s.direction })),
    ...schema.filter((f) => f.isPrimaryKey && !sorts.some((s) => s.field === f.name)).map((f) => ({ column: f.name, direction: 'asc' as const })),
  ];
  return { column, ...(filter.length ? { filter } : {}), ...(sort.length ? { sort } : {}), limit: limit + 1 };
}

type RowsState = { rows: Row[] | null; error: unknown; hasMore: boolean; doneFor: string | null };
type Query = { dataKey: string; columns: string[]; key: string };

export function useMartRows(martId: string, options: TraverseOptions | null, version: number) {
  const { ctx } = useServices();
  const [state, setState] = useState<RowsState>({ rows: null, error: null, hasMore: false, doneFor: null });
  // Each traverseData call is a billed warehouse run. Everything but the column list (filters, sort, limit,
  // version) is the data key: when it changes the rows are re-read. When columns only shrink, the loaded rows
  // already hold them, so the query identity stays and nothing is fetched; a column that was never loaded re-reads.
  const columns = options?.column;
  const dataKey = `${martId}:${version}:${JSON.stringify({ ...options, column: undefined })}`;
  const [query, setQuery] = useState<Query>({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  if (query.dataKey !== dataKey || !(columns ?? []).every((c) => query.columns.includes(c))) {
    setQuery({ dataKey, columns: columns ?? [], key: `${dataKey}:${(columns ?? []).join(',')}` });
  }
  const key = query.key;
  useEffect(() => {
    if (!options) return;
    const ac = new AbortController();
    const pageLimit = (options.limit ?? 1) - 1;
    readRows(ctx, martId, options, { signal: ac.signal }).then(
      (rows) => { if (!ac.signal.aborted) setState({ rows: rows.slice(0, pageLimit), error: null, hasMore: rows.length > pageLimit, doneFor: key }); },
      (error) => { if (!ac.signal.aborted) setState({ rows: null, error, hasMore: false, doneFor: key }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, martId, key]);
  // The previous rows stay visible while a newer request is in flight; an old error does not.
  const loading = state.doneFor !== key;
  return { rows: state.rows, loading, error: loading ? null : state.error, hasMore: state.hasMore };
}
