import { useEffect, useState } from 'react';
import { readRows } from '../../api/rows';
import { isComplete, toTraverseFilter, type ColumnFilter } from '../../filters/build';
import type { Schema } from '../../model/types';
import type { RelColumn } from '../../records/relationships';
import type { Row, TraverseOptions } from '../../sdk/types';
import { useServices } from '../../state/store';

export function defaultColumns(schema: Schema): string[] {
  return schema.filter((f) => !f.isCalculated).slice(0, 5).map((f) => f.name);
}

export function buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, rels: Map<string, RelColumn>): TraverseOptions {
  const need = new Set(visible);
  schema.filter((f) => f.isPrimaryKey).forEach((f) => need.add(f.name));
  // BigQuery bills per column scanned: join source fields are fetched only for relationship columns on screen
  // (and the composite partners their click needs), not for every relationship of the mart.
  for (const name of visible) rels.get(name)?.joins.forEach((j) => need.add(j.sourceField));
  const column = schema.map((f) => f.name).filter((n) => need.has(n));
  const filter = filters.flatMap((flt) => {
    const field = schema.find((x) => x.name === flt.field);
    return field && isComplete(flt, field) ? [toTraverseFilter(flt, field)] : [];
  });
  const pks = schema.filter((f) => f.isPrimaryKey).map((f) => ({ column: f.name, direction: 'asc' as const }));
  return { column, ...(filter.length ? { filter } : {}), ...(pks.length ? { sort: pks } : {}), limit: limit + 1 };
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
