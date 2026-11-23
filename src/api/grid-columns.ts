import { isRecord, strings } from '../model/guards';
import { isAggFn, isDateBucket, isTimeZone, NO_AGGREGATION, type Aggregation } from '../model/aggregation';
import type { Ctx } from '../sdk/types';
import type { ColumnFilter } from '../filters/build';
import type { SortKey } from '../model/sort';
import { decodeRule, ruleTuple } from '../state/view-link';
import { clampLimit } from '../state/view-link-resolve';

export const GRID_COLUMNS_COLLECTION = 'grid-columns';
export const SAVE_DEBOUNCE_MS = 500;
/** The joined fields last chosen for each joined data mart, per main data mart: `{ customers: ['customers__city'] }`. An empty list means "none, use the default next time". */
export type Picks = Record<string, string[]>;
/** What the grid shows besides its columns and aggregations: the rules, the sort, the row limit and the Table/Charts switch. */
export type SavedView = { filters: Record<string, ColumnFilter>; slices?: Record<string, ColumnFilter>; /** null: the member set no sort. */ sorts: SortKey[] | null; limit: number; view?: 'charts'; /** The alias paths whose data mart's Unique Count is on. */ uniqueCount?: string[] };
/** A SavedView as stored: rules as the view link's tuples (`fl`, `sl`), sorts as [field, 1 | -1], `vw` 1 for Charts. */
type StoredView = { fl: unknown[][]; sl?: unknown[][]; s: [string, 1 | -1][] | null; l: number; vw?: 1; /** Unique Count alias paths. */ uc?: string[] };
type ColumnsDoc = { columns: string[]; at: string; picks?: Picks; lastShown?: string[]; aggregations?: unknown; dateTrunc?: unknown; gridView?: unknown };

export interface ColumnStore {
  /** The member's saved column names for a mart, or null when there are none or the read failed. */
  load(martId: string): Promise<string[] | null>;
  /** The joined fields last chosen per joined data mart for this main data mart (read once; empty when none or the read failed). */
  loadPicks(martId: string): Promise<Picks>;
  /** The mart's OWN field names as they were shown when it last left the grid (as main or as a joined mart); null when none was remembered or it is not read yet. */
  lastShown(martId: string): string[] | null;
  /** Reads what `lastShown` serves (once per mart; a failure reads as none). */
  loadLastShown(martId: string): Promise<string[] | null>;
  /** Remembers the own field names a mart was showing when it left the grid; null forgets them. Saved with the same pause as `save`. */
  saveLastShown(martId: string, fields: string[] | null): void;
  /** The member's saved aggregations and date buckets for a mart (none when absent or the read failed). */
  loadAggregation(martId: string): Promise<Aggregation>;
  /** What `loadAggregation` read, with this session's changes. */
  aggregation(martId: string): Aggregation;
  /** Saves the grid's aggregations and date buckets with the same pause as `save`. */
  saveAggregation(martId: string, aggregation: Aggregation): void;
  /** The member's saved filters, slices, sort, row limit and view for a mart (null when none or the read failed). */
  loadView(martId: string): Promise<SavedView | null>;
  /** Saves the grid's view with the same pause as `save`. */
  saveView(martId: string, view: SavedView): void;
  /** Saves after a short pause; the last call for a mart wins. `picks` merges into the remembered joined picks. Never throws. */
  save(martId: string, columns: string[], picks?: Picks): void;
}

const validAggregation = (doc: { aggregations?: unknown; dateTrunc?: unknown } | undefined): Aggregation => {
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => isRecord(x) && typeof x.column === 'string') : []);
  const aggregations = list(doc?.aggregations).flatMap((r) => (isAggFn(r.function) ? [{ column: r.column as string, function: r.function }] : []));
  // A bucket needs a known unit and, when it has a time zone, one the backend accepts; a column takes functions or a bucket, never both.
  const dateTrunc = list(doc?.dateTrunc).flatMap((r) => (isDateBucket(r.unit) && (r.timeZone === undefined || isTimeZone(r.timeZone)) && !aggregations.some((a) => a.column === r.column) ? [{ column: r.column as string, unit: r.unit, ...(r.timeZone !== undefined ? { timeZone: r.timeZone as string } : {}) }] : []));
  return aggregations.length || dateTrunc.length ? { aggregations, dateTrunc } : NO_AGGREGATION;
};

const encodeView = (v: SavedView): StoredView => ({
  fl: Object.entries(v.filters).map(([field, f]) => ruleTuple(field, f, true)),
  ...(v.slices && Object.keys(v.slices).length ? { sl: Object.entries(v.slices).map(([field, f]) => ruleTuple(field, f, false)) } : {}),
  s: v.sorts && v.sorts.map((x): [string, 1 | -1] => [x.field, x.direction === 'asc' ? 1 : -1]),
  l: v.limit,
  ...(v.view === 'charts' ? { vw: 1 as const } : {}),
  ...(v.uniqueCount?.length ? { uc: v.uniqueCount } : {}),
});

const plainName = (c: unknown): string | null => (typeof c === 'string' ? c : null);

/** A stored view with malformed rules, sorts and values left out; null when the stored shape is not a view at all. */
const validView = (raw: unknown): SavedView | null => {
  if (!isRecord(raw) || !Array.isArray(raw.fl) || !(raw.s === null || Array.isArray(raw.s)) || typeof raw.l !== 'number' || !Number.isFinite(raw.l)) return null;
  const rules = (list: unknown, withFn: boolean): [string, ColumnFilter][] =>
    (Array.isArray(list) ? list : []).flatMap((e) => { const r = decodeRule(e, withFn, plainName); return r ? [[r.field, r] as [string, ColumnFilter]] : []; });
  const slices = rules(raw.sl, false);
  const sorts = raw.s === null ? null : (raw.s as unknown[]).flatMap((e): SortKey[] => (Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && (e[1] === 1 || e[1] === -1) ? [{ field: e[0], direction: e[1] === 1 ? 'asc' : 'desc' }] : []));
  const uniqueCount = Array.isArray(raw.uc) ? [...new Set(raw.uc.filter((p): p is string => typeof p === 'string'))] : [];
  return { filters: Object.fromEntries(rules(raw.fl, true)), ...(slices.length ? { slices: Object.fromEntries(slices) } : {}), sorts, limit: clampLimit(raw.l), ...(raw.vw === 1 ? { view: 'charts' as const } : {}), ...(uniqueCount.length ? { uniqueCount } : {}) };
};

const validPicks = (raw: unknown): Picks => {
  if (!isRecord(raw)) return {};
  return Object.fromEntries(Object.entries(raw).flatMap(([k, v]) => (Array.isArray(v) ? [[k, strings(v)]] : [])));
};

export function createColumnStore(ctx: Ctx): ColumnStore {
  const col = ctx.collections<ColumnsDoc>(GRID_COLUMNS_COLLECTION);
  const cache = new Map<string, string[] | null>();
  const picked = new Map<string, Picks>();
  const patches = new Map<string, Picks>();
  const shownBy = new Map<string, string[] | null>();
  const aggBy = new Map<string, Aggregation>();
  const viewBy = new Map<string, SavedView | null>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const reads = new Map<string, Promise<string[] | null>>();
  /** Marts whose stored doc was read successfully (or found absent); a put over one that was never read could erase it. */
  const readOk = new Set<string>();

  async function read(martId: string): Promise<string[] | null> {
    try {
      const found = await col.get(martId);
      const doc = found?.document;
      readOk.add(martId);
      const columns = Array.isArray(doc?.columns) ? doc.columns.filter((c) => typeof c === 'string') : null;
      // A save that landed while the read was out is newer than what it read.
      if (!cache.has(martId)) cache.set(martId, columns);
      if (!picked.has(martId)) picked.set(martId, validPicks(doc?.picks));
      if (!aggBy.has(martId)) aggBy.set(martId, validAggregation(doc));
      if (!viewBy.has(martId)) viewBy.set(martId, validView(doc?.gridView));
      if (!shownBy.has(martId)) shownBy.set(martId, Array.isArray(doc?.lastShown) ? doc.lastShown.filter((x): x is string => typeof x === 'string') : null);
      return cache.get(martId)!;
    } catch {
      return null;
    } finally {
      reads.delete(martId);
    }
  }

  function load(martId: string): Promise<string[] | null> {
    if (cache.has(martId) && picked.has(martId) && shownBy.has(martId) && aggBy.has(martId) && viewBy.has(martId)) return Promise.resolve(cache.get(martId)!);
    // Concurrent loads (StrictMode mounts twice) share one read.
    let pending = reads.get(martId);
    if (!pending) { pending = read(martId); reads.set(martId, pending); }
    return pending;
  }

  const picksOf = (martId: string): Picks => ({ ...picked.get(martId), ...patches.get(martId) });

  return {
    load(martId) {
      // A list saved in this session is served from memory (the picks, if wanted, are read when they are).
      if (cache.has(martId)) return Promise.resolve(cache.get(martId)!);
      return load(martId);
    },
    async loadPicks(martId) {
      if (!picked.has(martId)) await load(martId);
      return picksOf(martId);
    },
    aggregation: (martId) => aggBy.get(martId) ?? NO_AGGREGATION,
    async loadAggregation(martId) {
      if (!aggBy.has(martId)) await load(martId);
      return aggBy.get(martId) ?? NO_AGGREGATION;
    },
    saveAggregation(martId, aggregation) {
      aggBy.set(martId, aggregation);
      schedule(martId);
    },
    async loadView(martId) {
      if (!viewBy.has(martId)) await load(martId);
      return viewBy.get(martId) ?? null;
    },
    saveView(martId, view) {
      viewBy.set(martId, view);
      schedule(martId);
    },
    lastShown: (martId) => shownBy.get(martId) ?? null,
    async loadLastShown(martId) {
      if (!shownBy.has(martId)) await load(martId);
      return shownBy.get(martId) ?? null;
    },
    saveLastShown(martId, fields) {
      shownBy.set(martId, fields);
      schedule(martId);
    },
    save(martId, columns, picks) {
      cache.set(martId, columns);
      if (picks) patches.set(martId, { ...patches.get(martId), ...picks });
      schedule(martId);
    },
  };

  function schedule(martId: string) {
    clearTimeout(timers.get(martId));
    timers.set(martId, setTimeout(() => {
      timers.delete(martId);
      Promise.resolve()
        .then(async () => {
          // What was never read is read first, so a save of one part does not erase the others.
          if (!readOk.has(martId) || !picked.has(martId) || !shownBy.has(martId) || !aggBy.has(martId) || !viewBy.has(martId)) await load(martId);
          // The stored doc could not be read: writing would replace it with what this session knows alone. The change stays in memory.
          if (!readOk.has(martId)) return;
          const merged = picksOf(martId);
          picked.set(martId, merged);
          patches.delete(martId);
          const shown = shownBy.get(martId);
          const agg = aggBy.get(martId) ?? NO_AGGREGATION;
          const view = viewBy.get(martId);
          await col.put(martId, { columns: cache.get(martId) ?? [], at: new Date().toISOString(), ...(Object.keys(merged).length ? { picks: merged } : {}), ...(shown ? { lastShown: shown } : {}), ...(agg.aggregations.length ? { aggregations: agg.aggregations } : {}), ...(agg.dateTrunc.length ? { dateTrunc: agg.dateTrunc } : {}), ...(view ? { gridView: encodeView(view) } : {}) });
        })
        .catch((e) => console.warn('Saving the column selection failed', e));
    }, SAVE_DEBOUNCE_MS));
  }
}
