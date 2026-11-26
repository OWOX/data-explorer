import { useCallback, useEffect, useRef, useState } from 'react';
import { withJoined, type JoinedSource } from '../../api/blendable';
import type { SavedView } from '../../api/grid-columns';
import { defaultColumns } from '../../model/columns';
import { keepEmpty } from '../../model/empty-paths';
import { keepVisible, NO_AGGREGATION, sanitizeAggregation, type Aggregation } from '../../model/aggregation';
import type { Schema } from '../../model/types';
import { orderColumns } from '../../state/column-order';
import { useServices, type GridState } from '../../state/store';
import { pruneGrid } from '../../state/view-link-resolve';
import { ErrorBox } from '../ErrorBox';
import { Skeleton } from '../Skeleton';
import { Grid, aggOf, type GridProps } from './MartGrid';

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


/** The grid for one mart: loads the schema, then reads rows. Key it by mart id. */
export function MartGrid({ martId, model, seed, onChange, onHold, onRebase, onRelease, onRows, onMatched, onTotal, onRecount, paused = false }: GridProps & { /** The band is folded: nothing is read until it opens. */ paused?: boolean }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error, failure } = useSchema(martId, schemaVersion);
  const { schemas, blendable } = useServices();
  // Refresh also forgets what was read of this mart's schema and joins (Join Settings or a field list may have changed since).
  const refreshMart = useCallback(() => { schemas.invalidate(martId); blendable.invalidate(martId); setSchemaVersion((v) => v + 1); }, [schemas, blendable, martId]);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <SeededGrid martId={martId} model={model} schema={schema} seed={seed} onChange={onChange} onHold={onHold} onRebase={onRebase} onRelease={onRelease} onRows={onRows} onMatched={onMatched} onTotal={onTotal} onRecount={onRecount} paused={paused} onRefresh={refreshMart} refreshError={failure} />;
}

/** A saved-columns read slower than this is given up on for this mount. */
export const SAVED_COLUMNS_WAIT_MS = 3000;
/** The longest a saved view's read holds the grid's saves; past it the edit is saved as it stands. */
export const VIEW_HOLD_MAX_MS = 10000;

/** The names in `saved` the mart still offers, in the saved order. */
const offered = (schema: Schema, saved: string[]) => saved.filter((c) => schema.some((f) => f.name === c));

/** Whether a saved grid names something the mart's own schema does not have: a joined field, so the joined marts must be read first. */
const namesJoined = (schema: Schema, saved: GridState | undefined) =>
  !!saved && [...saved.columns, ...Object.keys(saved.filters), ...Object.keys(saved.slices ?? {}), ...(saved.sorts ?? []).map((x) => x.field)].some((n) => !schema.some((f) => f.name === n));

type Initial = { columns: string[]; cleaned: string[] | null; sources: JoinedSource[] | null; agg: Aggregation; /** The member's saved view (filters, slices, sort, limit, Table/Charts), pruned to the fields on offer; only when the page holds no grid for the mart. */ saved?: GridState };


/**
 * Settles the first column set before the grid mounts, so the first rows query is the only one:
 * this session's columns, else the member's saved ones (read once, at most 3 s), else the defaults.
 * A column saved from a joined mart waits for the joined marts to be read (inside the same 3 s): a read that
 * fails leaves those columns out of this visit without erasing them from what is saved.
 * A joined mart saved with no column is not waited for: it is parked in the grid until the joined marts are read.
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
          // Every offered column counts as shown above, so the empty paths are judged by what the mart offers alone (the grid drops one that has a column). With the joined marts unread they are parked as saved.
          const emptyPaths = known ? keepEmpty(v.emptyPaths, full, []) : v.emptyPaths ?? [];
          return out ? { filters: out.filters, ...(out.slices ? { slices: out.slices } : {}), sorts: out.sorts, limit: v.limit, ...(v.view ? { view: v.view } : {}), ...(out.uniqueCount ? { uniqueCount: out.uniqueCount } : {}), ...(emptyPaths.length ? { emptyPaths } : {}) } : v;
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
        // Saved empty marts are not waited for: with the joined marts unread they are parked in the grid and judged once the joins arrive.
        savedGrid = failed ? g : { ...(pruneGrid(g, full).grid ?? g), ...(!sources && stored.emptyPaths ? { emptyPaths: stored.emptyPaths } : {}) };
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
