import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import type { ColumnFilter } from '../../filters/build';
import type { Model, Schema } from '../../model/types';
import { clickTarget, primaryKeys, type RelColumn } from '../../records/relationships';
import { useMartRelationships } from '../../records/useMartRelationships';
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

const titleKey = (rel: RelColumn, value: unknown) => `${rel.relatedMartId}\u0000${rel.relatedField}\u0000${String(value)}`;

// Cells read titles and schemas from context so the header cells keep their identity when a lookup lands:
// a new header component would remount and close an open filter popover.
const GridEnv = createContext<{ titles: Map<string, string>; relSchemas: Map<string, Schema> }>({ titles: new Map(), relSchemas: new Map() });

function GridCell({ row, name, rel }: { row: Row; name: string; rel: RelColumn | undefined }) {
  const { titles, relSchemas } = useContext(GridEnv);
  const { schemas } = useServices();
  const [, dispatch] = useStore();
  if (!rel) return <CellValue row={row} field={name} />;
  const target = clickTarget(rel, row, relSchemas.get(rel.relatedMartId) ?? schemas.peek(rel.relatedMartId));
  return (
    <CellValue row={row} field={name} title={titles.get(titleKey(rel, row[name]))}
      onOpen={target ? () => dispatch(target.kind === 'record' ? { type: 'openRecord', martId: target.martId, pk: target.pk } : { type: 'openMart', martId: target.martId, filters: target.filters }) : undefined} />
  );
}

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function MartGrid({ tab, model, schema }: { tab: Extract<Tab, { kind: 'mart' }>; model: Model; schema: Schema }) {
  const { ctx, schemas } = useServices();
  const [, dispatch] = useStore();
  const mart = model.marts.get(tab.martId);
  const [visible, setVisible] = useState(() => defaultColumns(schema));
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() => toFilterMap(tab.initialFilters));
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [version, setVersion] = useState(0);
  // Titles per related mart and value, for the tab's lifetime. Every lookup is a billed run, so a value is looked up once.
  const [titles, setTitles] = useState(new Map<string, string>());
  const asked = useRef(new Set<string>());
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());

  // Re-seed the filters when the tab is reopened with new initialFilters (adjust state during render).
  const [seededFrom, setSeededFrom] = useState(tab.initialFilters);
  if (seededFrom !== tab.initialFilters) {
    setSeededFrom(tab.initialFilters);
    setFilters(toFilterMap(tab.initialFilters));
    setLimit(PAGE_SIZE);
  }

  const { rels } = useMartRelationships(tab.martId, model.edges);
  const pks = primaryKeys(schema);
  const query = useMemo(() => buildRowQuery(schema, visible, Object.values(filters), limit, rels), [schema, visible, filters, limit, rels]);
  const { rows, loading, error, hasMore } = useMartRows(tab.martId, query, version);
  // The title effect depends on the relationship columns on screen, not on every change of `visible`.
  const visibleRelKey = visible.filter((n) => rels.has(n)).join('|');

  useEffect(() => {
    if (!rows || !visibleRelKey) return;
    const ac = new AbortController();
    for (const name of visibleRelKey.split('|')) {
      const rel = rels.get(name);
      if (!rel) continue;
      schemas.get(rel.relatedMartId).then(async (rs) => {
        setRelSchemas((m) => (m.get(rel.relatedMartId) === rs ? m : new Map(m).set(rel.relatedMartId, rs)));
        const fresh = [...new Set(rows.map((r) => r[rel.field]).filter((v) => !asked.current.has(titleKey(rel, v))))];
        if (fresh.length === 0) return;
        const keys = fresh.map((v) => titleKey(rel, v));
        keys.forEach((k) => asked.current.add(k));
        try {
          const found = await lookupTitles(ctx, rel, fresh, rs, ac.signal);
          setTitles((m) => { const n = new Map(m); for (const [v, t] of found) n.set(titleKey(rel, v), t); return n; });
        } catch (e) {
          // an aborted or failed lookup is retried by the next effect run
          keys.forEach((k) => asked.current.delete(k));
          throw e;
        }
      }).catch(() => undefined);
    }
    return () => ac.abort();
  }, [rows, visibleRelKey, rels, ctx, schemas]);

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
      cell: ({ row }) => <GridCell row={row.original} name={name} rel={rel} />,
    };
  }), [visible, schema, rels, filters]);

  const env = useMemo(() => ({ titles, relSchemas }), [titles, relSchemas]);
  const table = useTable({ features, data: rows ?? [], columns });
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <GridEnv.Provider value={env}>
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <MartIcon icon={mart?.icon ?? null} />
        <span className="font-semibold">{mart?.title ?? tab.martId}</span>
        {rows && <span className="text-xs text-muted-foreground">{rows.length}{hasMore ? '+' : ''} rows</span>}
        <div className="flex-1" />
        <button type="button" disabled={!hasFilters} onClick={() => { setFilters({}); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => { setTitles(new Map()); asked.current.clear(); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ColumnPicker schema={schema} visible={visible} onChange={setVisible} />
      </div>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && rows && <div className="h-0.5 animate-pulse bg-primary" />}
      <div className={`min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="max-w-64 border-b px-3 py-2 text-left font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
            ))}
          </thead>
          <tbody>
            {error ? <tr><td colSpan={visible.length || 1} className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></td></tr>
              : !rows ? <tr><td colSpan={visible.length || 1}><Skeleton rows={8} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={visible.length || 1} className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</td></tr>
              : table.getRowModel().rows.map((r) => (
                <tr key={r.id}
                  onClick={pks.length ? () => dispatch({ type: 'openRecord', martId: tab.martId, pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
                  className={`border-b ${pks.length ? 'cursor-pointer hover:bg-accent' : ''}`}>
                  {r.getVisibleCells().map((c) => <td key={c.id} className="max-w-64 px-3 py-1.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                </tr>
              ))}
          </tbody>
        </table>
        {!error && hasMore && <div className="p-3 text-center"><button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Load more</button></div>}
      </div>
    </div>
    </GridEnv.Provider>
  );
}
