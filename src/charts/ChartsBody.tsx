import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnFilter } from '../filters/build';
import type { JoinedSource } from '../api/blendable';
import type { Aggregation, DateBucket } from '../model/aggregation';
import type { Format } from '../format/formats';
import type { Field, Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { useServices } from '../state/store';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { chartFields, menuOf } from './fields';
import type { HavingKeys } from './havingKeys';
import { ChartMenu } from './ChartMenu';
import { dropPicksOf, hideCard, listItems, setCardDate, setCardMetric, tailItems } from './listMenu';
import { ChartsMenuSlot } from './menuSlot';
import { joinGrainOf } from './answers';
import { MartCards, useScorecards } from './Scorecards';
import { KINDS } from './kinds';
import { chartsOf, patchChart, scorecardsOf, type ChartSettings, type ChartSpec, type Spark } from './settings';
import { useBucket } from './useBucket';

/** The gutter cell of a row that is not a data row; the grid has the same one. */
const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;
/** The gutter's width (`.dm-grid tbody .dm-chrome` in bands.css). */
const GUTTER_PX = 46;

/**
 * The Charts mode's `<tbody>`: a strip of scorecards, one cell per data mart under that mart's header, then the panels
 * on a row of their own, as wide as the visible grid and pinned left so a wide table does not push them out of view.
 * Each panel is as wide as its content needs and the panels wrap onto more rows when the band is narrow.
 * Settings load once per mart; a fallback a kind's `resolve` picks is never written back, only the member's own changes are.
 */
export function ChartsBody({ martId, schema, shown, agg, filter, havingNote = false, gate = null, groups, version, paused, hasFilters, sources, formatOf, scrollerWidth, onFilter, onShowColumns, pruneRef }: {
  martId: string; schema: Schema; shown: string[]; agg: Aggregation; filter: TraverseFilter[]; /** The grid has a filter on an aggregate that the charts cannot follow for this grouping. */ havingNote?: boolean; /** Stands in for the charts while the passing group keys load, fail to load, or are none. */ gate?: HavingKeys['gate']; groups: { id: string; path: string; span: number; title: string; icon?: string | null }[]; version: number; paused: boolean; hasFilters: boolean; sources: JoinedSource[];
  formatOf: (column: string, type: string) => Format; scrollerWidth: number;
  /** Applies the clicked mark's filters to the grid, as a filter edit (one Undo step). */
  onFilter: (add: ColumnFilter[]) => void;
  /** Shows these columns in the grid (added to the shown ones): a menu choice of a field that is not shown has to put it on screen. */
  onShowColumns: (names: string[], buckets?: Readonly<Record<string, DateBucket>>) => void;
  /** The grid hands over the columns the member just hid; the card picks that named them go in one write. Set while this body is mounted. */
  pruneRef?: { current: ((hidden: string[]) => boolean) | null };
}) {
  const { chartSettings } = useServices();
  const [settings, setSettings] = useState<ChartSettings | null>(null);
  // Changes apply over the latest doc (not a render's copy), so two quick changes both land.
  const latest = useRef<ChartSettings | null>(null);
  useEffect(() => {
    let live = true;
    chartSettings.load(martId).then((s) => { if (live) { latest.current = s; setSettings(s); } });
    return () => { live = false; };
  }, [chartSettings, martId]);
  // Only called once the doc has loaded (the menu is not shown before), so a change never replaces what was saved.
  const change = (edit: (cur: ChartSettings) => ChartSettings) => {
    if (!latest.current) return;
    const next: ChartSettings = edit(latest.current);
    latest.current = next;
    setSettings(next);
    chartSettings.save(martId, next);
  };

  // A pick whose column the member hides goes with it, in the same action. Only the member's own edit prunes: a failed or late read of the columns never erases what is saved.
  useEffect(() => {
    if (!pruneRef) return;
    // False while the saved settings are not loaded: the grid then prunes through the store, as when Charts is closed.
    pruneRef.current = (hidden) => { const gone = new Set(hidden); if (!latest.current) return false; if (dropPicksOf(latest.current, gone) !== latest.current) change((cur) => dropPicksOf(cur, gone)); return true; };
    return () => { pruneRef.current = null; };
  });
  // A resize re-renders this body on every step: the fields and the resolved choices only change with their inputs, so a resize rebuilds neither.
  // Charts draw from the shown columns (`cf`); the menus list every column of the same marts (`cf.menu`), and picking a hidden one shows it (see `showPicked`).
  const cf = useMemo(() => {
    const build = (on: string[]) => chartFields(schema, on, agg, martId, groups.map((g) => g.path), new Set(sources.filter((x) => x.uniqueCount).map((x) => x.aliasPath)), Object.fromEntries(groups.map((g) => [g.path, g.title])), Object.fromEntries(sources.map((x) => [x.aliasPath, x.mainGrainCollapse])), Object.fromEntries(groups.map((g) => [g.path, g.icon])));
    return { ...build(shown), menu: build(schema.map((f) => f.name)) };
  }, [schema, shown, agg, martId, groups, sources]);
  const schemaNames = useMemo(() => new Set(schema.map((f) => f.name)), [schema]);
  const joins = useMemo(() => joinGrainOf(sources), [sources]);
  const specs = chartsOf(settings ?? {});
  // Hidden charts resolve to nothing, so they mount no panel and read nothing.
  const drawn = useMemo(() => specs.map((spec) => {
    const def = KINDS[spec.kind];
    return { spec, def, r: def && !spec.hidden ? def.resolve(spec, cf) : null };
  }), [specs, cf]);
  // The sparklines draw on the first shown chart's date and bucket; with none, the first date shown, by Auto.
  const lead = drawn.find((d) => d.r && (d.r as { date?: unknown }).date)?.r as { date: Field; bucket?: DateBucket | 'AUTO' } | undefined;
  const spark: Spark = useMemo(() => ({ ...scorecardsOf(settings ?? {}), date: lead?.date ?? cf.dates[0] ?? null }), [settings, lead?.date, cf]);
  // Nothing is read until the member's saved choices are known: a read with the defaults would be billed and then thrown away.
  const idle = paused || !settings || !!gate;
  const { bucket } = useBucket(martId, spark.date, lead?.bucket ?? 'AUTO', filter, version, idle);
  const scores = useScorecards(martId, cf, filter, version, idle, joins);
  // The header list names every chart, hidden ones included; memoized so a resize resolves nothing again.
  const resolved = useMemo(() => drawn.map(({ spec, def }) => {
    const r = def?.resolve({ ...spec, hidden: false }, cf) ?? null;
    return { spec, title: def && r ? def.title(r, cf) : null };
  }), [drawn, cf]);
  // A chosen field that is not a shown column is added to the grid with the choice. Records ids and Off ('') name no column.
  // A newly shown date is truncated by the chart's bucket: the one picked with it, else the chart's own when concrete, else the one the charts resolved.
  const showPicked = (spec: ChartSpec, p: Partial<ChartSpec>) => {
    const named = [p.measure, p.measure2, p.date, p.dimension, p.dimension2, p.stack, ...(p.dimensions ?? [])];
    const missing = [...new Set(named.filter((n): n is string => !!n && !shown.includes(n) && schemaNames.has(n)))];
    if (missing.length === 0) return;
    const chosen = p.bucket ?? spec.bucket;
    const unit = chosen && chosen !== 'AUTO' ? chosen : bucket;
    onShowColumns(missing, p.date && unit ? { [p.date]: unit } : undefined);
  };
  // A card's metric or date that is not a shown column is shown with the pick (a date by the charts' bucket when it is a concrete one; Auto is the grid's Month default, as the card resolves its own).
  const leadBucket = lead?.bucket ?? 'AUTO';
  const showCardPick = (name: string, isDate: boolean) => {
    if (shown.includes(name) || !schemaNames.has(name)) return;
    onShowColumns([name], isDate && leadBucket !== 'AUTO' ? { [name]: leadBucket } : undefined);
  };
  const slot = useContext(ChartsMenuSlot);
  const columns = groups.reduce((n, g) => n + g.span, 0);

  if (cf.marts.every((m) => m.metrics.length === 0 && !m.hasPk)) {
    return <tbody><tr><Gutter /><td colSpan={columns + 1} data-chart-empty className="text-sm text-muted-foreground">Show a number column to chart it.</td></tr></tbody>;
  }
  if (gate) {
    return (
      <tbody><tr><Gutter /><td colSpan={columns + 1} data-chart-empty className="text-sm text-muted-foreground">
        {gate.kind === 'loading' ? <Skeleton rows={2} /> : gate.kind === 'error' ? <ErrorBox error={gate.error} onRetry={gate.retry} /> : 'No rows match the filters.'}
      </td></tr></tbody>
    );
  }

  return (
    <tbody>
      <tr data-chart-strip>
        <Gutter />
        {/* `change` reads the latest-doc ref, but the menus only call it from handlers, never while rendering. */}
        {/* eslint-disable-next-line react-hooks/refs */}
        {groups.map((g, i) => (
          <td key={g.path} colSpan={g.span} data-chart-group={g.id} data-chart-path={g.path}>
            <div className="flex items-start gap-1">
              <MartCards martId={martId} mart={cf.marts[i]!} main={g.path === ''} spark={spark} scores={scores} bucket={bucket} autoBucket={leadBucket === 'AUTO'} filter={filter} version={version} paused={idle} joins={joins} hasFilters={hasFilters} formatOf={formatOf}
                menuMart={menuOf(cf).marts[i]}
                onMetric={settings ? (id, v) => { showCardPick(v, false); change((cur) => setCardMetric(cur, id, v, cf.marts[i]!)); } : undefined}
                onDate={settings ? (id, v) => { showCardPick(v, true); change((cur) => setCardDate(cur, id, v, cf.marts[i]!, spark)); } : undefined} onHide={settings ? (id) => change((cur) => hideCard(cur, id)) : undefined} />
              {g.path === '' && slot && settings && createPortal(<ChartMenu name="Charts" items={listItems({ cf, settings, resolved, change })} />, slot)}
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
          <div data-chart-panels className="dm-chart-panels sticky" style={{ left: GUTTER_PX, width: Math.max(0, scrollerWidth - GUTTER_PX) }}>
            {/* eslint-disable-next-line react-hooks/refs -- `change` is only called from handlers */}
            {drawn.map(({ spec, def, r }) => def && r ? (
              <def.Panel key={spec.id} martId={martId} cf={cf} spec={spec} r={r} spark={spark} filter={filter} version={version} idle={idle}
                hasFilters={hasFilters} formatOf={formatOf} ready={!!settings} tail={tailItems({ cf, spec, change })}
                onChange={(p: Partial<ChartSpec>) => { showPicked(spec, p); change((cur) => patchChart(cur, spec.id, p)); }} onFilter={onFilter} />
            ) : null)}
          </div>
          {havingNote && <p data-chart-note className="mt-1 text-xs text-muted-foreground" style={{ position: 'sticky', left: GUTTER_PX }}>Charts can't apply filters on aggregates for this grouping.</p>}
        </td>
      </tr>
    </tbody>
  );
}
