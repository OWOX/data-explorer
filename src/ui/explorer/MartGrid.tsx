import { columnVisibilityFeature, tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import { Box, Info, RefreshCw, RotateCcw, X } from 'lucide-react';
import { askFocusFor, dropFocusFor, isFocusAskedFor, takeFocusFor } from './pending-focus';
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AUTO, keepsUnit, type Format } from '../../format/formats';
import { useColumnFormats } from '../../format/useColumnFormats';
import { PAGE_SIZE } from '../../config';
import { columnLetter } from './columnLetters';
import { emptyText, isNumericType } from '../format';
import { withJoined, type JoinedSource } from '../../api/blendable';
import { AGG_LABELS, allowedFunctions, applyDraft, draftOf, formatBucket, isGrouped, keepVisible, NO_AGGREGATION, outputsOf, outputType, sanitizeAggregation, ungroupableColumn, type Aggregation, type AggregationDraft, type DateBucket, type Output } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import { chartFields, ruleNewColumns } from '../../charts/fields';
import { keysPlan, useHavingKeys } from '../../charts/havingKeys';
import { readRows } from '../../api/rows';
import { canSuggest, valuesOf, valuesQuery } from '../../filters/valueSuggest';
import { dropOrphanHaving, toTraverseFilters, type ColumnFilter } from '../../filters/build';
import { sliceField } from '../../filters/slice';
import { ChartsBody } from '../../charts/ChartsBody';
import { dropPicksOf } from '../../charts/listMenu';
import { useWidth } from '../../charts/useWidth';
import { cycleSort, defaultSort, sortsOnColumns, type SortDirection, type SortKey } from '../../model/sort';
import { groupMap, moveColumn, moveColumnBy, orderColumns, ownInSchemaOrder } from '../../state/column-order';
import { joinedMartIds, joinedPaths, ownNamesIn, pathTitle } from '../../state/join-plan';
import type { Field, Model, Schema } from '../../model/types';
import { hasPrimaryKey, primaryKeys } from '../../records/relationships';
import type { Row } from '../../sdk/types';
import type { SavedView } from '../../api/grid-columns';
import { pruneGrid } from '../../state/view-link-resolve';
import { sourceOfModel, useServices, useStore, type GridState } from '../../state/store';
import { ErrorBox, errorMessage } from '../ErrorBox';
import { Toast } from '../Toast';
import { removedAggregation, unappliedFilter } from './unapplied';
import { Skeleton } from '../Skeleton';
import { Hint, OverflowTip, Tooltip } from '../Tooltip';
import { BandTools, BandToolsSlot } from '../bands/BandTools';
import { CardClickContext } from '../bands/CardClick';
import { useLatest } from '../useLatest';
import { PickedIcon } from '../bands/picked';
import { CellValue } from './CellValue';
import { blockOf, selectionTsv, type GridSelection } from './copySelection';
import { ColumnDragLayer } from './ColumnDrag';
import { ColumnControls, ColumnMenuEnvContext, type ColumnMenuEnv } from './ColumnMenu';
import { ColumnPicker, MartRuleMarks } from './ColumnPicker';
import { ExportMenu } from './ExportMenu';
import { defaultColumns } from '../../model/columns';
import { buildRowQuery, useMartRows } from './useMartRows';

/** A stable empty sort list, so a memo on it does not rerun each render. */
const NO_SORTS: SortKey[] = [];

function useSchema(martId: string, version: number) {
  const { schemas } = useServices();
  // `error` is a first read that failed (nothing to show); `failure` is a later read (Refresh) that failed while a schema is on screen, which stays.
  const [s, setS] = useState<{ schema: Schema | null; error: unknown; failure: unknown }>({ schema: schemas.peek(martId) ?? null, error: null, failure: null });
  useEffect(() => {
    let live = true;
    schemas.get(martId).then(
      (schema) => live && setS({ schema, error: null, failure: null }),
      (error) => live && setS((cur) => (cur.schema ? { ...cur, failure: error } : { schema: null, error, failure: null })),
    );
    return () => { live = false; };
  }, [schemas, martId, version]);
  return s;
}

/** `saved` is the grid as the reader left it; `filters` only changes when a followed link asks a mounted grid to re-seed. */
type GridSeed = { filters?: ColumnFilter[]; saved?: GridState };

/** What the page hands the grid: the mart, what it opens with, and where its changes go. */
/** Why a grid is a preview: the mart has no primary key, or its key is hidden for reporting. */
export type NoKey = false | 'missing' | 'hidden';
type GridProps = { martId: string; model: Model; seed: GridSeed; onChange: (state: GridState, edit?: boolean) => void; onRows?: (label: string | null, grouped?: boolean, noKey?: NoKey) => void; /** The grid begins holding its saves for the saved view: edits from now on are recorded on defaults. */ onHold?: () => void; /** The late saved view replaced parts of the grid a held edit was recorded on: Undo's "before" takes them too. */ onRebase?: (parts: Partial<GridState>) => void; /** The hold ends with nothing to rebase (the grid unmounted, or there was no saved view). */ onRelease?: () => void };

/** The grid for one mart: loads the schema, then reads rows. Key it by mart id. */
export function MartGrid({ martId, model, seed, onChange, onHold, onRebase, onRelease, onRows, paused = false }: GridProps & { /** The band is folded: nothing is read until it opens. */ paused?: boolean }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error, failure } = useSchema(martId, schemaVersion);
  const { schemas, blendable } = useServices();
  // Refresh also forgets what was read of this mart's schema and joins (Join Settings or a field list may have changed since).
  const refreshMart = useCallback(() => { schemas.invalidate(martId); blendable.invalidate(martId); setSchemaVersion((v) => v + 1); }, [schemas, blendable, martId]);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <SeededGrid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onHold={onHold} onRebase={onRebase} onRelease={onRelease} onRows={onRows} paused={paused} onRefresh={refreshMart} refreshError={failure} />;
}

/** A saved-columns read slower than this is given up on for this mount. */
export const SAVED_COLUMNS_WAIT_MS = 3000;
/** The longest a saved view's read holds the grid's saves; past it the edit is saved as it stands. */
export const VIEW_HOLD_MAX_MS = 10000;

/** The names in `saved` the column picker still offers, in the saved order. */
const offered = (schema: Schema, saved: string[]) => saved.filter((c) => schema.some((f) => f.name === c));

/** Whether a saved grid names something the mart's own schema does not have: a joined field, so the joined marts must be read first. */
const namesJoined = (schema: Schema, saved: GridState | undefined) =>
  !!saved && [...saved.columns, ...Object.keys(saved.filters), ...Object.keys(saved.slices ?? {}), ...(saved.sorts ?? []).map((x) => x.field)].some((n) => !schema.some((f) => f.name === n));

type Initial = { columns: string[]; cleaned: string[] | null; sources: JoinedSource[] | null; agg: Aggregation; /** The member's saved view (filters, slices, sort, limit, Table/Charts), pruned to the fields on offer; only when the page holds no grid for the mart. */ saved?: GridState };

const aggOf = (g: GridState | undefined): Aggregation => (g && (g.aggregations?.length || g.dateTrunc?.length) ? { aggregations: g.aggregations ?? [], dateTrunc: g.dateTrunc ?? [] } : NO_AGGREGATION);

/**
 * Settles the first column set before the grid mounts, so the first rows query is the only one:
 * this session's columns, else the member's saved ones (read once, at most 3 s), else the defaults.
 * A column saved from a joined mart waits for the joined marts to be read (inside the same 3 s): a read that
 * fails leaves those columns out of this visit without erasing them from what is saved.
 */
function SeededGrid(props: GridProps & { schema: Schema; paused: boolean; onRefresh: () => void; refreshError: unknown }) {
  const { martId, schema, seed } = props;
  const { columnStore, blendable } = useServices();
  const [initial, setInitial] = useState<Initial | null>(() => {
    const cached = blendable.peek(martId);
    const full = withJoined(schema, cached ?? []);
    const kept = orderColumns(offered(full, seed.saved?.columns ?? []), cached ?? [], defaultColumns(schema));
    // A session list that names a joined field waits for the joined marts unless they are already known.
    return kept.length && (cached || !namesJoined(schema, seed.saved)) ? { columns: kept, cleaned: null, sources: cached ?? null, agg: sanitizeAggregation(seed.saved ? aggOf(seed.saved) : columnStore.aggregation(martId), full) } : null;
  });
  // Once the wait is given up on, the saved view may still be on its way: the grid holds its saves until that read has settled, so an edit does not overwrite it.
  const [holdView, setHoldView] = useState(false);
  // The saved view when it arrives after the grid mounted (null: it never came or held nothing); undefined until then. The grid merges it in.
  const [lateView, setLateView] = useState<SavedView | null | undefined>(undefined);
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const gone = useRef(false);
  useEffect(() => { gone.current = false; return () => { gone.current = true; clearTimeout(holdTimer.current); }; }, []);
  useEffect(() => {
    if (initial) return;
    let live = true;
    const timer = setTimeout(() => {
      live = false;
      if (!seed.saved) {
        setHoldView(true);
        // The hold ends when the read settles, or after VIEW_HOLD_MAX_MS if it never does (then the member's edit is saved as it stands).
        let settled = false;
        const settle = (v: SavedView | null) => {
          if (settled || gone.current) return;
          settled = true;
          clearTimeout(holdTimer.current);
          setLateView(v ? lateGrid(v) : null);
          setHoldView(false);
        };
        // Pruned like the on-time seed: with the joined marts unknown, joined names are parked (kept), and the saved aggregation keeps its HAVING filters.
        const lateGrid = (v: SavedView): SavedView => {
          const known = blendable.peek(martId);
          const agg = columnStore.aggregation(martId);
          const raw: GridState = { columns: [], ...v, ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}) };
          if (!known?.length && namesJoined(schema, raw)) return v;
          const full = withJoined(schema, known ?? []);
          // Every offered column counts as shown here, so the aggregation (and the HAVING filters on it) is judged by the fields, not by the default column set.
          const out = pruneGrid({ ...raw, columns: full.map((f) => f.name) }, full).grid;
          return out ? { filters: out.filters, ...(out.slices ? { slices: out.slices } : {}), sorts: out.sorts, limit: v.limit, ...(v.view ? { view: v.view } : {}) } : v;
        };
        holdTimer.current = setTimeout(() => settle(null), VIEW_HOLD_MAX_MS);
        columnStore.loadView(martId).then((v) => columnStore.loadAggregation(martId).then(() => v, () => v)).then(settle, () => settle(null));
      }
      setInitial({ columns: defaultColumns(schema), cleaned: null, sources: null, agg: sanitizeAggregation(seed.saved ? aggOf(seed.saved) : NO_AGGREGATION, schema) });
    }, SAVED_COLUMNS_WAIT_MS);
    (async () => {
      const own = seed.saved?.columns;
      const saved = own ?? await columnStore.load(martId) ?? [];
      // A grid the page already holds (a view link, this session) wins over what is saved.
      const stored = seed.saved ? null : await columnStore.loadView(martId);
      const needs = namesJoined(schema, own ? seed.saved : { columns: saved, filters: stored?.filters ?? {}, slices: stored?.slices, sorts: stored?.sorts ?? null, limit: 0 });
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
      const full = withJoined(schema, sources ?? []);
      const columns = kept.length ? kept : defaultColumns(schema);
      const cleanAgg = sanitizeAggregation(keepVisible(agg, kept), full);
      // Rules on fields the mart no longer has are left out. With the joined marts unread, names that cannot be checked stay (the grid parks them), as with the columns.
      let savedGrid: GridState | undefined;
      if (stored) {
        const g: GridState = { columns, ...stored, ...(cleanAgg.aggregations.length ? { aggregations: cleanAgg.aggregations } : {}), ...(cleanAgg.dateTrunc.length ? { dateTrunc: cleanAgg.dateTrunc } : {}) };
        savedGrid = failed ? g : (pruneGrid(g, full).grid ?? g);
      }
      setInitial({ columns, cleaned: (dropped || regrouped) && !own ? kept : null, sources, agg: cleanAgg, ...(savedGrid ? { saved: savedGrid } : {}) });
    })();
    return () => { live = false; clearTimeout(timer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cleaned = initial?.cleaned ?? null;
  // The cleanup of a saved list that named columns that are gone is the one save that is not the member's own change.
  useEffect(() => { if (cleaned) columnStore.save(martId, cleaned); }, [cleaned, columnStore, martId]);
  if (!initial) return <Skeleton rows={8} />;
  return <Grid {...props} holdView={holdView} lateView={lateView} seed={seed.saved || !initial.saved ? seed : { ...seed, saved: initial.saved }} initialColumns={initial.columns} initialSources={initial.sources} initialAgg={initial.agg} />;
}

// TanStack Table v9 builds the header groups and the row model; the headers and cells are drawn by the components above.
const features = tableFeatures({ columnVisibilityFeature });
type GridColumn = ColumnDef<typeof features, Row>;

// The sorts reach the header cells through context, so a sort change re-renders the titles without touching their props.
// `sortable` is off in Charts mode: the titles are plain text there.
const GridEnv = createContext<{ sorts: SortKey[]; toggleSort: (field: string) => void; sortable: boolean }>({ sorts: [], toggleSort: () => undefined, sortable: true });

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
  const { sorts, toggleSort, sortable } = useContext(GridEnv);
  const at = sorts.findIndex((s) => s.field === field.name);
  const current = at < 0 ? null : sorts[at]!.direction;
  const label = outputLabel(field, output);
  // Inside a data mart's group the group row names the mart, so the title is the field alone.
  const shown = output.fn ? `${fieldLabel(field)} · ${AGG_LABELS[output.fn]}` : fieldLabel(field);
  if (!output.sortable || !sortable) return <OverflowTip text={label} measure={(el) => el.querySelector('.truncate')}><span className="inline-flex min-w-0 items-center font-medium"><span className="truncate">{shown}</span></span></OverflowTip>;
  const button = (
    <button type="button" onClick={() => toggleSort(field.name)} aria-label={`Sort by ${label}, currently ${current ? DIRECTION_NAME[current] : 'not sorted'}${current && sorts.length > 1 ? `, sort ${at + 1} of ${sorts.length}` : ''}`}
      className="dm-sort inline-flex min-w-0 items-center gap-1 font-medium">
      <span className="truncate">{shown}</span>
    </button>
  );
  return <OverflowTip text={label} measure={(el) => el.querySelector('.truncate')}>{button}</OverflowTip>;
}

/** One shown column as the header and the cells read it: resolved once per column, not once per cell. */
type ColumnView = { output: Output; field: Schema[number]; /** The menu and the info belong to the column: they sit on its first output only. */ lead: boolean; type: string; format: Format; maxWidth: string; numeric: boolean };

/** A column's title, its info button, and its menu. A module-level component, so a header keeps its identity (and an open menu stays open) whatever the grid rebuilds around it. */
const HeaderCell = memo(function HeaderCell({ field, output, lead }: { field: Schema[number]; output: Output; lead: boolean }) {
  return (
    <div className="dm-hdr">
      <SortTitle field={field} output={output} />
      {lead && field.description?.trim() && (
        <Tooltip content={field.description}>
          <button type="button" aria-label={`About ${columnTitle(field)}`} className="dm-reveal dm-col-info">
            <Info className="dm-icon" />
          </button>
        </Tooltip>
      )}
      <span aria-hidden className="dm-hdr-spacer" />
      {lead && <ColumnControls field={field} output={output} />}
    </div>
  );
});

/** What a data cell shows: a date bucket by its unit, anything else as the field's type and the column's format say. */
function BodyCell({ row, column }: { row: Row; column: ColumnView }) {
  const { output } = column;
  return output.bucket ? <BucketValue value={row[output.key]} unit={output.bucket} /> : <CellValue row={row} field={output.key} type={column.type} format={column.format} />;
}

/** What a row's selection state is, as one short string, so a row the selection does not change gets the same props and does not render. */
type RowMarks = { /** The row number's mark. */ head?: string; /** The one selected cell's column. */ cell?: number; /** The block's columns, and whether this row is its top and bottom edge. */ block?: [number, number, boolean, boolean]; /** The block's moving end, its active cell and its fill handle: their columns. */ moving?: number; active?: number; handle?: number };

type RowActs = {
  startDrag: (row: number, col: number, e: React.MouseEvent) => void;
  dragOver: (row: number, col: number, e: React.MouseEvent) => void;
  pickCell: (row: number, col: number, e: React.MouseEvent) => void;
  pickRow: (row: number, e: React.MouseEvent) => void;
  open: (row: Row) => void;
};

/** One data row. Memoised: a selection change re-renders only the rows whose `marks` changed. */
const GridRow = memo(function GridRow({ row, ri, columns, marks, acts, clickable }: { row: Row; ri: number; columns: ColumnView[]; marks: string; acts: RowActs; clickable: boolean }) {
  const m: RowMarks = marks ? JSON.parse(marks) : {};
  return (
    <tr onClick={clickable ? () => acts.open(row) : undefined} className={clickable ? 'cursor-pointer' : ''}>
      <th aria-hidden data-chrome data-selected={m.head} onClick={(e) => acts.pickRow(ri, e)} className="dm-chrome">{ri + 1}</th>
      {columns.map((c, ci) => {
        const inBlock = !!m.block && ci >= m.block[0] && ci <= m.block[1];
        const edge = inBlock ? [ci === m.block![0] && 'l', ci === m.block![1] && 'r', m.block![2] && 't', m.block![3] && 'b'].filter(Boolean).join(' ') : undefined;
        return (
          <td key={c.output.key} data-selected={m.cell === ci ? '' : undefined} data-moving={m.moving === ci ? '' : undefined} data-range={inBlock ? '' : undefined} data-active={m.active === ci ? '' : undefined} data-handle={m.handle === ci ? '' : undefined} data-edge={edge}
            onMouseDown={(e) => acts.startDrag(ri, ci, e)} onMouseEnter={(e) => acts.dragOver(ri, ci, e)} onClick={(e) => acts.pickCell(ri, ci, e)}
            className={`${c.maxWidth} overflow-hidden whitespace-nowrap${c.numeric ? ' text-right' : ''}`}>
            <BodyCell row={row} column={c} />
          </td>
        );
      })}
      <td aria-hidden className="p-0" />
    </tr>
  );
});

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
const byField = (m: Record<string, ColumnFilter> | undefined) => Object.entries(m ?? {}).sort(([a], [b]) => a.localeCompare(b));
const stable = (g: GridState) => JSON.stringify([g.columns, byField(g.filters), byField(g.slices), g.sorts, g.limit, g.aggregations ?? [], g.dateTrunc ?? [], g.view ?? 'table']);
const sameGrid = (a: GridState, b: GridState) => stable(a) === stable(b);

/** The rules on fields the schema offers (or, with `offered` false, the parked ones on fields it does not). */
const pickOffered = (rules: Record<string, ColumnFilter>, schema: Schema, offered = true) => Object.fromEntries(Object.entries(rules).filter(([k]) => schema.some((f) => f.name === k) === offered));

/** The map with one entry set, or taken out when the value is undefined. */
const withEntry = (m: Record<string, ColumnFilter>, key: string, value: ColumnFilter | undefined) => { const n = { ...m }; if (value) n[key] = value; else delete n[key]; return n; };

/** The member's sorts after a menu choice. With none of their own (null) a choice replaces the default; after that it sets the field's direction where it stands in the order of precedence, or adds it last. Removing drops the field (the member's own empty list is no sort at all). */
const nextSorts = (field: string, direction: SortDirection | null) => (cur: SortKey[] | null): SortKey[] | null => {
  if (direction === null) return cur === null ? [] : cur.filter((s) => s.field !== field);
  if (cur === null) return [{ field, direction }];
  return cur.some((s) => s.field === field) ? cur.map((s) => (s.field === field ? { field, direction } : s)) : [...cur, { field, direction }];
};

const toFilterMap = (list: ColumnFilter[]): Record<string, ColumnFilter> => Object.fromEntries(list.map((f) => [f.field, f]));

function Grid({ martId, model, schema: native, seed, holdView, lateView, initialColumns, initialSources, initialAgg, onChange, onHold, onRebase, onRelease, onRows, paused, onRefresh, refreshError }: GridProps & { schema: Schema; paused: boolean; onRefresh: () => void; refreshError: unknown; /** The member's saved view is still being read: its saves wait. */ holdView: boolean; /** The saved view, once a late read delivers it: parts the member has not touched since the grid opened take its values. */ lateView: SavedView | null | undefined; initialColumns: string[]; initialAgg: Aggregation; initialSources: JoinedSource[] | null }) {
  const { columnStore, blendable, chartSettings } = useServices();
  // Set by the open charts body: the hidden columns whose card picks it drops (it holds the loaded settings).
  const pruneCards = useRef<((hidden: string[]) => boolean) | null>(null);
  const pruneChain = useRef<Promise<void>>(Promise.resolve());
  const slot = useContext(BandToolsSlot);
  // The joined marts are read when the mart becomes the main one (the page asks the same loader, so it is one read).
  const [sources, setSources] = useState<JoinedSource[]>(initialSources ?? []);
  // Reading the joined marts failed (cleared when a read starts or succeeds).
  const [joinsFailed, setJoinsFailed] = useState(false);
  // Refresh raises the tick: the joined marts are read again (the loader's entry was dropped), even when the grid opened with them.
  const [refreshTick, setRefreshTick] = useState(0);
  useEffect(() => {
    if (initialSources && refreshTick === 0) return;
    let live = true;
    blendable.get(martId).then((s) => { if (live) setSources(s); }, () => { if (live) setJoinsFailed(true); });
    return () => { live = false; };
  }, [blendable, martId, initialSources, refreshTick]);
  const schema = useMemo(() => withJoined(native, sources), [native, sources]);
  // Create Data Mart reads the joins only once they are known: a mart without joins is an empty list, not an unread one.
  const joinsRead = !!blendable.peek(martId);
  const martStorage = useMemo(() => { const sid = model.marts.get(martId)?.storageId; return model.storages.find((x) => x.id === sid); }, [model, martId]);
  const martTitles = useMemo(() => new Map([...model.marts].map(([id, m]) => [id, m.title])), [model.marts]);
  const { formatOf, memberFormat, setMember: setFormat } = useColumnFormats(martId, schema, model.marts.get(martId)?.title);
  const [{ modelVersion }, dispatch] = useStore();
  // The columns, filters and page the reader left this mart with (a followed link has already written its filters there).
  const [visible, setVisible] = useState(initialColumns);
  // Cell or whole-column selection (see below); a changed column order or set drops it.
  const [selected, setSelected] = useState<GridSelection | null>(null);
  // The functions and date buckets on columns: any of them groups the rows.
  const [agg, setAgg] = useState<Aggregation>(initialAgg);
  // Every rule the member has, applied or not. A filter on a field this visit does not offer (a joined field whose marts could not be read, or one a Refresh
  // took away) is parked: it stays here and is written back with the live ones, but `filters` below leaves it out. When the offered fields change,
  // parked filters on fields now offered are applied after all, and filters on fields no longer offered are parked. Slices (the pre-join rules on joined fields) work the same way.
  const offeredNow = (name: string) => schema.some((f) => f.name === name);
  const [allFilters, setAllFilters] = useState<Record<string, ColumnFilter>>(() => seed.saved?.filters ?? {});
  // The data mart (by group path) whose Fields list is open.
  const [fieldsOpen, setFieldsOpen] = useState<string | null>(null);
  const openedBy = useRef<HTMLElement | null>(null);
  const [allSlices, setAllSlices] = useState<Record<string, ColumnFilter>>(() => seed.saved?.slices ?? {});
  const filters = useMemo(() => pickOffered(allFilters, schema), [allFilters, schema]);
  // A rule does not need its field on the grid: a filter or slice on a hidden field of a data mart that is on the grid (or a hidden field of the main mart) applies,
  // because the schema offers every field of the joined marts. Only a field this visit does not offer is parked: that includes a joined mart's field when the joined marts could not be read, so a slice on a mart with no shown column cannot reach the query then.
  const slices = useMemo(() => pickOffered(allSlices, schema), [allSlices, schema]);
  const offeredKey = schema.map((f) => f.name).join('\u0000');
  const [seenOffered, setSeenOffered] = useState({ key: offeredKey, schema });
  // What this render has to tell the member (said once, in the toast below).
  const said: string[] = [];
  if (seenOffered.key !== offeredKey) {
    setSeenOffered({ key: offeredKey, schema });
    // The rules that were applied under the old field list and are parked under the new one.
    const goneFrom = (rules: Record<string, ColumnFilter>) => Object.keys(rules).filter((k) => seenOffered.schema.some((f) => f.name === k) && !offeredNow(k));
    const pausedNote = (noun: string, names: string[]) => {
      const titles = names.map((k) => { const was = seenOffered.schema.find((f) => f.name === k); return was ? columnTitle(was) : k; });
      const many = titles.length > 1;
      return `The ${many ? `${noun}s` : noun} on ${titles.join(', ')} ${many ? 'are' : 'is'} paused: ${many ? 'those fields are' : 'that field is'} no longer offered.`;
    };
    const goneSlices = goneFrom(allSlices);
    const gone = goneFrom(allFilters);
    if (goneSlices.length) said.push(pausedNote('slice', goneSlices));
    if (gone.length) said.push(pausedNote('filter', gone));
  }
  // What the member applied that the request leaves out, said once in a toast: an incomplete filter, a function the field no longer allows, a failed Refresh.
  const [note, setNote] = useState<{ text: string } | null>(null);
  const [seenFailure, setSeenFailure] = useState(refreshError);
  if (seenFailure !== refreshError) {
    setSeenFailure(refreshError);
    if (refreshError) said.push(`Refresh failed: ${errorMessage(refreshError)}. The grid shows what was read before.`);
  }
  // null: the member has set no sort, so rows open newest date first. The default is judged once, from the columns the grid opened with.
  const [own, setOwn] = useState<SortKey[] | null>(() => (seed.saved?.sorts ? (sortsOnColumns(seed.saved.sorts, visible).length || !seed.saved.sorts.length ? sortsOnColumns(seed.saved.sorts, visible) : null) : null));
  const [fallback] = useState(() => defaultSort(native, visible));
  const sorts = own ?? fallback;
  const [limit, setLimit] = useState(() => seed.saved?.limit ?? PAGE_SIZE);
  // Table or charts. The page (the switch, Undo, a view link) changes it; it is saved with the rest of the view.
  const [view, setView] = useState<GridState['view']>(() => seed.saved?.view);
  const [ownVersion, setVersion] = useState(0);
  // Set by a change the member makes to what the grid shows (a filter, a sort, an aggregation, columns, Reset): the save that follows is one Undo step.
  // Paging, seeding and what is adopted from the page are not edits. The counter is bumped in the handler that makes the change, so both
  // land in one render; the save effect compares it with the last value it saw (an edit that changed nothing saves an identical grid the store drops).
  const [editSeq, setEditSeq] = useState(0);
  const seenSeq = useRef(0);
  const markEdit = useCallback(() => setEditSeq((n) => n + 1), []);
  // A change to what the grid shows: one Undo step, and the rows start again from the first page.
  const edit = useCallback((change: () => void) => { markEdit(); change(); setLimit(PAGE_SIZE); }, [markEdit, setLimit]);
  // A model reload re-reads what is shown too: its counter joins the grid's own, and each only ever goes up.
  const version = ownVersion + modelVersion;
  // Re-seed the filters when a followed link asks for new ones on this same mart (adjust state during render).
  const [seededFrom, setSeededFrom] = useState(seed.filters);
  if (seededFrom !== seed.filters) {
    setSeededFrom(seed.filters);
    if (seed.filters) {
      setAllFilters(toFilterMap(seed.filters));
      // A followed link replaces the member's rules with its own filters: the slices of the old view do not carry over.
      setAllSlices({});
      setLimit(PAGE_SIZE);
    }
  }

  // The grid as the store keeps it: the parked rules are in it, and the empty lists are left out.
  const current = useMemo<GridState>(() => ({
    columns: visible, filters: allFilters, ...(Object.keys(allSlices).length ? { slices: allSlices } : {}), sorts: own, limit,
    ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}), ...(view ? { view } : {}),
  }), [visible, allFilters, allSlices, own, limit, agg, view]);

  // The page changes this grid too (a card click adds or takes out a joined mart's columns, Undo puts them back): what the store
  // holds is adopted when it is not what the grid already shows. The grid's own changes reach the store through the effect below.
  const [seenSaved, setSeenSaved] = useState(seed.saved);
  // Columns adopted from the page (Undo, Redo, a card click) are the member's columns now: they are saved like a picker change.
  // Each adoption is a fresh array (and below a fresh object), so two in a row with equal content still re-run the save effect.
  const [adopted, setAdopted] = useState<string[] | null>(null);
  // An aggregation adopted alone (Undo of a function or bucket) is persisted too, so a reopened plugin does not read the stale one.
  const [adoptedAgg, setAdoptedAgg] = useState<Aggregation | null>(null);
  if (seed.saved !== seenSaved) {
    setSeenSaved(seed.saved);
    const saved = seed.saved;
    if (saved && saved.columns.length > 0 && !sameGrid(saved, current)) {
      setView(saved.view);
      setVisible(saved.columns);
      setAgg(aggOf(saved));
      if (!sameList(saved.columns, visible)) { setAdopted([...saved.columns]); setSelected(null); }
      else if (JSON.stringify(aggOf(saved)) !== JSON.stringify(agg)) setAdoptedAgg({ ...aggOf(saved) });
      setAllFilters(saved.filters);
      setAllSlices(saved.slices ?? {});
      setOwn(saved.sorts);
      setLimit(saved.limit);
    }
  }

  useEffect(() => { if (adopted) { columnStore.save(martId, adopted); columnStore.saveAggregation(martId, agg); } }, [adopted, columnStore, martId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (adoptedAgg) columnStore.saveAggregation(martId, adoptedAgg); }, [adoptedAgg, columnStore, martId]);

  // An edit made while the saved view was still being read waits for it, then is saved.
  useEffect(() => { if (holdView) onHold?.(); }, [holdView]); // eslint-disable-line react-hooks/exhaustive-deps
  // A grid that goes away ends its hold: nothing is left to rebase.
  useEffect(() => () => onRelease?.(), []); // eslint-disable-line react-hooks/exhaustive-deps
  const heldView = useRef<SavedView | null>(null);
  const viewKey = useRef<string | null>(null);
  // The parts of the view as the grid opened with them: a part still equal to this is one the member has not changed.
  const [opened] = useState(() => ({ filters: JSON.stringify(allFilters), slices: JSON.stringify(allSlices), sorts: JSON.stringify(own), limit, view: JSON.stringify(view ?? null) }));
  // When the late saved view arrives, the parts the member has not touched take its values and their own parts stay (adjusted during render, like the seed above).
  const [mergedLate, setMergedLate] = useState<{ view: SavedView | null; /** The parts that took the saved view's values (the member had not changed them). */ taken?: Partial<GridState> } | null>(null);
  if (!holdView && lateView !== undefined && !mergedLate) {
    if (!lateView) setMergedLate({ view: null });
    else {
      const f = JSON.stringify(allFilters) !== opened.filters ? allFilters : lateView.filters;
      const sl = JSON.stringify(allSlices) !== opened.slices ? allSlices : (lateView.slices ?? {});
      // The saved sorts are held to the columns shown, as the on-time seed does.
      const lateSorts = lateView.sorts && (sortsOnColumns(lateView.sorts, visible).length || !lateView.sorts.length ? sortsOnColumns(lateView.sorts, visible) : null);
      const so = JSON.stringify(own) !== opened.sorts ? own : lateSorts;
      const lim = limit !== opened.limit ? limit : lateView.limit;
      const vw = JSON.stringify(view ?? null) !== opened.view ? view : lateView.view;
      setAllFilters(f); setAllSlices(sl); setOwn(so); setLimit(lim); setView(vw);
      const taken: Partial<GridState> = {};
      if (f !== allFilters) taken.filters = f;
      if (sl !== allSlices) taken.slices = Object.keys(sl).length ? sl : undefined;
      if (JSON.stringify(own) === opened.sorts) taken.sorts = so;
      if (limit === opened.limit) taken.limit = lim;
      if (JSON.stringify(view ?? null) === opened.view) taken.view = vw;
      setMergedLate({ view: { filters: f, ...(Object.keys(sl).length ? { slices: sl } : {}), sorts: so, limit: lim, ...(vw ? { view: vw } : {}) }, taken });
    }
  }
  // The held edit is saved once the hold ends: as it stands if the saved view never came, else merged over it. An edit still held when the grid
  // unmounts is dropped, not saved: it was made on defaults and would erase the saved view. (Declared before the save effect below, so the merged key is known to it.)
  useEffect(() => {
    if (!mergedLate) return;
    const held = heldView.current;
    heldView.current = null;
    if (mergedLate.view) viewKey.current = JSON.stringify(mergedLate.view);
    const out = mergedLate.view ?? held;
    if (held && out) columnStore.saveView(martId, out);
    // The held edit was recorded on top of the defaults: Undo of it returns to the saved view, not to the defaults that would be saved over it.
    if (mergedLate.taken) onRebase?.(mergedLate.taken);
    else onRelease?.();
  }, [mergedLate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every change to what the grid shows is saved with the columns (after the same pause); what the grid opened with is not written back.
  useEffect(() => {
    const v: SavedView = { filters: current.filters, ...(current.slices ? { slices: current.slices } : {}), sorts: current.sorts, limit: current.limit, ...(current.view ? { view: current.view } : {}) };
    const key = JSON.stringify(v);
    const last = viewKey.current;
    viewKey.current = key;
    if (last !== null && last !== key) { if (holdView) heldView.current = v; else columnStore.saveView(martId, v); }
  }, [current, columnStore, martId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const edit = editSeq !== seenSeq.current; seenSeq.current = editSeq; onChange(current, edit); }, [current, editSeq]); // eslint-disable-line react-hooks/exhaustive-deps

  // Every data mart's columns sit together: the main mart's own, then each joined mart's in the order it was added.
  const shown = useMemo(() => orderColumns(visible, sources, defaultColumns(native)), [visible, sources, native]);
  /** The joined marts the band shows as selected: those with a field among the columns. */
  const joinedMarts = useMemo(() => joinedMartIds(shown, sources).map((id) => ({ id, title: model.marts.get(id)?.title ?? id })), [shown, sources, model.marts]);
  if (!sameList(shown, visible)) setVisible(shown);
  // Rules of a column that is no longer shown go with it; any function or bucket left groups the rows (no default order then: it may name nothing shown).
  const keptAgg = useMemo(() => keepVisible(agg, shown), [agg, shown]);
  const aggNow = useMemo(() => sanitizeAggregation(keptAgg, schema), [keptAgg, schema]);
  // A rule that was applied and is dropped now (a Refresh narrowed the functions the field allows) is not silent: the toast says it was removed.
  const removed = removedAggregation(keptAgg, aggNow, schema);
  const [seenRemoved, setSeenRemoved] = useState('');
  if (seenRemoved !== (removed?.key ?? '')) {
    setSeenRemoved(removed?.key ?? '');
    if (removed) {
      said.push(removed.text);
      // A HAVING filter on a function that was just removed goes with it, in the same render as the toast.
      // A parked filter belongs to a field this visit does not offer, so aggNow never holds its rule: it is checked against the raw rules, minus the ones just removed.
      const dropped = keptAgg.aggregations.filter((r) => !aggNow.aggregations.includes(r));
      const parkedRules = agg.aggregations.filter((r) => !dropped.includes(r));
      setAllFilters((cur) => {
        const applied = pickOffered(cur, schema);
        const parked = pickOffered(cur, schema, false);
        const kept = dropOrphanHaving(applied, aggNow.aggregations);
        const keptParked = dropOrphanHaving(parked, parkedRules);
        return kept === applied && keptParked === parked ? cur : { ...keptParked, ...kept };
      });
    }
  }
  if (said.length) setNote({ text: said.join(' ') });
  const grouped = isGrouped(aggNow);
  // Grouped with no sort of the member's own: the first group key ascending, so "Load more" pages never reshuffle.
  // From the schema's order, not the grid's: moving a column must not change the query.
  const firstKey = schema.find((f) => shown.includes(f.name) && !aggNow.aggregations.some((r) => r.column === f.name))?.name;
  const gridSorts = useMemo<SortKey[]>(() => (grouped ? (own?.length ? own : firstKey ? [{ field: firstKey, direction: 'asc' }] : []) : sorts), [grouped, own, sorts, firstKey]);
  const pks = primaryKeys(native);
  const wanted = useMemo(() => shown.flatMap((name) => schema.find((f) => f.name === name) ?? []), [shown, schema]);
  // A shown array, JSON or struct column with no rule would be a GROUP BY key the warehouse or the backend refuses: no grouped query goes out until it is hidden.
  const blocked = ungroupableColumn(wanted, aggNow);
  const query = useMemo(() => buildRowQuery(schema, shown, Object.values(filters), limit, gridSorts, aggNow, Object.values(slices)), [schema, shown, filters, slices, gridSorts, limit, aggNow]);
  // A folded band reads nothing: the query it last read stays, and a change made meanwhile is read once it opens.
  const [asked, setAsked] = useState(query);
  if (!paused && !blocked && asked !== query) setAsked(query);
  // Charts read their own queries: the grid's rows query is paused (not dropped, which would change its key and re-read on the way back to Table).
  const charts = view === 'charts';
  // Charts take the box the table last had (at most 32rem), so switching modes does not move the bands below.
  // A grid that opens in Charts has never measured a table: it takes the full 32rem.
  const frame = useRef<HTMLDivElement>(null);
  // A ref, not state: a re-render on every resize of the table would reach an open column menu and drop its Apply.
  const tableHeight = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = frame.current;
    if (charts || !el) return;
    // Full screen stretches the frame: that height is not the table's, so it is not kept.
    const measure = () => { const h = el.getBoundingClientRect().height; if (h > 0 && !el.closest('.dm-full')) tableHeight.current = h; };
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [charts]);
  const { rows: read, loading: reading, error, hasMore, run, errorRunId } = useMartRows(martId, asked, version, charts);
  const rows = blocked || charts ? null : read;
  const loading = reading && !blocked && !charts;
  const byName = useMemo(() => new Map(schema.map((f) => [f.name, f])), [schema]);
  // One output per column, or one per function of an aggregated column.
  const outputs = useMemo(() => outputsOf(wanted.map((f) => f.name), aggNow), [wanted, aggNow]);
  // A HAVING filter on a function that was just taken off goes in the same step, and the new rules are remembered.
  const applyAgg = useCallback((next: Aggregation) => {
    setAgg(next);
    setAllFilters((cur) => dropOrphanHaving(cur, next.aggregations));
    columnStore.saveAggregation(martId, next);
  }, [columnStore, martId]);
  const changeAgg = useCallback((column: string, draft: AggregationDraft) => edit(() => applyAgg(applyDraft(column, draft, agg))), [agg, applyAgg, edit]);
  // Shown columns that cannot take part in a grouped query: another column's Apply would group the rows and strand them.
  const blockers = useMemo(() => wanted.filter((f) => f.category === 'other').map((f) => ({ name: f.name, title: columnTitle(f) })), [wanted]);
  // What the header and each cell read of a column, resolved once per column: the type after any function, and the format that type allows.
  const columnViews = useMemo<ColumnView[]>(() => outputs.map((o) => {
    const field = byName.get(o.column)!;
    const type = outputType(field, o.fn);
    return { output: o, field, lead: outputs.find((x) => x.column === o.column) === o, type, format: keepsUnit(o.fn) ? formatOf(o.column, type) : AUTO, maxWidth: maxWidthOf(field), numeric: !o.bucket && isNumericType(type) };
  }), [outputs, byName, formatOf]);
  const columnByKey = useMemo(() => new Map(columnViews.map((c) => [c.output.key, c])), [columnViews]);
  const columns = useMemo<GridColumn[]>(() => outputs.map((o) => ({ id: o.key })), [outputs]);

  // While the member has no sort of their own, a click replaces the default with that column ascending (the
  // default's own column included), so a default never rides along as a second sort; after that the normal cycle.
  const toggleSort = useCallback((field: string) => edit(() => setOwn((cur) => (cur === null ? [{ field, direction: 'asc' }] : cycleSort(cur, field)))), [edit, setOwn]);
  // The menu's sort choices. With no sort of the member's own, a choice replaces the default (as a title click does); after that it sets the
  // column's direction where it stands in the order of precedence, or adds it last, which is what the title's first click does. Removing
  // drops the column, and removing the default's own column leaves the member's own empty list (no sort at all).
  const setSort = useCallback((field: string, direction: SortDirection | null) => edit(() => setOwn(nextSorts(field, direction))), [edit, setOwn]);
  // The implicit first-key sort is sent and exported but not shown: no arrow, no aria-sort, so the first click is not a no-op.
  const shownSorts = useMemo(() => (grouped ? (own ?? []) : gridSorts), [grouped, own, gridSorts]);
  const env = useMemo(() => ({ sorts: shownSorts, toggleSort, sortable: !charts }), [shownSorts, toggleSort, charts]);
  // A hidden column's sort is dropped with it, so no ordering is left that the reader cannot see.
  const changeColumns = useCallback((picked: string[], more?: (cur: Aggregation) => Aggregation) => {
    const cols = orderColumns(picked, sources, defaultColumns(native));
    markEdit();
    // A card's saved pick of a column the member hides goes with it: through the open charts body, else straight in the store. Never from a load, so a failed or late read keeps every pick.
    const hidden = visible.filter((n) => !cols.includes(n));
    if (hidden.length > 0) {
      if (!pruneCards.current?.(hidden)) {
        // One load then save at a time per mart, so two quick hides do not both start from the same saved doc.
        pruneChain.current = pruneChain.current.then(() => chartSettings.load(martId)).then((cur) => { const next = dropPicksOf(cur, new Set(hidden)); if (next !== cur) chartSettings.save(martId, { ...next, version: 2 }); }).catch(() => {});
      }
    }
    setVisible(cols);
    const nextAgg = keepVisible(more ? more(agg) : agg, cols);
    // A HAVING filter on a hidden column's function goes with it, in the same step.
    if (nextAgg !== agg) applyAgg(nextAgg);
    setOwn((cur) => { const kept = cur && sortsOnColumns(cur, cols); return cur && cur.length > 0 && kept!.length === 0 ? null : kept; });
    // A joined mart whose last field was unticked is remembered as empty: it comes back with its first text field.
    const left = joinedMartIds(visible, sources).filter((m) => !joinedMartIds(cols, sources).includes(m));
    columnStore.save(martId, cols, left.length ? Object.fromEntries(left.map((m) => [m, [] as string[]])) : undefined);
    // A joined mart that has just left remembers what it was showing, as its own field names.
    for (const m of left) columnStore.saveLastShown(m, ownNamesIn(visible, sources, m));
  }, [sources, native, markEdit, agg, applyAgg, visible, columnStore, chartSettings, martId, setVisible, setOwn]);
  // A chart menu's choice of a field that is not shown: the shown columns and the new ones, in one edit.
  // In a grouped grid a new column without a rule would become a group key and multiply the rows: a metric gets the function the chart sums it with, a date the chart's bucket (Month when none is known yet). A dimension is a key, as intended.
  const showColumns = useCallback((names: string[], buckets?: Readonly<Record<string, DateBucket>>) => changeColumns([...new Set([...shown, ...names])], (cur) => ruleNewColumns(cur, names.flatMap((n) => (shown.includes(n) ? [] : [byName.get(n)!])), buckets)), [changeColumns, shown, byName]);
  // A moved column keeps its sorts, filters and functions: only the order changes, and it is one Undo step. The cell selection is dropped (its columns moved).
  const reorder = useCallback((cols: string[]) => {
    if (cols === shown) return;
    markEdit();
    setVisible(cols);
    columnStore.save(martId, cols);
    setSelected(null);
  }, [shown, markEdit, columnStore, martId]);
  const table = useTable({ features, data: rows ?? [], columns });
  const rowsLabel = rows ? `${rows.length}${hasMore ? '+' : ''}` : null;
  // The Data band's title row shows the no-primary-key warning, so it is told whether this grid is a plain preview.
  // `hidden`: the mart has a key but it is hidden for reporting, so no row can be opened by it.
  const noKey: NoKey = grouped || pks.length > 0 ? false : hasPrimaryKey(native) ? 'hidden' : 'missing';
  useEffect(() => { onRows?.(rowsLabel, grouped, noKey); }, [rowsLabel, grouped, noKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const cardClick = useContext(CardClickContext);
  // One cell per data mart over its columns, main first; only when a joined mart is on screen.
  const groups = useMemo(() => {
    // A group is a mart at one alias path ('' for the main mart), so a mart joined under two parents is two groups.
    const inUse = joinedPaths(shown, sources);
    const out: { id: string; path: string; title: string; icon: string | null | undefined; description: string | null | undefined; span: number; main: boolean }[] = [];
    for (const o of outputs) {
      const f = byName.get(o.column)!;
      const id = f.joined?.martId ?? martId;
      const path = f.joined?.aliasPath ?? '';
      const source = f.joined ? sources.find((x) => x.aliasPath === path) : undefined;
      const last = out[out.length - 1];
      if (last && last.path === path) last.span += 1;
      else out.push({ id, path, title: (f.joined ? (source ? pathTitle(source, inUse, sources) : f.joined.label) : model.marts.get(id)?.title) ?? id, icon: model.marts.get(id)?.icon, description: model.marts.get(id)?.description, span: 1, main: !f.joined });
    }
    return out;
  }, [outputs, byName, model, martId, shown, sources]);
  // A remove button is off while its click is being applied, so a second click cannot put the mart back.
  const [removing, setRemoving] = useState(false);
  const head = useRef<HTMLTableSectionElement>(null);
  const remove = (g: (typeof groups)[number], index: number) => {
    // A joined group takes only its own columns: the marts joined through it keep theirs and stay joined through it. The main group deselects the main mart.
    const gone = (path: string) => (g.main ? path === '' : path === g.path);
    // Focus lands on the nearest tab that is still there (its remove button, else its Columns button) once the tab is gone.
    const next = [...groups.slice(index + 1), ...groups.slice(0, index).reverse()].find((x) => !gone(x.path))?.path;
    // Taking the main tab away promotes the next one and the grid remounts (DataBand keys it by mart): the new grid focuses its Columns button.
    const promoted = g.main && groups[1] ? groups[1].id : null;
    askFocusFor(promoted);
    setRemoving(true);
    (g.main ? cardClick(g.id, { only: 'deselect' }) : cardClick(g.id, { removePaths: [g.path] })).catch(() => undefined).finally(() => {
      // The focus waits for the render that re-enables the buttons: a timer could fire before it and find the target's remove button still disabled.
      focusAfterRemove.current = next ?? null;
      setRemoving(false);
      // Nothing remounted (the click did nothing): the request must not wait for a later mount.
      if (promoted) setTimeout(() => dropFocusFor(promoted), 1000);
    });
  };
  /** The path of the tab that takes focus once a removal has been applied; null when there is none. */
  const focusAfterRemove = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const path = focusAfterRemove.current;
    if (removing || path === undefined) return;
    focusAfterRemove.current = undefined;
    const th = path === null ? null : head.current?.querySelector(`th[data-group-path="${CSS.escape(path)}"]`);
    (th?.querySelector<HTMLElement>('button[data-remove]:not(:disabled)') ?? th?.querySelector<HTMLElement>('button'))?.focus();
  }, [removing]);
  useEffect(() => {
    if (!isFocusAskedFor(martId)) return;
    const button = head.current?.querySelector<HTMLElement>(`th[data-group-path=""] button`);
    if (button && takeFocusFor(martId)) button.focus();
  }, [groups, martId]);
  const several = groups.length > 1;
  // The first data mart is the main one: its last own column stays while a joined mart is shown.
  const ownNames = useMemo(() => new Set(native.map((f) => f.name)), [native]);
  const ownOn = shown.filter((n) => ownNames.has(n)).length;
  // The one primary key column Count Unique can count by, when the mart has exactly one (a composite key has no single column to count).
  const uniqueKey = useMemo(() => { const ks = native.filter((f) => f.isPrimaryKey); return ks.length === 1 && allowedFunctions(ks[0]!).includes('COUNT_DISTINCT') ? ks[0]!.name : undefined; }, [native]);
  const fieldsOf = (g: { main: boolean; path: string }) => (g.main ? native : sources.filter((x) => x.aliasPath === g.path).flatMap((x) => x.fields));
  const hasFilters = Object.keys(filters).length > 0;
  const hasSorts = own !== null;
  const hasSlices = Object.keys(allSlices).length > 0;
  /** A click on a chart mark: the same step as a filter edit (so Undo covers it), one filter per column. */
  const applyChartFilters = (add: ColumnFilter[]) => {
    // A filter the column cannot take as it stands (a blank value) is left out, with the same note a filter edit gives.
    const usable = add.filter((f) => { const field = schema.find((x) => x.name === f.field); const unapplied = unappliedFilter(f, field); if (unapplied) setNote({ text: unapplied }); return !!field && !unapplied; });
    if (!usable.length) return;
    edit(() => setAllFilters((cur) => ({ ...cur, ...Object.fromEntries(usable.map((f) => [f.field, f])) })));
  };
  /** One slice per joined field; an unusable one (a blank value, a field that is not joined) is left out with the same note a filter edit gives. */
  const setSlice = useCallback((name: string, f: ColumnFilter | undefined) => {
    const field = schema.find((x) => x.name === name);
    // A slice only makes sense on a joined field (the backend refuses one on the main mart), so nothing else is stored.
    if (f && !field?.joined) return;
    const unapplied = f && field ? unappliedFilter(f, sliceField(field)) : null;
    if (unapplied) setNote({ text: unapplied });
    edit(() => setAllSlices((cur) => withEntry(cur, name, f)));
  }, [schema, edit, setNote]);
  const setFilter = useCallback((name: string, f: ColumnFilter | undefined) => {
    const unapplied = f ? unappliedFilter(f, schema.find((x) => x.name === name)) : null;
    if (unapplied) setNote({ text: unapplied });
    edit(() => setAllFilters((cur) => withEntry(cur, name, f)));
  }, [schema, edit, setNote]);
  // The suggested values of a text input: the distinct values of the column under the grid's rules without its own (a filter's menu leaves out the filter, a slice's the slice).
  const { ctx } = useServices();
  const mainKey = useMemo(() => hasPrimaryKey(native), [native]);
  const valuesFor = useCallback((field: Field, scope: 'filter' | 'slice') => {
    if (!canSuggest(field)) return null;
    // The distinct values of the rows already on the grid show at once, and still do when the mart has no key to read the rest with.
    const loaded = valuesOf(rows ?? [], field);
    if (!mainKey) return { key: JSON.stringify([martId, field.name, 'rows']), loaded };
    const without = (all: Record<string, ColumnFilter>, drop: boolean) => Object.values(all).filter((f) => !(drop && f.field === field.name));
    const filter = toTraverseFilters(schema, without(filters, scope === 'filter').filter((f) => !f.fn), without(slices, scope === 'slice'));
    const query = valuesQuery(field, filter);
    return { key: JSON.stringify([martId, query]), loaded, load: async (signal: AbortSignal) => valuesOf(await readRows(ctx, martId, query, { signal }), field) };
  }, [mainKey, schema, filters, slices, martId, ctx, rows]);
  const menuEnv = useMemo<ColumnMenuEnv>(() => {
    // The columns with a field that is not shown added where ticking it in the Fields list would put it (a joined field goes last, with its mart); null when it is shown already.
    const withField = (name: string): string[] | null => {
      if (shown.includes(name)) return null;
      return byName.get(name)?.joined ? [...shown, name] : [...ownInSchemaOrder(shown, native.map((f) => f.name), new Set([...shown.filter((c) => ownNames.has(c)), name])), ...shown.filter((c) => !ownNames.has(c))];
    };
    return {
      sorts: shownSorts, filters, slices,
      // Filter and Slice keep the columns as they are: a hidden field stays hidden and its rule still reaches the query.
      setSlice, setFilter,
      // Aggregate, Sort and Format on a field that is not a column first show it, in the same edit, so Undo takes both back.
      setSort: (field, direction) => {
        const cols = withField(field);
        if (!cols) { setSort(field, direction); return; }
        edit(() => { changeColumns(cols); setOwn(nextSorts(field, direction)); });
      },
      isAggregated: (column) => aggNow.aggregations.some((r) => r.column === column) || aggNow.dateTrunc.some((r) => r.column === column),
      draftOf: (column) => draftOf(column, aggNow),
      blockerFor: (name) => blockers.find((b) => b.name !== name)?.title,
      changeAgg: (column, draft) => {
        const cols = withField(column);
        if (!cols) { changeAgg(column, draft); return; }
        edit(() => changeColumns(cols, (cur) => applyDraft(column, draft, cur)));
      },
      formatOf, memberFormat,
      setFormat: (column, f) => {
        const cols = withField(column);
        if (cols) edit(() => changeColumns(cols));
        setFormat(column, f);
      },
      isShown: (name) => shown.includes(name),
      outputOf: (name) => outputs.find((o) => o.column === name) ?? { key: name, column: name, sortable: true },
      // The same rule as the Fields picker: the last column, and the last of the main mart's while a joined mart is shown, stay.
      canHide: (name) => shown.length > 1 && !(several && ownOn === 1 && ownNames.has(name)),
      hide: (name) => changeColumns(shown.filter((n) => n !== name)),
      canMove: (name, dir) => moveColumnBy(shown, name, dir, sources) !== shown,
      move: (name, dir) => reorder(moveColumnBy(shown, name, dir, sources)),
      typeOf: (f, o) => outputType(f, o.fn),
      sortable: !charts,
      valuesFor,
    };
  }, [valuesFor, shownSorts, setSort, filters, slices, setSlice, setFilter, aggNow, blockers, changeAgg, formatOf, memberFormat, setFormat, shown, several, ownOn, ownNames, changeColumns, sources, reorder, charts, byName, native, outputs, edit, setOwn]);
  // The selection, as Google Sheets has it: a cell (a frame and a fill handle), a block of cells (shift-click or Shift+Arrow: `to` is
  // the far end, the cell stays active), or whole columns or rows (a tint and a frame around the block); its column letters and row
  // numbers are lit. `from` is where a shift-click on a header extends from.
  type Cell = { row: number; col: number };
  const rowCount = rows?.length ?? 0;
  const inside = (c: Cell) => c.row < rowCount && c.col < outputs.length;
  // Charts has no cells to select: nothing stays lit from the table (it is cleared below too, so Table opens without it).
  const sel = !charts && selected && (selected.kind === 'cell' ? inside(selected) && (!selected.to || inside(selected.to)) : selected.kind === 'col' ? Math.max(selected.from, selected.to) < outputs.length && rowCount > 0 : Math.max(selected.from, selected.to) < rowCount) ? selected : null;
  if (charts && selected) setSelected(null);
  const cellSel = sel?.kind === 'cell' ? sel : null;
  // The cells the selection covers, from the same geometry the copy uses. A single cell has no block of its own: it has the plain frame.
  const covered = sel ? blockOf(sel, rowCount, outputs.length) : null;
  const block = covered && !(cellSel && covered.r0 === covered.r1 && covered.c0 === covered.c1) ? covered : null;
  const inCols = (i: number) => !!covered && sel!.kind !== 'row' && i >= covered.c0 && i <= covered.c1;
  const inRows = (i: number) => !!covered && sel!.kind !== 'col' && i >= covered.r0 && i <= covered.r1;
  // A header is lit light when a cell (or a block crossing it) is selected, and strong when it is itself fully selected.
  const colMark = (i: number) => (sel?.kind === 'col' ? (inCols(i) ? 'full' : undefined) : sel?.kind === 'row' ? '' : inCols(i) ? '' : undefined);
  const rowMark = (i: number) => (sel?.kind === 'row' ? (inRows(i) ? 'full' : undefined) : sel?.kind === 'col' ? '' : inRows(i) ? '' : undefined);
  // In a block, as in Sheets: the active cell is where the selection started (the clicked column's first row, the clicked
  // row's first column, or the first cell of a shift-selected block) and gets the 2px frame; the fill handle sits at the block's far corner.
  const anchor: Cell | null = sel && sel.kind !== 'cell' ? (sel.kind === 'col' ? { row: 0, col: sel.from } : { row: sel.from, col: 0 }) : block && cellSel ? { row: cellSel.row, col: cellSel.col } : null;
  const corner: Cell | null = block ? { row: block.r1, col: block.c1 } : null;
  // The selection's state in one row, as a short string: a row the selection does not change gets the same string, so it does not render.
  const marksOf = (ri: number): string => {
    const m: RowMarks = {};
    const head = rowMark(ri);
    if (head !== undefined) m.head = head;
    if (cellSel && !block && cellSel.row === ri) m.cell = cellSel.col;
    if (block && ri >= block.r0 && ri <= block.r1) m.block = [block.c0, block.c1, ri === block.r0, ri === block.r1];
    if (block && cellSel?.to?.row === ri) m.moving = cellSel.to.col;
    if (anchor?.row === ri) m.active = anchor.col;
    if (corner?.row === ri) m.handle = corner.col;
    return Object.keys(m).length ? JSON.stringify(m) : '';
  };
  const pickHeader = (kind: 'col' | 'row', i: number, extend: boolean) => setSelected((cur) => (extend && cur && cur.kind === kind ? { kind, from: cur.from, to: i } : { kind, from: i, to: i }));
  // Measured for the charts: their panels are as wide as the visible grid, not the (wider) table.
  const { ref: scroller, width: scrollerWidth } = useWidth<HTMLDivElement>(charts);
  const owner = useMemo(() => groupMap(sources), [sources]);
  const traverseFilters = useMemo(() => toTraverseFilters(schema, Object.values(filters).filter((f) => !f.fn), Object.values(slices)), [schema, filters, slices]);
  // A HAVING filter keeps whole groups, so the charts get the passing group keys as an `in` rule instead of the filter itself.
  const keysRead = useMemo(() => keysPlan(schema, shown, aggNow, Object.values(filters), Object.values(slices)), [schema, shown, aggNow, filters, slices]);
  const keyField = useMemo(() => (keysRead.kind === 'read' && keysRead.key ? schema.find((f) => f.name === keysRead.key) : undefined), [keysRead, schema]);
  // Nothing is read when the charts are not shown, a folded band, a blocked grid, or no number column to chart (ChartsBody shows its hint then).
  const chartable = useMemo(() => !chartFields(schema, shown, aggNow, martId, groups.map((g) => g.path), new Set(sources.filter((x) => x.uniqueCount).map((x) => x.aliasPath)), {}).marts.every((m) => m.metrics.length === 0 && !m.hasPk), [schema, shown, aggNow, martId, groups, sources]);
  const having = useHavingKeys(martId, keysRead, keyField, version, !charts || paused || !!blocked || !chartable);
  const chartFilter = useMemo(() => (having.rule ? [...traverseFilters, having.rule] : traverseFilters), [traverseFilters, having.rule]);
  // A HAVING filter alone counts when the charts follow it, so their "No rows match the filters." is true.
  const hasChartFilters = Object.values(filters).some((f) => !f.fn) || !!having.rule || having.gate?.kind === 'empty';
  // A click selects the cell; a shift-click stretches a block from the active cell (the one a click or a header selected) to this one,
  // and does not open another record.
  // Drag-select: a press on a cell starts a block, moving over other cells stretches it, a release anywhere ends it.
  const drag = useRef<Cell | null>(null);
  const dragMoved = useRef(false);
  const endDrag = () => {
    drag.current = null;
    // The click after a drag comes right after the release; a drag that ended elsewhere gets none, so the flag is cleared after it.
    if (dragMoved.current) setTimeout(() => { dragMoved.current = false; }, 0);
  };
  useEffect(() => {
    window.addEventListener('mouseup', endDrag);
    return () => window.removeEventListener('mouseup', endDrag);
  }, []);
  const startDrag = (row: number, col: number, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    if (e.shiftKey) { e.preventDefault(); scroller.current?.focus({ preventScroll: true }); return; }
    if ((e.target as HTMLElement).closest('a, button, input, textarea, select')) return;
    // No native text selection: the cells are what the drag selects.
    e.preventDefault();
    scroller.current?.focus({ preventScroll: true });
    drag.current = { row, col };
    dragMoved.current = false;
  };
  const dragOver = (row: number, col: number, e: React.MouseEvent) => {
    const from = drag.current;
    if (!from) return;
    // The button was let go outside the frame (no mouseup reached the window): the drag is over.
    if ((e.buttons & 1) === 0) { endDrag(); return; }
    if (from.row === row && from.col === col && !dragMoved.current) return;
    dragMoved.current = true;
    setSelected(from.row === row && from.col === col ? { kind: 'cell', ...from } : { kind: 'cell', ...from, to: { row, col } });
  };
  const pickCell = (row: number, col: number, e: React.MouseEvent) => {
    // The click that ends a drag is no click on a cell: the block stays and no record opens.
    if (dragMoved.current) { e.stopPropagation(); dragMoved.current = false; return; }
    if (e.shiftKey && sel) {
      e.stopPropagation();
      const from: Cell = sel.kind === 'cell' ? { row: sel.row, col: sel.col } : sel.kind === 'col' ? { row: 0, col: sel.from } : { row: sel.from, col: 0 };
      setSelected(from.row === row && from.col === col ? { kind: 'cell', ...from } : { kind: 'cell', ...from, to: { row, col } });
      return;
    }
    setSelected({ kind: 'cell', row, col });
  };
  useEffect(() => {
    const box = scroller.current;
    const cell = box?.querySelector<HTMLElement>('td[data-selected], td[data-moving]');
    if (!box || !cell) return;
    // The sticky header and number column cover the box's edges: the cell is kept clear of them.
    // The header's height is only known after layout, so it is written to the element here (a ref's style, not state).
    // eslint-disable-next-line react-hooks/immutability
    box.style.scrollPaddingTop = `${head.current?.offsetHeight ?? 0}px`;
    cell.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [scroller, cellSel?.row, cellSel?.col, cellSel?.to?.row, cellSel?.to?.col]);
  // Ctrl/Cmd+C: the selection goes to the clipboard as tab-separated text, as it is displayed. The copy event needs no clipboard permission,
  // so it works in the plugin's sandboxed frame. Fields, menus and a text range the reader selected inside a cell keep the browser's own copy.
  const onCopy = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!sel || !e.currentTarget.contains(target) || target.closest('thead, input, textarea, select, [role=menu], [role=dialog]')) return;
    const range = window.getSelection();
    if (range && !range.isCollapsed && range.anchorNode && e.currentTarget.contains(range.anchorNode)) return;
    const body = e.currentTarget.querySelectorAll<HTMLTableRowElement>('tbody > tr');
    const text = selectionTsv(sel, { rows: rowCount, cols: outputs.length }, {
      cell: (r, c) => body[r]?.querySelectorAll(':scope > td:not([aria-hidden])')[c]?.textContent ?? '',
      header: (c) => { const o = outputs[c]!; return outputLabel(byName.get(o.column)!, o); },
    });
    if (text === null) return;
    e.clipboardData.setData('text/plain', text);
    e.preventDefault();
  };
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
    const at: Cell | null = !sel ? null : sel.kind === 'cell' ? { row: sel.row, col: sel.col } : sel.kind === 'col' ? { row: 0, col: sel.to } : { row: sel.to, col: 0 };
    const move = (c: Cell): Cell => ({ row: Math.min(rowCount - 1, Math.max(0, c.row + step[0]!)), col: Math.min(outputs.length - 1, Math.max(0, c.col + step[1]!)) });
    if (e.shiftKey && sel?.kind === 'cell') {
      // Shift+Arrow moves the far end of the block; the first cell stays active, and a block shrunk to that cell is a plain cell again.
      const far = move(sel.to ?? sel);
      setSelected(far.row === sel.row && far.col === sel.col ? { kind: 'cell', row: sel.row, col: sel.col } : { kind: 'cell', row: sel.row, col: sel.col, to: far });
      return;
    }
    setSelected({ kind: 'cell', ...(at ? move(at) : { row: 0, col: 0 }) });
  };

  const openRow = (row: Row) => {
    if (dragMoved.current) return;
    dispatch({ type: 'openRecord', martId, sourceOf: sourceOfModel(model), pk: Object.fromEntries(pks.map((k) => [k, row[k]])) });
  };
  // The rows are memoised, so what they call must keep its identity: they reach the latest handlers through this one object.
  const latest = useLatest({ startDrag, dragOver, pickCell, pickHeader, openRow });
  const rowActs = useMemo<RowActs>(() => ({
    startDrag: (r, c, e) => latest.current.startDrag(r, c, e),
    dragOver: (r, c, e) => latest.current.dragOver(r, c, e),
    pickCell: (r, c, e) => latest.current.pickCell(r, c, e),
    pickRow: (r, e) => { latest.current.pickHeader('row', r, e.shiftKey); if (e.shiftKey) e.stopPropagation(); },
    open: (row) => latest.current.openRow(row),
  }), [latest]);
  const clickable = pks.length > 0 && !grouped;

  return (
    <GridEnv.Provider value={env}>
    <ColumnMenuEnvContext.Provider value={menuEnv}>
    {/* The table's last measured height is a ref on purpose: a re-render on every resize would reach an open column menu and drop its Apply. */}
    {/* eslint-disable-next-line react-hooks/refs */}
    <div ref={frame} className={`dm-grid-frame flex max-h-[32rem] min-h-0 flex-col${charts ? ' dm-grid-frame-charts' : ''}`} style={charts && tableHeight.current ? { height: tableHeight.current } : undefined}>
      <Toast onDismiss={() => setNote(null)} stamp={note} returnTo={() => scroller.current}>{note?.text}</Toast>
      <BandTools slot={slot}>
        <button type="button" disabled={!hasFilters && !hasSorts && !hasSlices} onClick={() => edit(() => { setAllFilters({}); setAllSlices({}); setOwn(null); })} className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => { onRefresh(); setJoinsFailed(false); setRefreshTick((n) => n + 1); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border bg-card px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        {!blocked && <ExportMenu martId={martId} martTitle={model.marts.get(martId)?.title ?? martId} schema={schema} visible={shown} aggregation={aggNow} filters={Object.values(filters)} slices={Object.values(slices)} sorts={gridSorts} ownSorts={own ?? NO_SORTS} rows={rows} hasMore={hasMore} loading={loading} run={run} storage={martStorage} joinsFailed={joinsFailed && !joinsRead} sources={joinsRead ? sources : undefined} edges={model.edges} titles={martTitles} joinedMarts={joinedMarts} />}
      </BandTools>
      {loading && <div role="progressbar" aria-label="Loading rows" className="dm-progress" />}
      <div ref={scroller} tabIndex={0} onKeyDown={charts ? undefined : onGridKey} onCopy={charts ? undefined : onCopy} className={`dm-grid-root min-h-0 flex-1 overflow-auto ${loading && rows ? 'opacity-60' : ''}`}>
        <table className="dm-grid w-full border-collapse">
          <thead ref={head} className="dm-head sticky top-0 z-10">
            <tr aria-hidden data-chrome>
              <th data-chrome rowSpan={3} className="dm-chrome dm-corner" />
              {outputs.map((o, i) => <th key={o.key} data-chrome data-letter-column={o.column} data-selected={colMark(i)} onClick={charts ? undefined : (e) => pickHeader('col', i, e.shiftKey)} className="dm-chrome dm-letter">{columnLetter(i)}</th>)}
              <th data-chrome className="dm-chrome dm-letter w-full" />
            </tr>
            <tr data-group-row>
                {groups.map((g, i) => (
                  <th key={g.path} data-group={g.id} data-group-path={g.path} colSpan={g.span} scope="colgroup" onClick={(e) => {
                    // Only the title itself: the Fields and Remove buttons, and clicks inside the Fields popover (portalled, but bubbling through React), keep the selection.
                    const t = e.target as HTMLElement;
                    if (!e.currentTarget.contains(t) || t.closest('button')) return;
                    if (selected?.kind === 'col' || selected?.kind === 'row') setSelected(null);
                  }} className="dm-gh dm-gh-edge overflow-hidden px-1 py-1 text-left font-semibold">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="inline-flex shrink-0 text-muted-foreground"><PickedIcon icon={g.icon} fallback={Box} size={14} /></span>
                      <span className="truncate">{g.title}</span>
                      <MartRuleMarks title={g.title} fields={fieldsOf(g)} filters={filters} slices={slices} expanded={fieldsOpen === g.path} onOpen={(mark) => { openedBy.current = mark; setFieldsOpen(g.path); }} />
                      {g.description?.trim() && <span className="dm-reveal"><Hint text={g.description} label={`About ${g.title}`} /></span>}
                      <ColumnPicker title={g.title} fields={fieldsOf(g)} main={g.main} visible={shown} locked={(n) => g.main && several && ownOn === 1 && ownNames.has(n)} onChange={changeColumns} unique={g.main ? uniqueKey : undefined} agg={agg} open={fieldsOpen === g.path} onOpenChange={(o) => {
                        setFieldsOpen((cur) => (o ? g.path : cur === g.path ? null : cur));
                      }} onCloseAutoFocus={(e) => {
                        // A list opened from a rule mark gives focus back to that mark, not to the Fields button. Focus the member already moved elsewhere (a Tab out of the list) stays where it went.
                        const m = openedBy.current;
                        openedBy.current = null;
                        const a = document.activeElement;
                        const lost = !a || a === document.body || !!(e.currentTarget as Element | null)?.contains(a);
                        if (m?.isConnected && lost) { e.preventDefault(); m.focus(); }
                      }} />
                      {(several || !g.main) && (
                        <Tooltip content={`Remove ${g.title} from the grid`}>
                          <button type="button" aria-label={`Remove ${g.title} from the grid`} data-remove disabled={removing} onClick={() => remove(g, i)} className="dm-reveal dm-gx"><X className="size-3.5" aria-hidden /></button>
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
                {hg.headers.map((h) => {
                  const c = columnByKey.get(h.column.id)!;
                  return <th key={h.id} data-column={c.output.column} aria-sort={!charts && c.output.sortable ? sortOf(shownSorts, c.output.column) : 'none'} className={`dm-th ${c.maxWidth} overflow-hidden text-left font-medium`}><HeaderCell field={c.field} output={c.output} lead={c.lead} /></th>;
                })}
                {/* Takes the width the columns leave over, so the line under the header runs the whole card. */}
                <th aria-hidden className="dm-th dm-th-fill w-full p-0" />
              </tr>
            ))}
          </thead>
          {/* ChartsBody renders its own <tbody>: nesting one in another makes the parser pull the headers out of the table. */}
          {charts && !blocked ? <ChartsBody pruneRef={pruneCards} martId={martId} schema={schema} shown={shown} agg={aggNow} filter={chartFilter} havingNote={having.fallback} gate={having.gate} groups={groups} version={version} paused={paused} hasFilters={hasChartFilters} sources={sources} formatOf={formatOf} scrollerWidth={scrollerWidth} onFilter={applyChartFilters} onShowColumns={showColumns} />
          : <tbody>
            {blocked ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4 text-sm text-muted-foreground" role="alert">{`"${columnTitle(blocked)}" can't be grouped: hide it. Array, JSON and struct fields take no aggregation.`}</td></tr>
              : error ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} context={{ dataMartId: martId, options: asked, runId: errorRunId }} /></td></tr>
              : !rows ? <tr><Gutter /><td colSpan={outputs.length + 1}><Skeleton rows={8} /></td></tr>
              : rows.length === 0 ? <tr><Gutter /><td colSpan={outputs.length + 1} className="p-4 text-sm text-muted-foreground">{emptyText(hasFilters)}</td></tr>
              : table.getRowModel().rows.map((r, ri) => <GridRow key={r.id} row={r.original} ri={ri} columns={columnViews} marks={marksOf(ri)} acts={rowActs} clickable={clickable} />)}
          </tbody>}
        </table>
        <ColumnDragLayer scroller={scroller} head={head} groupOf={owner} onMove={(name, before) => reorder(moveColumn(shown, name, before, sources))} />
        {!charts && !error && !blocked && hasMore && <div className="p-3 text-center"><button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Load more</button></div>}
      </div>
    </div>
    </ColumnMenuEnvContext.Provider>
    </GridEnv.Provider>
  );
}
