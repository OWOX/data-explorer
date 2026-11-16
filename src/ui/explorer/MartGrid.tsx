import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Box, Info, RefreshCw, RotateCcw, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import type { JoinedSource } from '../../api/blendable';
import { columnTitle, fieldLabel, fieldTitle } from '../../model/fieldLabel';
import type { ColumnFilter } from '../../filters/build';
import { cycleSort, defaultSort, sortsOnColumns, type SortKey } from '../../model/sort';
import { orderColumns } from '../../state/column-order';
import { joinedMartIds, ownNamesIn } from '../../state/join-plan';
import type { Model, Schema } from '../../model/types';
import { primaryKeys } from '../../records/relationships';
import type { Row } from '../../sdk/types';
import { sourceOfModel, useServices, useStore, type GridState } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Skeleton } from '../Skeleton';
import { OverflowTip, Tooltip } from '../Tooltip';
import { BandTools, BandToolsSlot } from '../bands/BandTools';
import { CardClickContext } from '../bands/CardClick';
import { PickedIcon } from '../bands/picked';
import { CellValue } from './CellValue';
import { ColumnPicker } from './ColumnPicker';
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
export function MartGrid({ martId, model, seed, onChange, onRows, paused = false }: { martId: string; model: Model; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void; /** The band is folded: nothing is read until it opens. */ paused?: boolean }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error } = useSchema(martId, schemaVersion);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <SeededGrid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onRows={onRows} paused={paused} />;
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
function SeededGrid(props: { martId: string; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void; paused: boolean }) {
  const { martId, schema, seed } = props;
  const { columnStore, blendable } = useServices();
  const [initial, setInitial] = useState<Initial | null>(() => {
    const cached = blendable.peek(martId);
    const full = withJoined(schema, cached ?? []);
    const kept = orderColumns(offered(full, seed.saved?.columns ?? []), cached ?? []);
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
      const kept = orderColumns(offered(withJoined(schema, sources ?? []), saved), sources ?? []);
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
  // Inside a data mart's group the group row names the mart, so the title is the field alone.
  const shown = fieldLabel(field);
  const Arrow = current === 'desc' ? ArrowDown : ArrowUp;
  const button = (
    <button type="button" onClick={() => toggleSort(field.name)} aria-label={`Sort by ${label}, currently ${current ? DIRECTION_NAME[current] : 'not sorted'}${current && sorts.length > 1 ? `, sort ${at + 1} of ${sorts.length}` : ''}`}
      className="dm-sort inline-flex min-w-0 items-center gap-1 font-medium">
      <span className="truncate">{shown}</span>
      {current && <span className="dm-sort-mark inline-flex items-center"><Arrow className="size-3.5" aria-hidden />{sorts.length > 1 && <span className="text-[10px] tabular-nums">{at + 1}</span>}</span>}
    </button>
  );
  return <OverflowTip text={shown} extra={field.joined ? undefined : fieldTitle(field)} measure={(el) => el.querySelector('.truncate')}>{button}</OverflowTip>;
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const stable = (g: GridState) => JSON.stringify([g.columns, Object.entries(g.filters).sort(([a], [b]) => a.localeCompare(b)), g.sorts, g.limit]);
const sameGrid = (a: GridState, b: GridState) => stable(a) === stable(b);

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function Grid({ martId, model, schema: native, seed, initialColumns, initialSources, onChange, onRows, paused }: { paused: boolean; martId: string; initialColumns: string[]; initialSources: JoinedSource[] | null; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null) => void }) {
  const { columnStore, blendable } = useServices();
  const slot = useContext(BandToolsSlot);
  // The joined marts are read when the mart becomes the main one (the page asks the same loader, so it is one read).
  const [sources, setSources] = useState<JoinedSource[]>(initialSources ?? []);
  useEffect(() => {
    if (initialSources) return;
    let live = true;
    blendable.get(martId).then((s) => { if (live) setSources(s); }, () => undefined);
    return () => { live = false; };
  }, [blendable, martId, initialSources]);
  const schema = useMemo(() => withJoined(native, sources), [native, sources]);
  const [{ modelVersion }, dispatch] = useStore();
  // The columns, filters and page the reader left this mart with (a followed link has already written its filters there).
  const [visible, setVisible] = useState(initialColumns);
  // A saved filter on a field this visit does not offer (a joined field whose marts could not be read) is not applied, and not
  // dropped from the kept copy either: it is parked, and written back with the live ones. It is not re-applied when the joined marts load later.
  const offeredNow = (name: string) => schema.some((f) => f.name === name);
  const [parked, setParked] = useState<Record<string, ColumnFilter>>(() => Object.fromEntries(Object.entries(seed.saved?.filters ?? {}).filter(([k]) => !offeredNow(k))));
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>(() => Object.fromEntries(Object.entries(seed.saved?.filters ?? {}).filter(([k]) => offeredNow(k))));
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
      setParked({});
      setLimit(PAGE_SIZE);
    }
  }

  // The page changes this grid too (a card click adds or takes out a joined mart's columns, Undo puts them back): what the store
  // holds is adopted when it is not what the grid already shows. The grid's own changes reach the store through the effect below.
  const [seenSaved, setSeenSaved] = useState(seed.saved);
  // Columns adopted from the page (Undo, Redo, a card click) are the member's columns now: they are saved like a picker change.
  const [adopted, setAdopted] = useState<string[] | null>(null);
  if (seed.saved !== seenSaved) {
    setSeenSaved(seed.saved);
    const saved = seed.saved;
    if (saved && saved.columns.length > 0 && !sameGrid(saved, { columns: visible, filters: { ...parked, ...filters }, sorts: own, limit })) {
      setVisible(saved.columns);
      if (!sameList(saved.columns, visible)) setAdopted(saved.columns);
      setFilters(Object.fromEntries(Object.entries(saved.filters).filter(([k]) => offeredNow(k))));
      setParked(Object.fromEntries(Object.entries(saved.filters).filter(([k]) => !offeredNow(k))));
      setOwn(saved.sorts);
      setLimit(saved.limit);
    }
  }

  useEffect(() => { if (adopted) columnStore.save(martId, adopted); }, [adopted, columnStore, martId]);

  useEffect(() => { onChange({ columns: visible, filters: { ...parked, ...filters }, sorts: own, limit }); }, [visible, filters, parked, own, limit]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every data mart's columns sit together: the main mart's own, then each joined mart's in the order it was added.
  const shown = useMemo(() => orderColumns(visible, sources), [visible, sources]);
  if (!sameList(shown, visible)) setVisible(shown);
  const pks = primaryKeys(native);
  const query = useMemo(() => buildRowQuery(schema, shown, Object.values(filters), limit, sorts), [schema, shown, filters, sorts, limit]);
  // A folded band reads nothing: the query it last read stays, and a change made meanwhile is read once it opens.
  const [asked, setAsked] = useState(query);
  if (!paused && asked !== query) setAsked(query);
  const { rows, loading, error, hasMore } = useMartRows(martId, asked, version);
  // The fields on screen, kept as the same array until one of them changes: a joined mart arriving later (the picker reads it
  // when it opens) must not rebuild the headers, which would close a filter popover the reader has open.
  const [onScreen, setOnScreen] = useState<Schema>([]);
  const wanted = shown.flatMap((name) => schema.find((f) => f.name === name) ?? []);
  if (wanted.length !== onScreen.length || wanted.some((f, i) => f !== onScreen[i])) setOnScreen(wanted);
  const columns = useMemo<GridColumn[]>(() => onScreen.map((field) => {
    const name = field.name;
    return {
      id: name,
      header: () => (
        <div className="flex min-w-0 items-center gap-1">
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
  }), [onScreen, filters]);

  // While the member has no sort of their own, a click replaces the default with that column ascending (the
  // default's own column included), so a default never rides along as a second sort; after that the normal cycle.
  const toggleSort = useCallback((field: string) => { setOwn((cur) => (cur === null ? [{ field, direction: 'asc' }] : cycleSort(cur, field))); setLimit(PAGE_SIZE); }, []);
  const env = useMemo(() => ({ sorts, toggleSort }), [sorts, toggleSort]);
  // A hidden column's sort is dropped with it, so no ordering is left that the reader cannot see.
  const changeColumns = (picked: string[]) => {
    const cols = orderColumns(picked, sources);
    setVisible(cols);
    setOwn((cur) => { const kept = cur && sortsOnColumns(cur, cols); return cur && cur.length > 0 && kept!.length === 0 ? null : kept; });
    // A joined mart whose last field was unticked is remembered as empty: it comes back with its first text field.
    const left = joinedMartIds(visible, sources).filter((m) => !joinedMartIds(cols, sources).includes(m));
    columnStore.save(martId, cols, left.length ? Object.fromEntries(left.map((m) => [m, [] as string[]])) : undefined);
    // A joined mart that has just left remembers what it was showing, as its own field names.
    for (const m of left) columnStore.saveLastShown(m, ownNamesIn(visible, sources, m));
  };
  const byName = useMemo(() => new Map(schema.map((f) => [f.name, f])), [schema]);
  const table = useTable({ features, data: rows ?? [], columns });
  const rowsLabel = rows ? `${rows.length}${hasMore ? '+' : ''}` : null;
  useEffect(() => { onRows?.(rowsLabel); }, [rowsLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardClick = useContext(CardClickContext);
  // One cell per data mart over its columns, main first; only when a joined mart is on screen.
  const groups = useMemo(() => {
    const out: { id: string; title: string; icon: string | null | undefined; span: number; main: boolean }[] = [];
    for (const f of onScreen) {
      const id = f.joined?.martId ?? martId;
      const last = out[out.length - 1];
      if (last && last.id === id) last.span += 1;
      else out.push({ id, title: model.marts.get(id)?.title ?? f.joined?.label ?? id, icon: model.marts.get(id)?.icon, span: 1, main: id === martId });
    }
    return out;
  }, [onScreen, model, martId]);
  const several = groups.length > 1;
  // The first data mart is the main one: its last own column stays while a joined mart is shown.
  const ownNames = useMemo(() => new Set(native.map((f) => f.name)), [native]);
  const ownOn = shown.filter((n) => ownNames.has(n)).length;
  const fieldsOf = (id: string) => (id === martId ? native : sources.filter((x) => x.martId === id).flatMap((x) => x.fields));
  // The first column of every group after the first carries a divider.
  const edges = useMemo(() => { const out = new Set<string>(); let at = 0; groups.forEach((g, i) => { if (i > 0) out.add(onScreen[at]!.name); at += g.span; }); return out; }, [groups, onScreen]);
  const hasFilters = Object.keys(filters).length > 0;
  const hasSorts = own !== null;

  return (
    <GridEnv.Provider value={env}>
    <div className="flex max-h-[32rem] min-h-0 flex-col">
      <BandTools slot={slot}>
        <button type="button" disabled={!hasFilters && !hasSorts} onClick={() => { setFilters({}); setParked({}); setOwn(null); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => setVersion((v) => v + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ExportMenu martId={martId} martTitle={model.marts.get(martId)?.title ?? martId} schema={schema} visible={shown} filters={Object.values(filters)} sorts={sorts} rows={rows} hasMore={hasMore} />
      </BandTools>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && <div role="progressbar" aria-label="Loading rows" className="dm-progress" />}
      <div className={`min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="w-full border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-card">
            <tr data-group-row>
                {groups.map((g, i) => (
                  <th key={g.id} colSpan={g.span} scope="colgroup" className={`dm-gh overflow-hidden px-3 pb-0.5 pt-2 text-left text-xs font-semibold ${i > 0 ? 'dm-gh-edge' : ''}`}>
                    <div className="flex min-w-0 items-center gap-1.5">
                      <span className="inline-flex shrink-0 text-muted-foreground"><PickedIcon icon={g.icon} fallback={Box} size={14} /></span>
                      <span className="truncate">{g.title}</span>
                      <ColumnPicker title={g.title} fields={fieldsOf(g.id)} main={g.main} visible={shown} locked={(n) => g.main && several && ownOn === 1 && ownNames.has(n)} onChange={changeColumns} />
                      {(several || !g.main) && (
                        <Tooltip content={`Remove ${g.title} from the grid`}>
                          <button type="button" aria-label={`Remove ${g.title} from the grid`} onClick={() => void cardClick(g.id)} className="dm-reveal dm-gx"><X className="size-3.5" aria-hidden /></button>
                        </Tooltip>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => <th key={h.id} aria-sort={sortOf(sorts, h.column.id)} className={`dm-th ${edges.has(h.column.id) ? 'dm-th-edge' : ''} ${maxWidthOf(byName.get(h.column.id)!)} overflow-hidden px-3 py-2 text-left font-medium`}>{flexRender(h.column.columnDef.header, h.getContext())}</th>)}
                {/* Takes the width the columns leave over, so the line under the header runs the whole card. */}
                <th aria-hidden className="dm-th w-full p-0" />
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
