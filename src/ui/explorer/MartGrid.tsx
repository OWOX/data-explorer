import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { Info } from 'lucide-react';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import { fieldLabel, fieldTitle } from '../../model/fieldLabel';
import type { ColumnFilter } from '../../filters/build';
import type { Model, Schema } from '../../model/types';
import { clickTarget, primaryKeys, type RelColumn } from '../../records/relationships';
import { useMartRelationships } from '../../records/useMartRelationships';
import { lookupTitles } from '../../records/titles';
import type { Row } from '../../sdk/types';
import { sourceOfModel, useServices, useStore, type GridState } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Skeleton } from '../Skeleton';
import { Tooltip } from '../Tooltip';
import { BandTools, BandToolsSlot } from '../bands/BandTools';
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

/** `saved` is the grid as the reader left it; `filters` only changes when a followed link asks a mounted grid to re-seed. */
export type GridSeed = { filters?: ColumnFilter[]; saved?: GridState };

/** The grid for one mart: loads the schema, then reads rows. Key it by mart id. */
export function MartGrid({ martId, model, seed, onChange, onRows }: { martId: string; model: Model; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error } = useSchema(martId, schemaVersion);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <Grid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onRows={onRows} />;
}

// TanStack Table v9: row.getVisibleCells() needs the column visibility feature.
const features = tableFeatures({ columnVisibilityFeature });
type GridColumn = ColumnDef<typeof features, Row>;

const titleKey = (rel: RelColumn, value: unknown) => `${rel.relatedMartId}\u0000${rel.relatedField}\u0000${String(value)}`;

// Cells read titles and schemas from context so the header cells keep their identity when a lookup lands:
// a new header component would remount and close an open filter popover.
const GridEnv = createContext<{ titles: Map<string, string>; relSchemas: Map<string, Schema>; model: Model | null }>({ titles: new Map(), relSchemas: new Map(), model: null });

function GridCell({ row, name, rel }: { row: Row; name: string; rel: RelColumn | undefined }) {
  const { titles, relSchemas } = useContext(GridEnv);
  const { schemas } = useServices();
  const [, dispatch] = useStore();
  const { model } = useContext(GridEnv);
  if (!rel) return <CellValue row={row} field={name} />;
  const target = clickTarget(rel, row, relSchemas.get(rel.relatedMartId) ?? schemas.peek(rel.relatedMartId));
  return (
    <CellValue row={row} field={name} title={titles.get(titleKey(rel, row[name]))}
      onOpen={target && model ? () => dispatch({ type: 'follow', target, sourceOf: sourceOfModel(model) }) : undefined} />
  );
}

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function Grid({ martId, model, schema, seed, onChange, onRows }: { martId: string; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void }) {
  const { ctx, schemas } = useServices();
  const slot = useContext(BandToolsSlot);
  const [{ modelVersion }, dispatch] = useStore();
  // The columns, filters and page the reader left this mart with (a followed link has already written its filters there).
  const [visible, setVisible] = useState(() => {
    const kept = seed.saved?.columns.filter((c) => schema.some((f) => f.name === c)) ?? [];
    return kept.length ? kept : defaultColumns(schema);
  });
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() => seed.saved?.filters ?? {});
  const [limit, setLimit] = useState(() => seed.saved?.limit ?? PAGE_SIZE);
  const [ownVersion, setVersion] = useState(0);
  // The header's Refresh re-reads what is shown too: its counter joins the grid's own, and each only ever goes up.
  const version = ownVersion + modelVersion;
  // Titles per related mart and value, for the grid's lifetime. Every lookup is a billed run, so a value is looked up once.
  const [titles, setTitles] = useState(new Map<string, string>());
  const asked = useRef(new Set<string>());
  // A lookup is billed once it starts, so it is never aborted because the rows moved on: its results are
  // still wanted. Only unmount and Refresh abort (and the stale results are then dropped).
  const lookups = useRef(new AbortController());
  useEffect(() => {
    lookups.current = new AbortController();
    const ctrl = lookups.current;
    return () => ctrl.abort();
  }, []);
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());
  // A header Refresh drops the looked-up titles as the grid's own Refresh does, so they are read again with the rows.
  const seenModelVersion = useRef(modelVersion);
  useEffect(() => {
    if (seenModelVersion.current === modelVersion) return;
    seenModelVersion.current = modelVersion;
    lookups.current.abort();
    lookups.current = new AbortController();
    setTitles(new Map());
    asked.current.clear();
  }, [modelVersion]);

  // Re-seed the filters when a followed link asks for new ones on this same mart (adjust state during render).
  const [seededFrom, setSeededFrom] = useState(seed.filters);
  if (seededFrom !== seed.filters) {
    setSeededFrom(seed.filters);
    if (seed.filters) {
      setFilters(toFilterMap(seed.filters));
      setLimit(PAGE_SIZE);
    }
  }

  useEffect(() => { onChange({ columns: visible, filters, limit }); }, [visible, filters, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const { rels } = useMartRelationships(martId, model.edges);
  const pks = primaryKeys(schema);
  const query = useMemo(() => buildRowQuery(schema, visible, Object.values(filters), limit, rels), [schema, visible, filters, limit, rels]);
  const { rows, loading, error, hasMore } = useMartRows(martId, query, version);
  // The title effect depends on the relationship columns on screen, not on every change of `visible`.
  const visibleRelKey = visible.filter((n) => rels.has(n)).join('|');

  useEffect(() => {
    if (!rows || !visibleRelKey) return;
    const { signal } = lookups.current;
    for (const name of visibleRelKey.split('|')) {
      const rel = rels.get(name);
      if (!rel) continue;
      schemas.get(rel.relatedMartId).then(async (rs) => {
        setRelSchemas((m) => (m.get(rel.relatedMartId) === rs ? m : new Map(m).set(rel.relatedMartId, rs)));
        const fresh = [...new Set(rows.map((r) => r[rel.field]).filter((v) => !asked.current.has(titleKey(rel, v))))];
        if (fresh.length === 0 || signal.aborted) return;
        const keys = fresh.map((v) => titleKey(rel, v));
        keys.forEach((k) => asked.current.add(k));
        try {
          const found = await lookupTitles(ctx, rel, fresh, rs, signal);
          if (signal.aborted) return;
          setTitles((m) => { const n = new Map(m); for (const [v, t] of found) n.set(titleKey(rel, v), t); return n; });
        } catch (e) {
          // a failed lookup is retried by the next effect run; after Refresh or unmount `asked` is not ours to touch
          if (!signal.aborted) keys.forEach((k) => asked.current.delete(k));
          throw e;
        }
      }).catch(() => undefined);
    }
  }, [rows, visibleRelKey, rels, ctx, schemas]);

  const columns = useMemo<GridColumn[]>(() => visible.map((name) => {
    const field = schema.find((f) => f.name === name)!;
    const rel = rels.get(name);
    return {
      id: name,
      header: () => (
        <div className="flex items-center gap-1">
          <span className="truncate" title={fieldTitle(field)}>{fieldLabel(field)}</span>
          <FilterPopover field={field} value={filters[name]} onChange={(f) => {
            setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; });
            setLimit(PAGE_SIZE);
          }} />
          {field.description?.trim() && (
            <Tooltip content={field.description}>
              <button type="button" aria-label={`About ${fieldLabel(field)}`} className="dm-reveal dm-col-info">
                <Info className="size-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      ),
      cell: ({ row }) => <GridCell row={row.original} name={name} rel={rel} />,
    };
  }), [visible, schema, rels, filters]);

  const env = useMemo(() => ({ titles, relSchemas, model }), [titles, relSchemas, model]);
  const table = useTable({ features, data: rows ?? [], columns });
  const rowsLabel = rows ? `${rows.length}${hasMore ? '+' : ''}` : null;
  useEffect(() => { onRows?.(rowsLabel); }, [rowsLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <GridEnv.Provider value={env}>
    <div className="flex max-h-[32rem] min-h-0 flex-col">
      <BandTools slot={slot}>
        <button type="button" disabled={!hasFilters} onClick={() => { setFilters({}); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => { lookups.current.abort(); lookups.current = new AbortController(); setTitles(new Map()); asked.current.clear(); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ColumnPicker schema={schema} visible={visible} onChange={setVisible} />
      </BandTools>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && rows && <div className="h-0.5 animate-pulse bg-primary" />}
      <div className={`min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="dm-th max-w-64 border-b px-3 py-2 text-left font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
            ))}
          </thead>
          <tbody>
            {error ? <tr><td colSpan={visible.length || 1} className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></td></tr>
              : !rows ? <tr><td colSpan={visible.length || 1}><Skeleton rows={8} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={visible.length || 1} className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</td></tr>
              : table.getRowModel().rows.map((r) => (
                <tr key={r.id}
                  onClick={pks.length ? () => dispatch({ type: 'openRecord', martId, sourceOf: sourceOfModel(model), pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
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
