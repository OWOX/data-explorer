import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ColumnFilter } from '../filters/build';
import type { JoinedSource } from '../api/blendable';
import type { Aggregation, DateBucket } from '../model/aggregation';
import type { Format } from '../format/formats';
import type { Field, Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { useServices, useStore } from '../state/store';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { chartSetsOf } from './chartSets';
import type { HavingKeys } from './havingKeys';
import type { MenuItem } from './ChartMenu';
import { addChartItem, chartListItem, dropPicksOf, hideCard, setCardDate, setCardMetric, tailItems } from './listMenu';
import { joinGrainOf, stable } from './answers';
import { carriedDates, MartCards, useScorecards } from './Scorecards';
import { rangeKeys } from './queries';
import { KINDS } from './kinds';
import { chartsOf, patchChart, scorecardsOf, type ChartSettings, type ChartSpec, type Spark } from './settings';
import { ChartSeenContext } from './ChartPanel';
import { ChartFrameContext, type ChartSize } from './resize';
import { CarriedRanges, useBucketFrom } from './useBucket';
import type { ChartResult } from './useChartQuery';

/** The gutter cell of a row that is not a data row; the grid has the same one. */
const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;
/** The gutter's width (`.dm-grid tbody .dm-chrome` in bands.css). */
const GUTTER_PX = 46;

/** A mart a joined path passes through with no column of its own on the grid: it has no group there, only a place in the chart menus. */
type PathMart = { path: string; title: string; icon?: string | null };
const NO_SIZE: ChartSize = {};
const NO_PATH_MARTS: PathMart[] = [];

/**
 * The Charts mode's `<tbody>`: a strip of scorecards, one cell per data mart under that mart's header, then the panels
 * on a row of their own, as wide as the visible grid and pinned left so a wide table does not push them out of view.
 * Each panel is as wide as its content needs and the panels wrap onto more rows when the band is narrow.
 * Settings load once per mart; a fallback a kind's `resolve` picks is never written back, only the member's own changes are.
 */
export function ChartsBody({ martId, schema, shown, agg, filter, havingNote = false, gate = null, blockedNote = null, groups, reportGroups = groups, pathMarts = NO_PATH_MARTS, renderConfig, version, paused, hasFilters, sources, kept, formatOf, scrollerWidth, onFilter, pruneRef }: {
  martId: string; schema: Schema; shown: string[]; agg: Aggregation; filter: TraverseFilter[]; /** The grid has a filter on an aggregate that the charts cannot follow for this grouping. */ havingNote?: boolean; /** Stands in for the charts while the passing group keys load, fail to load, or are none. */ gate?: HavingKeys['gate']; groups: { id: string; path: string; span: number; title: string; icon?: string | null }[]; /** The groups plus the main data mart, first, when it has no column: the charts always have its fields. Absent: `groups`. */ reportGroups?: PathMart[]; /** The middle marts of the joined paths, and the marts kept with no column, that show none: the menus list their fields after the groups', where a first column of theirs would land. */ pathMarts?: PathMart[]; version: number; paused: boolean; hasFilters: boolean; sources: JoinedSource[]; /** The alias paths of the marts kept with no column that have a usable key: their count rides on the scorecard read. */ kept?: readonly string[];
  formatOf: (column: string, type: string) => Format; scrollerWidth: number;
  /** Applies the clicked mark's filters to the grid, as a filter edit (one Undo step). */
  onFilter: (add: ColumnFilter[]) => void;
  /** Set while the grid cannot be grouped (a shown array, JSON or struct column with a function on another): the body says why and reads nothing. */
  blockedNote?: string | null;
  /** The config menu: the grid builds it and this body places it, once, on every return path, so an open menu survives a gate or an empty hint coming and going. The Add chart and Charts rows are passed once the saved settings have loaded. */
  renderConfig: (chartItems?: MenuItem[]) => ReactNode;
  /** The grid hands over the columns the member just hid; the card picks that named them go in one write. Set while this body is mounted. */
  pruneRef?: { current: ((hidden: string[]) => boolean) | null };
}) {
  const { chartSettings } = useServices();
  const [store, dispatch] = useStore();
  const [settings, setSettings] = useState<ChartSettings | null>(null);
  // Changes apply over the latest doc (not a render's copy), so two quick changes both land.
  const latest = useRef<ChartSettings | null>(null);
  useEffect(() => {
    let live = true;
    chartSettings.load(martId).then((loaded) => {
      if (!live) return;
      // The saved doc always wins on a mount: an Undo made while this was closed was saved when it happened, and a copy kept since may be older than a save from another tab.
      latest.current = loaded;
      setSettings(loaded);
      dispatch({ type: 'saveCharts', martId, settings: loaded });
    });
    return () => { live = false; };
  }, [chartSettings, martId, dispatch]);
  // Undo and Redo put other settings in the store: they come on screen (the store saves them). A member edit stores the same object it holds, so it is not seen here.
  const held = store.charts[martId];
  useEffect(() => {
    if (!held || !latest.current || held === latest.current) return;
    latest.current = held;
    setSettings(held);
  }, [held]);
  // Only called once the doc has loaded (the menu is not shown before), so a change never replaces what was saved.
  // A member's edit is one Undo step. `stage` is a write that goes with a grid edit recorded next (the prune of a hidden column): it is part of that step. `fold` joins consecutive edits into one step.
  const change = (edit: (cur: ChartSettings) => ChartSettings, how: { stage?: boolean; fold?: string } = {}) => {
    if (!latest.current) return;
    const next: ChartSettings = edit(latest.current);
    latest.current = next;
    setSettings(next);
    dispatch(how.stage ? { type: 'stageCharts', martId, settings: next } : { type: 'editCharts', martId, settings: next, ...(how.fold ? { fold: how.fold } : {}) });
    chartSettings.save(martId, next);
  };

  // Resize mode: every panel shows its handles. It ends with Escape, a press outside the charts, or the menu's Done resizing.
  const [resizing, setResizing] = useState(false);
  const cancelDrag = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (!resizing) return;
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('[data-column-menu]')) return;
      // Escape is spent here: it must not also leave full screen or clear a selection. Mid-drag it only puts the size back.
      e.stopPropagation();
      e.preventDefault();
      if (cancelDrag.current) cancelDrag.current(); else setResizing(false);
    };
    const press = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || t.closest('section.dm-chart, [data-column-menu]')) return;
      // A press on a scrollbar lands on the box it scrolls, past its content.
      const box = t.getBoundingClientRect();
      if (t instanceof HTMLElement && (e.clientX - box.left > t.clientLeft + t.clientWidth || e.clientY - box.top > t.clientTop + t.clientHeight) && (t.scrollHeight > t.clientHeight || t.scrollWidth > t.clientWidth)) return;
      setResizing(false);
    };
    window.addEventListener('keydown', key, true);
    document.addEventListener('pointerdown', press, true);
    return () => { window.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', press, true); };
  }, [resizing]);

  // A pick whose column the member hides goes with it, in the same action. Only the member's own edit prunes: a failed or late read of the columns never erases what is saved.
  useEffect(() => {
    if (!pruneRef) return;
    // False while the saved settings are not loaded: the grid then prunes through the store, as when Charts is closed.
    pruneRef.current = (hidden) => { const gone = new Set(hidden); if (!latest.current) return false; if (dropPicksOf(latest.current, gone) !== latest.current) change((cur) => dropPicksOf(cur, gone), { stage: true }); return true; };
    return () => { pruneRef.current = null; };
  });
  // A resize re-renders this body on every step: the fields and the resolved choices only change with their inputs, so a resize rebuilds neither.
  // `cf` (the shown columns) feeds the scorecards, `chart` (every field of the report's marts) the charts: see `chartSetsOf`.
  const { cf, chart } = useMemo(() => chartSetsOf(schema, shown, agg, martId, groups, reportGroups, pathMarts, sources), [schema, shown, agg, martId, groups, reportGroups, pathMarts, sources]);
  // A calculated metric is read as a metric, not as a group key, as the grid's own count ask reads it.
  const joins = useMemo(() => joinGrainOf(sources, new Set(cf.marts.flatMap((m) => m.metrics.filter((x) => !x.fn).map((x) => x.field.name)))), [sources, cf]);
  const specs = chartsOf(settings ?? {});
  // Hidden charts resolve to nothing, so they mount no panel and read nothing.
  const drawn = useMemo(() => specs.map((spec) => {
    const def = KINDS[spec.kind];
    return { spec, def, r: spec.hidden ? null : def.resolve(spec, chart) };
  }), [specs, chart]);
  // The sparklines draw on the first shown chart's date and bucket; with none, the first date shown, by Auto.
  const lead = drawn.find((d) => d.r && (d.r as { date?: unknown }).date)?.r as { date: Field; bucket?: DateBucket | 'AUTO' } | undefined;
  const spark: Spark = useMemo(() => ({ ...scorecardsOf(settings ?? {}), date: lead?.date ?? cf.dates[0] ?? null }), [settings, lead?.date, cf]);
  // Nothing is read until the member's saved choices are known: a read with the defaults would be billed and then thrown away.
  const idle = paused || !settings || !!gate || !!blockedNote;
  // The scorecard read goes first (effects run in call order): it carries the first and last value of the Auto dates, so they need no read of their own.
  const ranges = useMemo(() => carriedDates(cf, spark, (lead?.bucket ?? 'AUTO') === 'AUTO', kept), [cf, spark, lead?.bucket, kept]);
  const scores = useScorecards(martId, cf, filter, version, idle, joins, kept, ranges);
  const carriedFilter = stable(filter);
  const carried = useCallback((date: Field, f: TraverseFilter[], v: number): ChartResult | null => {
    if (v !== version || !ranges.some((d) => d.name === date.name) || stable(f) !== carriedFilter) return null;
    // Rows that came without the keys (a cached read of the same ask without ranges) cannot give the range: the date reads it itself.
    const row = scores.rows?.[0];
    if (row && !(rangeKeys(date).min in row && rangeKeys(date).max in row)) return null;
    return scores;
    // scores is a new object each render; only its parts decide the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, ranges, carriedFilter, scores.rows, scores.error, scores.loading, scores.retry]);
  const { bucket, pending: bucketPending } = useBucketFrom(carried, martId, spark.date, lead?.bucket ?? 'AUTO', filter, version, idle);
  // The Charts group of the config menu names every chart, hidden ones included; memoized so a resize resolves nothing again.
  const resolved = useMemo(() => drawn.map(({ spec, def }) => {
    const r = def.resolve({ ...spec, hidden: false }, chart);
    return { spec, title: r ? def.title(r, chart) : null };
  }), [drawn, chart]);
  const leadBucket = lead?.bucket ?? 'AUTO';
  // `change` reads the latest-doc ref, but the rows only call it from handlers, never while rendering.
  // eslint-disable-next-line react-hooks/refs
  const chartItems = settings ? [addChartItem({ cf: chart, change }), chartListItem({ cf, settings, resolved, change })] : undefined;
  const columns = groups.reduce((n, g) => n + g.span, 0);

  // The menu sits first in every return, so it keeps its place (and its open panels) whichever body is drawn.
  const place = (tbody: ReactNode) => <>{renderConfig(chartItems)}{tbody}</>;
  if (blockedNote) {
    return place(<tbody><tr><Gutter /><td colSpan={columns + 1} className="p-4 text-sm text-muted-foreground" role="alert">{blockedNote}</td></tr></tbody>);
  }
  if (chart.marts.every((m) => m.metrics.length === 0 && !m.hasPk)) {
    return place(<tbody><tr><Gutter /><td colSpan={columns + 1} data-chart-empty className="text-sm text-muted-foreground">The data marts have no number field to chart.</td></tr></tbody>);
  }
  if (gate) {
    return place(
      <tbody><tr><Gutter /><td colSpan={columns + 1} data-chart-empty className="text-sm text-muted-foreground">
        {gate.kind === 'loading' ? <Skeleton rows={2} /> : gate.kind === 'error' ? <ErrorBox error={gate.error} onRetry={gate.retry} /> : 'No rows match the filters.'}
      </td></tr></tbody>,
    );
  }

  return place(
    <CarriedRanges value={carried}>
    <tbody>
      <tr data-chart-strip>
        <Gutter />
        {groups.map((g, i) => (
          <td key={g.path} colSpan={g.span} data-chart-group={g.id} data-chart-path={g.path}>
            <div className="flex items-start gap-1">
              <MartCards martId={martId} mart={cf.marts[i]!} main={g.path === ''} spark={spark} scores={scores} bucket={bucket} bucketPending={bucketPending} autoBucket={leadBucket === 'AUTO'} filter={filter} version={version} paused={idle} joins={joins} hasFilters={hasFilters} formatOf={formatOf}
                onMetric={settings ? (id, v) => change((cur) => setCardMetric(cur, id, v, cf.marts[i]!)) : undefined}
                onDate={settings ? (id, v) => change((cur) => setCardDate(cur, id, v, cf.marts[i]!, spark)) : undefined} onHide={settings ? (id) => change((cur) => hideCard(cur, id)) : undefined} />
            </div>
          </td>
        ))}
        <td aria-hidden />
      </tr>
      <tr data-chart-panels-row>
        <Gutter />
        <td colSpan={columns + 1} data-chart-panels-cell>
          {/* Pinned just right of the row-number gutter and as wide as the rest of the scroller, so the panels line up with
              the scorecards (the same 0.75rem inset) and stay in view however wide the table is. */}
          <div data-chart-panels data-resizing={resizing || undefined} className="dm-chart-panels sticky" style={{ left: GUTTER_PX, width: Math.max(0, scrollerWidth - GUTTER_PX) }}>
            {drawn.map(({ spec, def, r }, i) => r ? (
              <ChartFrameContext key={spec.id} value={{ size: spec.size ?? NO_SIZE, resizing, cancelDrag, onResize: (size, keys) => change((cur) => patchChart(cur, spec.id, { size }), keys ? { fold: `size:${spec.id}` } : {}) }}>
              <SeenOnce>{(seen) => (
              <def.Panel martId={martId} cf={chart} title={resolved[i]!.title!} r={r} spark={spark} filter={filter} version={version} idle={idle} hold={!seen}
                hasFilters={hasFilters} formatOf={formatOf} ready={!!settings} tail={tailItems({ cf: chart, spec, change, resizing, onResizing: setResizing })}
                onChange={(p: Partial<ChartSpec>) => change((cur) => patchChart(cur, spec.id, p))} onFilter={onFilter} />
              )}</SeenOnce>
              </ChartFrameContext>
            ) : null)}
            {resizing && <p role="status" className="sr-only">Resizing charts: drag an edge, or focus a handle and use the arrow keys. Escape ends it.</p>}
          </div>
          {havingNote && <p data-chart-note className="mt-1 text-xs text-muted-foreground" style={{ position: 'sticky', left: GUTTER_PX }}>Charts can't apply filters on aggregates for this grouping.</p>}
        </td>
      </tr>
    </tbody>
    </CarriedRanges>,
  );
}

/** Holds whether the panel has been near the view yet. It starts false and never goes back, so only the first read waits. */
function SeenOnce({ children }: { children: (seen: boolean) => ReactNode }) {
  const [seen, setSeen] = useState(false);
  const onSeen = useCallback(() => setSeen(true), []);
  return <ChartSeenContext value={seen ? null : onSeen}>{children(seen)}</ChartSeenContext>;
}
