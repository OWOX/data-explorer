import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Box, Info, RefreshCw, RotateCcw } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import type { JoinedSource } from '../../api/blendable';
import { columnTitle, fieldTitle } from '../../model/fieldLabel';
import type { ColumnFilter } from '../../filters/build';
import { cycleSort, defaultSort, sortsOnColumns, type SortKey } from '../../model/sort';
import type { Model, Schema } from '../../model/types';
import { primaryKeys } from '../../records/relationships';
import type { Row } from '../../sdk/types';
import { sourceOfModel, useServices, useStore, type GridState } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Skeleton } from '../Skeleton';
import { OverflowTip, Tooltip } from '../Tooltip';
import { BandTools, BandToolsSlot } from '../bands/BandTools';
import { PickedIcon } from '../bands/picked';
import { CellValue } from './CellValue';
import { ColumnPicker, type JoinedState } from './ColumnPicker';
import { ExportMenu } from './ExportMenu';
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
  return <SeededGrid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onRows={onRows} />;
}

/** A saved-columns read slower than this is given up on for this mount. */
export const SAVED_COLUMNS_WAIT_MS = 3000;

/** The schema a grid reads and filters over: the mart's own fields, then the fields of the joined marts it has loaded. */
const withJoined = (schema: Schema, sources: JoinedSource[]): Schema => (sources.length ? [...schema, ...sources.flatMap((s) => s.fields)] : schema);

/** The names in `saved` the column picker still offers, in the saved order. */
const offered = (schema: Schema, saved: string[]) => saved.filter((c) => schema.some((f) => f.name === c));

/** Whether a saved grid names something the mart's own schema does not have: a joined field, so the joined marts must be read first. */
const namesJoined = (schema: Schema, saved: GridState | undefined) =>
  !!saved && [...saved.columns, ...Object.keys(saved.filters), ...(saved.sorts ?? []).map((x) => x.field)].some((n) => !schema.some((f) => f.name === n));

type Initial = { columns: string[]; cleaned: string[] | null; sources: JoinedSource[] | null };

/**
 * Settles the first column set before the grid mounts, so the first rows query is the only one:
 * this session's columns, else the member's saved ones (read once, at most 3 s), else the defaults.
 * A column saved from a joined mart waits for the joined marts to be read (inside the same 3 s): a read that
 * fails leaves those columns out of this visit without erasing them from what is saved.
 */
function SeededGrid(props: { martId: string; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void }) {
  const { martId, schema, seed } = props;
  const { columnStore, blendable } = useServices();
  const [initial, setInitial] = useState<Initial | null>(() => {
    const cached = blendable.peek(martId);
    const full = withJoined(schema, cached ?? []);
    const kept = offered(full, seed.saved?.columns ?? []);
    // A session list that names a joined field waits for the joined marts unless they are already known.
    return kept.length && (cached || !namesJoined(schema, seed.saved)) ? { columns: kept, cleaned: null, sources: cached ?? null } : null;
  });
  useEffect(() => {
    if (initial) return;
    let live = true;
    const timer = setTimeout(() => { live = false; setInitial({ columns: defaultColumns(schema), cleaned: null, sources: null }); }, SAVED_COLUMNS_WAIT_MS);
    (async () => {
      const own = seed.saved?.columns;
      const saved = own ?? await columnStore.load(martId) ?? [];
      const needs = namesJoined(schema, own ? seed.saved : { columns: saved, filters: seed.saved?.filters ?? {}, sorts: seed.saved?.sorts ?? null, limit: 0 });
      let sources: JoinedSource[] | null = blendable.peek(martId) ?? null;
      let failed = false;
      if (needs && !sources) {
        try { sources = await blendable.get(martId); } catch { failed = true; }
      }
      if (!live) return;
      clearTimeout(timer);
      const kept = offered(withJoined(schema, sources ?? []), saved);
      // Names a failed read could not check are left in what is saved; only names the schema really lacks are cleaned out.
      const dropped = !failed && saved.length > kept.length;
      setInitial({ columns: kept.length ? kept : defaultColumns(schema), cleaned: dropped ? kept : null, sources });
    })();
    return () => { live = false; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cleaned = initial?.cleaned ?? null;
  // The cleanup of a saved list that named columns that are gone is the one save that is not the member's own change.
  useEffect(() => { if (cleaned) columnStore.save(martId, cleaned); }, [cleaned, columnStore, martId]);
  if (!initial) return <Skeleton rows={8} />;
  return <Grid {...props} initialColumns={initial.columns} initialSources={initial.sources} />;
}

// TanStack Table v9: row.getVisibleCells() needs the column visibility feature.
const features = tableFeatures({ columnVisibilityFeature });
type GridColumn = ColumnDef<typeof features, Row>;

// The sorts reach the header cells through context so they keep their identity when a sort changes:
// a new header component would remount and close an open filter popover.
const GridEnv = createContext<{ sorts: SortKey[]; toggleSort: (field: string) => void }>({ sorts: [], toggleSort: () => undefined });

/** How wide a column may grow before its text is clipped: free text is allowed the most room. */
const maxWidthOf = (field: Pick<Schema[number], 'category'>) => (field.category === 'string' || field.category === 'other' ? 'max-w-[24rem]' : field.category === 'number' || field.category === 'boolean' ? 'max-w-[12rem]' : 'max-w-[16rem]');

const DIRECTION_NAME = { asc: 'ascending', desc: 'descending' } as const;
const sortOf = (sorts: SortKey[], field: string) => { const d = sorts.find((s) => s.field === field)?.direction; return d ? DIRECTION_NAME[d] : 'none'; };

/** The column title as a button: none, ascending, descending, none. The arrow (and its precedence number) stays on screen while a sort is applied. */
function SortTitle({ field }: { field: Schema[number] }) {
  const { sorts, toggleSort } = useContext(GridEnv);
  const at = sorts.findIndex((s) => s.field === field.name);
  const current = at < 0 ? null : sorts[at]!.direction;
  const label = columnTitle(field);
  const Arrow = current === 'desc' ? ArrowDown : ArrowUp;
  const button = (
    <button type="button" onClick={() => toggleSort(field.name)} aria-label={`Sort by ${label}, currently ${current ? DIRECTION_NAME[current] : 'not sorted'}${current && sorts.length > 1 ? `, sort ${at + 1} of ${sorts.length}` : ''}`}
      className="dm-sort inline-flex min-w-0 items-center gap-1 font-medium">
      <span className="truncate">{label}</span>
      {current && <span className="dm-sort-mark inline-flex items-center"><Arrow className="size-3.5" aria-hidden />{sorts.length > 1 && <span className="text-[10px] tabular-nums">{at + 1}</span>}</span>}
    </button>
  );
  return <OverflowTip text={label} extra={field.joined ? undefined : fieldTitle(field)} measure={(el) => el.querySelector('.truncate')}>{button}</OverflowTip>;
}

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function Grid({ martId, model, schema: native, seed, initialColumns, initialSources, onChange, onRows }: { martId: string; initialColumns: string[]; initialSources: JoinedSource[] | null; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void }) {
  const { columnStore, blendable } = useServices();
  const slot = useContext(BandToolsSlot);
  // The joined marts are read when the Columns picker first opens (or when a saved column named one), never otherwise.
  const [sources, setSources] = useState<JoinedSource[]>(initialSources ?? []);
  const [joinedState, setJoinedState] = useState<JoinedState>(initialSources ? 'ready' : 'idle');
  const loadJoined = useCallback(() => {
    if (joinedState === 'ready' || joinedState === 'loading') return;
    setJoinedState('loading');
    blendable.get(martId).then((s) => { setSources(s); setJoinedState('ready'); }, () => setJoinedState('failed'));
  }, [blendable, martId, joinedState]);
  const schema = useMemo(() => withJoined(native, sources), [native, sources]);
  const [{ modelVersion }, dispatch] = useStore();
  // The columns, filters and page the reader left this mart with (a followed link has already written its filters there).
  const [visible, setVisible] = useState(initialColumns);
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() => seed.saved?.filters ?? {});
  // null: the member has set no sort, so rows open newest date first. The default is judged once, from the columns the grid opened with.
  const [own, setOwn] = useState<SortKey[] | null>(() => (seed.saved?.sorts ? (sortsOnColumns(seed.saved.sorts, visible).length || !seed.saved.sorts.length ? sortsOnColumns(seed.saved.sorts, visible) : null) : null));
  const [fallback] = useState(() => defaultSort(native, visible));
  const sorts = own ?? fallback;
  const [limit, setLimit] = useState(() => seed.saved?.limit ?? PAGE_SIZE);
  const [ownVersion, setVersion] = useState(0);
  // A model reload re-reads what is shown too: its counter joins the grid's own, and each only ever goes up.
  const version = ownVersion + modelVersion;
  // Re-seed the filters when a followed link asks for new ones on this same mart (adjust state during render).
  const [seededFrom, setSeededFrom] = useState(seed.filters);
  if (seededFrom !== seed.filters) {
    setSeededFrom(seed.filters);
    if (seed.filters) {
      setFilters(toFilterMap(seed.filters));
      setLimit(PAGE_SIZE);
    }
  }

  useEffect(() => { onChange({ columns: visible, filters, sorts: own, limit }); }, [visible, filters, own, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  const pks = primaryKeys(native);
  const query = useMemo(() => buildRowQuery(schema, visible, Object.values(filters), limit, sorts), [schema, visible, filters, sorts, limit]);
  const { rows, loading, error, hasMore } = useMartRows(martId, query, version);
  const columns = useMemo<GridColumn[]>(() => visible.filter((name) => schema.some((f) => f.name === name)).map((name) => {
    const field = schema.find((f) => f.name === name)!;
    return {
      id: name,
      header: () => (
        <div className="flex min-w-0 items-center gap-1">
          {field.joined && <span className="inline-flex shrink-0 text-muted-foreground"><PickedIcon icon={model.marts.get(field.joined.martId)?.icon} fallback={Box} size={14} /></span>}
          <SortTitle field={field} />
          <FilterPopover field={field} value={filters[name]} onChange={(f) => {
            setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; });
            setLimit(PAGE_SIZE);
          }} />
          {field.description?.trim() && (
            <Tooltip content={field.description}>
              <button type="button" aria-label={`About ${columnTitle(field)}`} className="dm-reveal dm-col-info">
                <Info className="size-3.5" />
              </button>
            </Tooltip>
          )}
        </div>
      ),
      cell: ({ row }) => <CellValue row={row.original} field={name} type={field.type} />,
    };
  }), [visible, schema, filters, model]);

  // While the member has no sort of their own, a click replaces the default with that column ascending (the
  // default's own column included), so a default never rides along as a second sort; after that the normal cycle.
  const toggleSort = useCallback((field: string) => { setOwn((cur) => (cur === null ? [{ field, direction: 'asc' }] : cycleSort(cur, field))); setLimit(PAGE_SIZE); }, []);
  const env = useMemo(() => ({ sorts, toggleSort }), [sorts, toggleSort]);
  // A hidden column's sort is dropped with it, so no ordering is left that the reader cannot see.
  const changeColumns = (cols: string[]) => { setVisible(cols); setOwn((cur) => { const kept = cur && sortsOnColumns(cur, cols); return cur && cur.length > 0 && kept!.length === 0 ? null : kept; }); columnStore.save(martId, cols); };
  const byName = useMemo(() => new Map(schema.map((f) => [f.name, f])), [schema]);
  const table = useTable({ features, data: rows ?? [], columns });
  const rowsLabel = rows ? `${rows.length}${hasMore ? '+' : ''}` : null;
  useEffect(() => { onRows?.(rowsLabel); }, [rowsLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasFilters = Object.keys(filters).length > 0;
  const hasSorts = own !== null;

  return (
    <GridEnv.Provider value={env}>
    <div className="flex max-h-[32rem] min-h-0 flex-col">
      <BandTools slot={slot}>
        <button type="button" disabled={!hasFilters && !hasSorts} onClick={() => { setFilters({}); setOwn(null); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => setVersion((v) => v + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ColumnPicker schema={native} sources={sources} joinedState={joinedState} visible={visible} model={model} onChange={changeColumns} onOpen={loadJoined} />
        <ExportMenu martId={martId} martTitle={model.marts.get(martId)?.title ?? martId} schema={schema} visible={visible} filters={Object.values(filters)} sorts={sorts} />
      </BandTools>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && <div role="progressbar" aria-label="Loading rows" className="dm-progress" />}
      <div className={`min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => <th key={h.id} aria-sort={sortOf(sorts, h.column.id)} className={`dm-th ${maxWidthOf(byName.get(h.column.id)!)} overflow-hidden border-b px-3 py-2 text-left font-medium`}>{flexRender(h.column.columnDef.header, h.getContext())}</th>)}
                {/* Takes the width the columns leave over, so the line under the header runs the whole card. */}
                <th aria-hidden className="w-full border-b p-0" />
              </tr>
            ))}
          </thead>
          <tbody>
            {error ? <tr><td colSpan={visible.length + 1} className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></td></tr>
              : !rows ? <tr><td colSpan={visible.length + 1}><Skeleton rows={8} /></td></tr>
              : rows.length === 0 ? <tr><td colSpan={visible.length + 1} className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</td></tr>
              : table.getRowModel().rows.map((r) => (
                <tr key={r.id}
                  onClick={pks.length ? () => dispatch({ type: 'openRecord', martId, sourceOf: sourceOfModel(model), pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
                  className={`border-b ${pks.length ? 'cursor-pointer hover:bg-accent' : ''}`}>
                  {r.getVisibleCells().map((c) => <td key={c.id} className={`${maxWidthOf(byName.get(c.column.id)!)} overflow-hidden whitespace-nowrap px-3 py-1.5`}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  <td aria-hidden className="p-0" />
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
