import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import type { ColumnFilter } from '../../filters/build';
import type { Model, Schema } from '../../model/types';
import { clickTarget, primaryKeys, relationshipColumns } from '../../records/relationships';
import { lookupTitles } from '../../records/titles';
import type { Row } from '../../sdk/types';
import { useServices, useStore, type Tab } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { MartIcon } from '../icons';
import { Skeleton } from '../Skeleton';
import { CellValue } from './CellValue';
import { ColumnPicker } from './ColumnPicker';
import { FilterPopover } from './FilterPopover';
import { buildRowQuery, defaultColumns, useMartRows } from './useMartRows';

function useSchema(martId: string, version: number) {
  const { schemas } = useServices();
  const [s, setS] = useState<{ schema: Schema | null; error: unknown }>({ schema: schemas.peek(martId) ?? null, error: null });
  useEffect(() => {
    let live = true;
    schemas.get(martId).then((schema) => live && setS({ schema, error: null }), (error) => live && setS({ schema: null, error }));
    return () => { live = false; };
  }, [schemas, martId, version]);
  return s;
}

export function MartTab({ tab, model }: { tab: Extract<Tab, { kind: 'mart' }>; model: Model }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error } = useSchema(tab.martId, schemaVersion);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <MartGrid tab={tab} model={model} schema={schema} />;
}

// TanStack Table v9: row.getVisibleCells() needs the column visibility feature.
const features = tableFeatures({ columnVisibilityFeature });
type GridColumn = ColumnDef<typeof features, Row>;

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function MartGrid({ tab, model, schema }: { tab: Extract<Tab, { kind: 'mart' }>; model: Model; schema: Schema }) {
  const { ctx, schemas } = useServices();
  const [, dispatch] = useStore();
  const mart = model.marts.get(tab.martId)!;
  const [visible, setVisible] = useState(() => defaultColumns(schema));
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() => toFilterMap(tab.initialFilters));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [version, setVersion] = useState(0);
  const [titles, setTitles] = useState(new Map<string, Map<string, string>>());
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());

  // Re-seed the filters when the tab is reopened with new initialFilters (adjust state during render).
  const [seededFrom, setSeededFrom] = useState(tab.initialFilters);
  if (seededFrom !== tab.initialFilters) {
    setSeededFrom(tab.initialFilters);
    setFilters(toFilterMap(tab.initialFilters));
    setLimit(PAGE_SIZE);
  }

  const rels = useMemo(() => relationshipColumns(tab.martId, model.edges), [tab.martId, model.edges]);
  const pks = primaryKeys(schema);
  const query = useMemo(() => buildRowQuery(schema, visible, Object.values(filters), limit, rels), [schema, visible, filters, limit, rels]);
  const { rows, loading, error, hasMore } = useMartRows(tab.martId, query, version);

  useEffect(() => {
    if (!rows) return;
    const ac = new AbortController();
    for (const name of visible) {
      const rel = rels.get(name);
      if (!rel) continue;
      schemas.get(rel.relatedMartId).then(async (rs) => {
        setRelSchemas((m) => new Map(m).set(rel.relatedMartId, rs));
        const t = await lookupTitles(ctx, rel, rows.map((r) => r[rel.field]), rs, ac.signal);
        if (!ac.signal.aborted) setTitles((m) => new Map(m).set(name, t));
      }).catch(() => undefined);
    }
    return () => ac.abort();
  }, [rows, visible, rels, ctx, schemas]);

  const columns = useMemo<GridColumn[]>(() => visible.map((name) => {
    const field = schema.find((f) => f.name === name)!;
    const rel = rels.get(name);
    return {
      id: name,
      header: () => (
        <div className="flex items-center gap-1">
          <span className="truncate" title={field.description ?? field.name}>{field.alias ?? field.name}</span>
          <FilterPopover field={field} value={filters[name]} onChange={(f) => {
            setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; });
            setLimit(PAGE_SIZE);
          }} />
        </div>
      ),
      cell: ({ row }) => {
        if (!rel) return <CellValue row={row.original} field={name} />;
        const target = clickTarget(rel, row.original, relSchemas.get(rel.relatedMartId) ?? []);
        return (
          <CellValue row={row.original} field={name}
            title={titles.get(name)?.get(String(row.original[name]))}
            onOpen={target ? () => dispatch(target.kind === 'record' ? { type: 'openRecord', martId: target.martId, pk: target.pk } : { type: 'openMart', martId: target.martId, filters: target.filters }) : undefined} />
        );
      },
    };
  }), [visible, schema, rels, filters, titles, relSchemas, dispatch]);

  const table = useTable({ features, data: rows ?? [], columns });
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <MartIcon icon={mart.icon} />
        <span className="font-semibold">{mart.title}</span>
        {rows && <span className="text-xs text-muted-foreground">{rows.length}{hasMore ? '+' : ''} rows</span>}
        <div className="flex-1" />
        <button type="button" disabled={!hasFilters} onClick={() => { setFilters({}); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => { setTitles(new Map()); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ColumnPicker schema={schema} visible={visible} onChange={setVisible} />
      </div>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && rows && <div className="h-0.5 animate-pulse bg-primary" />}
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></div>
        : !rows ? <Skeleton rows={8} />
        : rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</p>
        : (
          <div className={`min-h-0 flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="max-w-64 border-b px-3 py-2 text-left font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id}
                    onClick={pks.length ? () => dispatch({ type: 'openRecord', martId: tab.martId, pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
                    className={`border-b ${pks.length ? 'cursor-pointer hover:bg-accent' : ''}`}>
                    {r.getVisibleCells().map((c) => <td key={c.id} className="max-w-64 px-3 py-1.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && <div className="p-3 text-center"><button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Load more</button></div>}
          </div>
        )}
    </div>
  );
}
