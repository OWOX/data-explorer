import { columnVisibilityFeature, flexRender, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { ArrowDown, ArrowUp, Box, Info, RefreshCw, RotateCcw, X } from 'lucide-react';
import { askFocusFor, dropFocusFor, isFocusAskedFor, takeFocusFor } from './pending-focus';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import { columnLetter } from './columnLetters';
import { isNumericType } from '../format';
import { withJoined, type JoinedSource } from '../../api/blendable';
import { AGG_LABELS, applyDraft, draftOf, formatBucket, isGrouped, keepVisible, NO_AGGREGATION, outputsOf, sanitizeAggregation, ungroupableColumn, type AggFn, type Aggregation, type AggregationDraft, type Output } from '../../model/aggregation';
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
import { AggregationPopover } from './AggregationPopover';
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
export function MartGrid({ martId, model, seed, onChange, onRows, paused = false }: { martId: string; model: Model; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null, grouped?: boolean, noKey?: boolean) => void; /** The band is folded: nothing is read until it opens. */ paused?: boolean }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error } = useSchema(martId, schemaVersion);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <SeededGrid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onRows={onRows} paused={paused} />;
}

/** A saved-columns read slower than this is given up on for this mount. */
export const SAVED_COLUMNS_WAIT_MS = 3000;

/** The names in `saved` the column picker still offers, in the saved order. */
const offered = (schema: Schema, saved: string[]) => saved.filter((c) => schema.some((f) => f.name === c));

/** Whether a saved grid names something the mart's own schema does not have: a joined field, so the joined marts must be read first. */
const namesJoined = (schema: Schema, saved: GridState | undefined) =>
  !!saved && [...saved.columns, ...Object.keys(saved.filters), ...(saved.sorts ?? []).map((x) => x.field)].some((n) => !schema.some((f) => f.name === n));

type Initial = { columns: string[]; cleaned: string[] | null; sources: JoinedSource[] | null; agg: Aggregation };

const aggOf = (g: GridState | undefined): Aggregation => (g && (g.aggregations?.length || g.dateTrunc?.length) ? { aggregations: g.aggregations ?? [], dateTrunc: g.dateTrunc ?? [] } : NO_AGGREGATION);

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
    const kept = orderColumns(offered(full, seed.saved?.columns ?? []), cached ?? [], defaultColumns(schema));
    // A session list that names a joined field waits for the joined marts unless they are already known.
    return kept.length && (cached || !namesJoined(schema, seed.saved)) ? { columns: kept, cleaned: null, sources: cached ?? null, agg: sanitizeAggregation(seed.saved ? aggOf(seed.saved) : columnStore.aggregation(martId), full) } : null;
  });
  useEffect(() => {
    if (initial) return;
    let live = true;
    const timer = setTimeout(() => { live = false; setInitial({ columns: defaultColumns(schema), cleaned: null, sources: null, agg: sanitizeAggregation(seed.saved ? aggOf(seed.saved) : NO_AGGREGATION, schema) }); }, SAVED_COLUMNS_WAIT_MS);
    (async () => {
      const own = seed.saved?.columns;
      const saved = own ?? await columnStore.load(martId) ?? [];
      const needs = namesJoined(schema, own ? seed.saved : { columns: saved, filters: seed.saved?.filters ?? {}, sorts: seed.saved?.sorts ?? null, limit: 0 });
      const agg = seed.saved ? aggOf(seed.saved) : await columnStore.loadAggregation(martId);
      let sources: JoinedSource[] | null = blendable.peek(martId) ?? null;
      let failed = false;
      if (needs && !sources) {
        try { sources = await blendable.get(martId); } catch { failed = true; }
      }
      if (!live) return;
      clearTimeout(timer);
      const there = offered(withJoined(schema, sources ?? []), saved);
      const kept = orderColumns(there, sources ?? [], defaultColumns(schema));
      // Names a failed read could not check are left in what is saved; only names the schema really lacks are cleaned out,
      // and a list that was not grouped by data mart is saved grouped.
      const dropped = !failed && saved.length > there.length;
      const regrouped = !failed && kept.length > 0 && kept.some((c, i) => c !== there[i]);
      // A session or link list is not a saved one: only a list read from the store is cleaned back into it.
      setInitial({ columns: kept.length ? kept : defaultColumns(schema), cleaned: (dropped || regrouped) && !own ? kept : null, sources, agg: sanitizeAggregation(keepVisible(agg, kept), withJoined(schema, sources ?? [])) });
    })();
    return () => { live = false; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cleaned = initial?.cleaned ?? null;
  // The cleanup of a saved list that named columns that are gone is the one save that is not the member's own change.
  useEffect(() => { if (cleaned) columnStore.save(martId, cleaned); }, [cleaned, columnStore, martId]);
  if (!initial) return <Skeleton rows={8} />;
  return <Grid {...props} initialColumns={initial.columns} initialSources={initial.sources} initialAgg={initial.agg} />;
}

// TanStack Table v9: row.getVisibleCells() needs the column visibility feature.
const features = tableFeatures({ columnVisibilityFeature });
type GridColumn = ColumnDef<typeof features, Row>;

// The sorts reach the header cells through context so they keep their identity when a sort changes:
// a new header component would remount and close an open filter popover.
const GridEnv = createContext<{ sorts: SortKey[]; toggleSort: (field: string) => void }>({ sorts: [], toggleSort: () => undefined });

/** How wide a column may grow before its text is clipped: free text is allowed the most room. */
const maxWidthOf = (field: Pick<Schema[number], 'category'>) => (field.category === 'string' || field.category === 'other' ? 'max-w-[24rem]' : field.category === 'number' || field.category === 'boolean' ? 'max-w-[12rem]' : 'max-w-[16rem]');

/** The blank row-number cell of a row that is not a data row (a message, the loading skeleton). */
const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;

const DIRECTION_NAME = { asc: 'ascending', desc: 'descending' } as const;
/** A grouped value of a date bucket: the bucket start, shown by the bucket. */
function BucketValue({ value, unit }: { value: unknown; unit: Output['bucket'] & string }) {
  const text = formatBucket(value, unit);
  return <span className="block truncate" title={value === null || value === undefined ? undefined : String(value)}>{text ?? ''}</span>;
}

const sortOf = (sorts: SortKey[], field: string) => { const d = sorts.find((s) => s.field === field)?.direction; return d ? DIRECTION_NAME[d] : 'none'; };

/** What a grouped output is headed: the field, then the function ("Amount · Sum"). */
const outputLabel = (field: Schema[number], o: Output) => (o.fn ? `${columnTitle(field)} · ${AGG_LABELS[o.fn]}` : columnTitle(field));

/** The column title as a button: none, ascending, descending, none. The arrow (and its precedence number) stays on screen while a sort is applied.
 * An extra function of an aggregated column has no sort (the backend sorts an aggregated column by its first function). */
function SortTitle({ field, output }: { field: Schema[number]; output: Output }) {
  const { sorts, toggleSort } = useContext(GridEnv);
  const at = sorts.findIndex((s) => s.field === field.name);
  const current = at < 0 ? null : sorts[at]!.direction;
  const label = outputLabel(field, output);
  // Inside a data mart's group the group row names the mart, so the title is the field alone.
  const shown = output.fn ? `${fieldLabel(field)} · ${AGG_LABELS[output.fn]}` : fieldLabel(field);
  if (!output.sortable) return <OverflowTip text={label} measure={(el) => el.querySelector('.truncate')}><span className="inline-flex min-w-0 items-center font-medium"><span className="truncate">{shown}</span></span></OverflowTip>;
  const button = (
    <button type="button" onClick={() => toggleSort(field.name)} aria-label={`Sort by ${label}, currently ${current ? DIRECTION_NAME[current] : 'not sorted'}${current && sorts.length > 1 ? `, sort ${at + 1} of ${sorts.length}` : ''}`}
      className="dm-sort inline-flex min-w-0 items-center gap-1 font-medium">
      <span className="truncate">{shown}</span>
    </button>
  );
  return <OverflowTip text={label} extra={field.joined || output.fn ? undefined : fieldTitle(field)} measure={(el) => el.querySelector('.truncate')}>{button}</OverflowTip>;
}

/** Sheets' sort control at the right end of the header: a green arrow on hover, a green square with a white arrow (and its precedence number) while sorted.
 * Decorative for assistive tech: the title button above it carries the name and the keyboard. */
function SortMark({ field, output }: { field: Schema[number]; output: Output }) {
  const { sorts, toggleSort } = useContext(GridEnv);
  if (!output.sortable) return null;
  const at = sorts.findIndex((s) => s.field === field.name);
  const current = at < 0 ? null : sorts[at]!.direction;
  const Arrow = current === 'desc' ? ArrowDown : ArrowUp;
  return (
    <span aria-hidden data-sort-mark onClick={() => toggleSort(field.name)} className={current ? 'dm-ctl dm-ctl-on dm-reveal-on cursor-pointer' : 'dm-ctl dm-reveal cursor-pointer'}>
      <Arrow className="dm-icon" />{current && sorts.length > 1 && <span className="text-[9px] leading-none tabular-nums">{at + 1}</span>}
    </span>
  );
}

/** The type an aggregated output has: a count is a whole number, an average or percentile a decimal, Combined text; the rest keep the field's. */
const outputType = (field: Schema[number], fn: AggFn | undefined): string => {
  if (fn === 'COUNT' || fn === 'COUNT_DISTINCT') return 'INTEGER';
  if (fn === 'STRING_AGG') return 'STRING';
  if (fn === 'AVG' || fn === 'P25' || fn === 'P50' || fn === 'P75' || fn === 'P95') return 'FLOAT';
  return field.type;
};

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const stable = (g: GridState) => JSON.stringify([g.columns, Object.entries(g.filters).sort(([a], [b]) => a.localeCompare(b)), g.sorts, g.limit, g.aggregations ?? [], g.dateTrunc ?? []]);
const sameGrid = (a: GridState, b: GridState) => stable(a) === stable(b);

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function Grid({ martId, model, schema: native, seed, initialColumns, initialSources, initialAgg, onChange, onRows, paused }: { paused: boolean; martId: string; initialColumns: string[]; initialAgg: Aggregation; initialSources: JoinedSource[] | null; model: Model; schema: Schema; seed: GridSeed; onChange: (state: GridState) => void; onRows?: (label: string | null, grouped?: boolean, noKey?: boolean) => void }) {
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
  // The functions and date buckets on columns: any of them groups the rows.
  const [agg, setAgg] = useState<Aggregation>(initialAgg);
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
    if (saved && saved.columns.length > 0 && !sameGrid(saved, { columns: visible, filters: { ...parked, ...filters }, sorts: own, limit, aggregations: agg.aggregations, dateTrunc: agg.dateTrunc })) {
      setVisible(saved.columns);
      setAgg(aggOf(saved));
      if (!sameList(saved.columns, visible)) setAdopted(saved.columns);
      setFilters(Object.fromEntries(Object.entries(saved.filters).filter(([k]) => offeredNow(k))));
      setParked(Object.fromEntries(Object.entries(saved.filters).filter(([k]) => !offeredNow(k))));
      setOwn(saved.sorts);
      setLimit(saved.limit);
    }
  }

  useEffect(() => { if (adopted) { columnStore.save(martId, adopted); columnStore.saveAggregation(martId, agg); } }, [adopted, columnStore, martId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { onChange({ columns: visible, filters: { ...parked, ...filters }, sorts: own, limit, ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}) }); }, [visible, filters, parked, own, limit, agg]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every data mart's columns sit together: the main mart's own, then each joined mart's in the order it was added.
  const shown = useMemo(() => orderColumns(visible, sources, defaultColumns(native)), [visible, sources, native]);
  if (!sameList(shown, visible)) setVisible(shown);
  // Rules of a column that is no longer shown go with it; any function or bucket left groups the rows (no default order then: it may name nothing shown).
  const aggNow = useMemo(() => sanitizeAggregation(keepVisible(agg, shown), schema), [agg, shown, schema]);
  const grouped = isGrouped(aggNow);
  // Grouped with no sort of the member's own: the first group key ascending, so "Load more" pages never reshuffle.
  const firstKey = shown.find((n) => !aggNow.aggregations.some((r) => r.column === n));
  const gridSorts = useMemo<SortKey[]>(() => (grouped ? (own?.length ? own : firstKey ? [{ field: firstKey, direction: 'asc' }] : []) : sorts), [grouped, own, sorts, firstKey]);
  const pks = primaryKeys(native);
  const wanted = shown.flatMap((name) => schema.find((f) => f.name === name) ?? []);
  // A shown array, JSON or struct column with no rule would be a GROUP BY key the warehouse or the backend refuses: no grouped query goes out until it is hidden.
  const blocked = ungroupableColumn(wanted, aggNow);
  const query = useMemo(() => buildRowQuery(schema, shown, Object.values(filters), limit, gridSorts, aggNow), [schema, shown, filters, gridSorts, limit, aggNow]);
  // A folded band reads nothing: the query it last read stays, and a change made meanwhile is read once it opens.
  const [asked, setAsked] = useState(query);
  if (!paused && !blocked && asked !== query) setAsked(query);
  const { rows: read, loading: reading, error, hasMore } = useMartRows(martId, asked, version);
  const rows = blocked ? null : read;
  const loading = reading && !blocked;
  // The fields on screen, kept as the same array until one of them changes: a joined mart arriving later (the picker reads it
  // when it opens) must not rebuild the headers, which would close a filter popover the reader has open.
  const [onScreen, setOnScreen] = useState<Schema>([]);
  if (wanted.length !== onScreen.length || wanted.some((f, i) => f !== onScreen[i])) setOnScreen(wanted);
  const byName = useMemo(() => new Map(schema.map((f) => [f.name, f])), [schema]);
  // One output per column, or one per function of an aggregated column.
  const outputs = useMemo(() => outputsOf(onScreen.map((f) => f.name), aggNow), [onScreen, aggNow]);
  // From the fields on screen, not the whole schema: a joined mart arriving later must not rebuild the headers (it would close an open popover).
  const shownByName = useMemo(() => new Map(onScreen.map((f) => [f.name, f])), [onScreen]);
  const outputByKey = useMemo(() => new Map(outputs.map((o) => [o.key, o])), [outputs]);
  const changeAgg = useCallback((column: string, draft: AggregationDraft) => {
    const next = applyDraft(column, draft, agg);
    setAgg(next);
    columnStore.saveAggregation(martId, next);
    setLimit(PAGE_SIZE);
  }, [agg, columnStore, martId]);
  // Shown columns that cannot take part in a grouped query: another column's Apply would group the rows and strand them.
  const blockers = useMemo(() => onScreen.filter((f) => f.category === 'other').map((f) => ({ name: f.name, title: columnTitle(f) })), [onScreen]);
  const columns = useMemo<GridColumn[]>(() => outputs.map((o) => {
    const field = shownByName.get(o.column)!;
    const name = field.name;
    // The filter, the info and the aggregation belong to the column: they sit on its first output only.
    const lead = outputs.find((x) => x.column === o.column) === o;
    const aggregated = aggNow.aggregations.some((r) => r.column === o.column) || aggNow.dateTrunc.some((r) => r.column === o.column);
    return {
      id: o.key,
      header: () => (
        <div className="dm-hdr">
          <SortTitle field={field} output={o} />
          {lead && field.description?.trim() && (
            <Tooltip content={field.description}>
              <button type="button" aria-label={`About ${columnTitle(field)}`} className="dm-reveal dm-col-info">
                <Info className="dm-icon" />
              </button>
            </Tooltip>
          )}
          <span aria-hidden className="dm-hdr-spacer" />
          <span className="dm-hdr-controls">
            {lead && (
              <FilterPopover field={field} aggregated={aggregated} value={filters[name]} onChange={(f) => {
                setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; });
                setLimit(PAGE_SIZE);
              }} />
            )}
            {lead && <AggregationPopover field={field} value={draftOf(o.column, aggNow)} blocker={blockers.find((b) => b.name !== field.name)?.title} onApply={(d) => changeAgg(o.column, d)} />}
            <SortMark field={field} output={o} />
          </span>
        </div>
      ),
      cell: ({ row }) => (o.bucket
        ? <BucketValue value={row.original[o.key]} unit={o.bucket} />
        : <CellValue row={row.original} field={o.key} type={outputType(field, o.fn)} />),
    };
  }), [outputs, shownByName, filters, aggNow, changeAgg, blockers]);

  // While the member has no sort of their own, a click replaces the default with that column ascending (the
  // default's own column included), so a default never rides along as a second sort; after that the normal cycle.
  const toggleSort = useCallback((field: string) => { setOwn((cur) => (cur === null ? [{ field, direction: 'asc' }] : cycleSort(cur, field))); setLimit(PAGE_SIZE); }, []);
  // The implicit first-key sort is sent and exported but not shown: no arrow, no aria-sort, so the first click is not a no-op.
  const shownSorts = useMemo(() => (grouped ? (own ?? []) : gridSorts), [grouped, own, gridSorts]);
  const env = useMemo(() => ({ sorts: shownSorts, toggleSort }), [shownSorts, toggleSort]);
  // A hidden column's sort is dropped with it, so no ordering is left that the reader cannot see.
  const changeColumns = (picked: string[]) => {
    const cols = orderColumns(picked, sources, defaultColumns(native));
    setVisible(cols);
    const nextAgg = keepVisible(agg, cols);
    if (nextAgg !== agg) { setAgg(nextAgg); columnStore.saveAggregation(martId, nextAgg); }
    setOwn((cur) => { const kept = cur && sortsOnColumns(cur, cols); return cur && cur.length > 0 && kept!.length === 0 ? null : kept; });
    // A joined mart whose last field was unticked is remembered as empty: it comes back with its first text field.
    const left = joinedMartIds(visible, sources).filter((m) => !joinedMartIds(cols, sources).includes(m));
    columnStore.save(martId, cols, left.length ? Object.fromEntries(left.map((m) => [m, [] as string[]])) : undefined);
    // A joined mart that has just left remembers what it was showing, as its own field names.
    for (const m of left) columnStore.saveLastShown(m, ownNamesIn(visible, sources, m));
  };
  const table = useTable({ features, data: rows ?? [], columns });
  const rowsLabel = rows ? `${rows.length}${hasMore ? '+' : ''}` : null;
  // The Data band's title row shows the no-primary-key warning, so it is told whether this grid is a plain preview.
  const noKey = pks.length === 0 && !grouped;
  useEffect(() => { onRows?.(rowsLabel, grouped, noKey); }, [rowsLabel, grouped, noKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardClick = useContext(CardClickContext);
  // One cell per data mart over its columns, main first; only when a joined mart is on screen.
  const groups = useMemo(() => {
    const out: { id: string; title: string; icon: string | null | undefined; span: number; main: boolean }[] = [];
    for (const o of outputs) {
      const f = byName.get(o.column)!;
      const id = f.joined?.martId ?? martId;
      const last = out[out.length - 1];
      if (last && last.id === id) last.span += 1;
      else out.push({ id, title: model.marts.get(id)?.title ?? f.joined?.label ?? id, icon: model.marts.get(id)?.icon, span: 1, main: id === martId });
    }
    return out;
  }, [outputs, byName, model, martId]);
  // A remove button is off while its click is being applied, so a second click cannot put the mart back.
  const [removing, setRemoving] = useState(false);
  const head = useRef<HTMLTableSectionElement>(null);
  const remove = (id: string, index: number) => {
    // Focus lands on the neighbouring tab's remove button (else its Columns button) once the tab is gone.
    const next = groups[index + 1]?.id ?? groups[index - 1]?.id;
    // Taking the main tab away promotes the next one and the grid remounts (DataBand keys it by mart): the new grid focuses its Columns button.
    const promoted = id === martId && groups[1] ? groups[1].id : null;
    askFocusFor(promoted);
    setRemoving(true);
    cardClick(id, { only: 'deselect' }).catch(() => undefined).finally(() => {
      setRemoving(false);
      // Nothing remounted (the click did nothing): the request must not wait for a later mount.
      if (promoted) setTimeout(() => dropFocusFor(promoted), 1000);
      setTimeout(() => {
        const th = next ? head.current?.querySelector(`th[data-group="${CSS.escape(next)}"]`) : null;
        (th?.querySelector<HTMLElement>('button[data-remove]:not(:disabled)') ?? th?.querySelector<HTMLElement>('button'))?.focus();
      }, 0);
    });
  };
  useEffect(() => {
    if (!isFocusAskedFor(martId)) return;
    const button = head.current?.querySelector<HTMLElement>(`th[data-group="${CSS.escape(martId)}"] button`);
    if (button && takeFocusFor(martId)) button.focus();
  }, [groups, martId]);
  const several = groups.length > 1;
  // The first data mart is the main one: its last own column stays while a joined mart is shown.
  const ownNames = useMemo(() => new Set(native.map((f) => f.name)), [native]);
  const ownOn = shown.filter((n) => ownNames.has(n)).length;
  const fieldsOf = (id: string) => (id === martId ? native : sources.filter((x) => x.martId === id).flatMap((x) => x.fields));
  const hasFilters = Object.keys(filters).length > 0;
  const hasSorts = own !== null;
  // The selection, as Google Sheets has it: a cell (a frame and a fill handle), or whole columns or rows (a tint and a frame
  // around the block); its column letters and row numbers are lit. `from` is where a shift-click extends from.
  type Selection = { kind: 'cell'; row: number; col: number } | { kind: 'col' | 'row'; from: number; to: number };
  const [selected, setSelected] = useState<Selection | null>(null);
  const rowCount = rows?.length ?? 0;
  const sel = selected && (selected.kind === 'cell' ? selected.row < rowCount && selected.col < outputs.length : selected.kind === 'col' ? Math.max(selected.from, selected.to) < outputs.length && rowCount > 0 : Math.max(selected.from, selected.to) < rowCount) ? selected : null;
  const cellSel = sel?.kind === 'cell' ? sel : null;
  const span = sel && sel.kind !== 'cell' ? { kind: sel.kind, lo: Math.min(sel.from, sel.to), hi: Math.max(sel.from, sel.to) } : null;
  const inCols = (i: number) => (cellSel ? cellSel.col === i : span?.kind === 'col' ? i >= span.lo && i <= span.hi : false);
  const inRows = (i: number) => (cellSel ? cellSel.row === i : span?.kind === 'row' ? i >= span.lo && i <= span.hi : false);
  // A header is lit light when a cell (or a block crossing it) is selected, and strong when it is itself fully selected.
  const colMark = (i: number) => (span?.kind === 'col' ? (inCols(i) ? 'full' : undefined) : span?.kind === 'row' ? '' : inCols(i) ? '' : undefined);
  const rowMark = (i: number) => (span?.kind === 'row' ? (inRows(i) ? 'full' : undefined) : span?.kind === 'col' ? '' : inRows(i) ? '' : undefined);
  // In a block, as in Sheets: the active cell is where the selection started (the clicked column's first row, or the clicked
  // row's first column) and gets the 2px frame; the fill handle sits at the block's far corner.
  const anchor = sel && sel.kind !== 'cell' ? (sel.kind === 'col' ? { row: 0, col: sel.from } : { row: sel.from, col: 0 }) : null;
  const corner = span ? (span.kind === 'col' ? { row: rowCount - 1, col: span.hi } : { row: span.hi, col: outputs.length - 1 }) : null;
  // Numbers sit on the right of their cells, as in Sheets (a bucketed date or a Combined list is not a number).
  const numericOutput = (key: string) => { const o = outputByKey.get(key); const f = o && byName.get(o.column); return !!o && !!f && !o.bucket && isNumericType(outputType(f, o.fn)); };
  const inBlock = (ri: number, ci: number) => (span?.kind === 'col' ? inCols(ci) : span?.kind === 'row' ? inRows(ri) : false);
  // Which sides of a cell lie on the block's outer edge, where the 2px frame is drawn.
  const edges = (ri: number, ci: number) => {
    if (!span || !inBlock(ri, ci)) return undefined;
    const out: string[] = [];
    if (span.kind === 'col') { if (ci === span.lo) out.push('l'); if (ci === span.hi) out.push('r'); if (ri === 0) out.push('t'); if (ri === rowCount - 1) out.push('b'); }
    else { if (ri === span.lo) out.push('t'); if (ri === span.hi) out.push('b'); if (ci === 0) out.push('l'); if (ci === outputs.length - 1) out.push('r'); }
    return out.join(' ');
  };
  const pickHeader = (kind: 'col' | 'row', i: number, extend: boolean) => setSelected((cur) => (extend && cur && cur.kind === kind ? { kind, from: cur.from, to: i } : { kind, from: i, to: i }));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const box = scroller.current;
    const cell = box?.querySelector<HTMLElement>('td[data-selected]');
    if (!box || !cell) return;
    // The sticky header and number column cover the box's edges: the cell is kept clear of them.
    box.style.scrollPaddingTop = `${head.current?.offsetHeight ?? 0}px`;
    box.style.scrollPaddingLeft = '46px';
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [cellSel?.row, cellSel?.col]);
  const onGridKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    // Popovers render outside the grid but their events bubble here; fields and the header keep their own keys.
    if (!e.currentTarget.contains(target) || target.closest('thead, input, textarea, select') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Escape') { if (sel) { e.preventDefault(); setSelected(null); } return; }
    const step = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key];
    if (!step || rowCount === 0 || outputs.length === 0) return;
    // Keys on a button or link inside a cell are theirs; the grid itself and a cell move the selection.
    if (target !== e.currentTarget && target.closest('button, a, [role=button]')) return;
    e.preventDefault();
    // From a whole column or row the keys land on a single cell: the first one of the block's last column or row.
    const at = !sel ? null : sel.kind === 'cell' ? sel : sel.kind === 'col' ? { row: 0, col: sel.to } : { row: sel.to, col: 0 };
    const to = at ?? { row: 0, col: 0 };
    setSelected({ kind: 'cell', row: at ? Math.min(rowCount - 1, Math.max(0, to.row + step[0]!)) : to.row, col: at ? Math.min(outputs.length - 1, Math.max(0, to.col + step[1]!)) : to.col });
  };

  return (
    <GridEnv.Provider value={env}>
    <div className="flex max-h-[32rem] min-h-0 flex-col">
      <BandTools slot={slot}>
        <button type="button" disabled={!hasFilters && !hasSorts} onClick={() => { setFilters({}); setParked({}); setOwn(null); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => setVersion((v) => v + 1)} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        {!blocked && <ExportMenu martId={martId} martTitle={model.marts.get(martId)?.title ?? martId} schema={schema} visible={shown} aggregation={aggNow} filters={Object.values(filters)} sorts={gridSorts} rows={rows} hasMore={hasMore} loading={loading} />}
      </BandTools>
      {loading && <div role="progressbar" aria-label="Loading rows" className="dm-progress" />}
      <div ref={scroller} tabIndex={0} onKeyDown={onGridKey} className={`dm-grid-root min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="dm-grid w-full border-collapse">
          <thead ref={head} className="dm-head sticky top-0 z-10">
            <tr aria-hidden data-chrome>
              <th data-chrome rowSpan={3} className="dm-chrome dm-corner" />
              {outputs.map((o, i) => <th key={o.key} data-chrome data-selected={colMark(i)} onClick={(e) => pickHeader('col', i, e.shiftKey)} className="dm-chrome dm-letter">{columnLetter(i)}</th>)}
              <th data-chrome className="dm-chrome dm-letter w-full" />
            </tr>
            <tr data-group-row>
                {groups.map((g, i) => (
                  <th key={g.id} data-group={g.id} colSpan={g.span} scope="colgroup" className="dm-gh dm-gh-edge overflow-hidden px-1 py-1 text-left font-semibold">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="inline-flex shrink-0 text-muted-foreground"><PickedIcon icon={g.icon} fallback={Box} size={14} /></span>
                      <span className="truncate">{g.title}</span>
                      <ColumnPicker title={g.title} fields={fieldsOf(g.id)} main={g.main} visible={shown} locked={(n) => g.main && several && ownOn === 1 && ownNames.has(n)} onChange={changeColumns} />
                      {(several || !g.main) && (
                        <Tooltip content={`Remove ${g.title} from the grid`}>
                          <button type="button" aria-label={`Remove ${g.title} from the grid`} data-remove disabled={removing} onClick={() => remove(g.id, i)} className="dm-reveal dm-gx"><X className="size-3.5" aria-hidden /></button>
                        </Tooltip>
                      )}
                    </div>
                  </th>
                ))}
                {/* Carries the line under the tabs to the card's edge. */}
                <th aria-hidden className="dm-gh-fill w-full p-0" />
              </tr>
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => <th key={h.id} aria-sort={outputByKey.get(h.column.id)?.sortable ? sortOf(shownSorts, outputByKey.get(h.column.id)!.column) : 'none'} className={`dm-th ${maxWidthOf(byName.get(outputByKey.get(h.column.id)!.column)!)} overflow-hidden text-left font-medium`}>{flexRender(h.column.columnDef.header, h.getContext())}</th>)}
                {/* Takes the width the columns leave over, so the line under the header runs the whole card. */}
                <th aria-hidden className="dm-th dm-th-fill w-full p-0" />
              </tr>
            ))}
          </thead>
          <tbody>
            {blocked ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4 text-sm text-muted-foreground" role="alert">{`"${columnTitle(blocked)}" can't be grouped: hide it. Array, JSON and struct fields take no aggregation.`}</td></tr>
              : error ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></td></tr>
              : !rows ? <tr><Gutter /><td colSpan={outputs.length + 1}><Skeleton rows={8} /></td></tr>
              : rows.length === 0 ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</td></tr>
              : table.getRowModel().rows.map((r, ri) => (
                <tr key={r.id}
                  onClick={pks.length && !grouped ? () => dispatch({ type: 'openRecord', martId, sourceOf: sourceOfModel(model), pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
                  className={`${pks.length && !grouped ? 'cursor-pointer' : ''}`}>
                  <th aria-hidden data-chrome data-selected={rowMark(ri)} onClick={(e) => { pickHeader('row', ri, e.shiftKey); if (e.shiftKey) e.stopPropagation(); }} className="dm-chrome">{ri + 1}</th>
                  {r.getVisibleCells().map((c, ci) => <td key={c.id} data-selected={cellSel?.row === ri && cellSel.col === ci ? '' : undefined} data-range={inBlock(ri, ci) ? '' : undefined} data-active={anchor?.row === ri && anchor.col === ci ? '' : undefined} data-handle={corner?.row === ri && corner.col === ci ? '' : undefined} data-edge={edges(ri, ci)} onClick={() => setSelected({ kind: 'cell', row: ri, col: ci })} className={`${maxWidthOf(byName.get(outputByKey.get(c.column.id)!.column)!)} overflow-hidden whitespace-nowrap${numericOutput(c.column.id) ? ' text-right' : ''}`}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  <td aria-hidden className="p-0" />
                </tr>
              ))}
          </tbody>
        </table>
        {!error && !blocked && hasMore && <div className="p-3 text-center"><button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Load more</button></div>}
      </div>
    </div>
    </GridEnv.Provider>
  );
}
