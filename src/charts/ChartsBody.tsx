import { useEffect, useRef, useState } from 'react';
import type { ColumnFilter } from '../filters/build';
import type { JoinedSource } from '../api/blendable';
import type { Aggregation } from '../model/aggregation';
import type { Format } from '../format/formats';
import type { Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { useServices } from '../state/store';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { chartFields } from './fields';
import type { HavingKeys } from './havingKeys';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { cardsOf, MartCards, useScorecards } from './Scorecards';
import { resolveCharts, type ChartSettings } from './settings';
import { PiePanel } from './PiePanel';
import { TimeSeriesPanel } from './TimeSeriesPanel';
import { useBucket } from './useBucket';

/** The gutter cell of a row that is not a data row; the grid has the same one. */
const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;
/** The gutter's width (`.dm-grid tbody .dm-chrome` in bands.css). */
const GUTTER_PX = 46;

/**
 * The Charts mode's `<tbody>`: a strip of scorecards, one cell per data mart under that mart's header, then the panels
 * on a row of their own, as wide as the visible grid and pinned left so a wide table does not push them out of view.
 * The panels sit side by side while each still gets 30rem, and stack when the band is narrower.
 * Settings load once per mart; a fallback `resolveCharts` picks is never written back, only the member's own changes are.
 */
export function ChartsBody({ martId, schema, shown, agg, filter, havingNote = false, gate = null, groups, version, paused, hasFilters, sources, formatOf, scrollerWidth, onFilter }: {
  martId: string; schema: Schema; shown: string[]; agg: Aggregation; filter: TraverseFilter[]; /** The grid has a filter on an aggregate that the charts cannot follow for this grouping. */ havingNote?: boolean; /** Stands in for the charts while the passing group keys load, fail to load, or are none. */ gate?: HavingKeys['gate']; groups: { id: string; path: string; span: number; title: string }[]; version: number; paused: boolean; hasFilters: boolean; sources: JoinedSource[];
  formatOf: (column: string, type: string) => Format; scrollerWidth: number;
  /** Applies the clicked mark's filters to the grid, as a filter edit (one Undo step). */
  onFilter: (add: ColumnFilter[]) => void;
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
    const next = edit(latest.current);
    latest.current = next;
    setSettings(next);
    chartSettings.save(martId, next);
  };

  const uniqueCountPaths = new Set(sources.filter((x) => x.uniqueCount).map((x) => x.aliasPath));
  const cf = chartFields(schema, shown, agg, martId, groups.map((g) => g.path), uniqueCountPaths, Object.fromEntries(groups.map((g) => [g.path, g.title])));
  const r = resolveCharts(settings ?? {}, cf);
  // Nothing is read until the member's saved choices are known: a read with the defaults would be billed and then thrown away.
  const idle = paused || !settings || !!gate;
  const { bucket, error: rangeError, retry: retryRange } = useBucket(martId, r.date, r.bucket, filter, version, idle);
  const scores = useScorecards(martId, cf, filter, version, idle);
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

  const patch = (edit: (cur: NonNullable<ChartSettings['scorecards']>) => NonNullable<ChartSettings['scorecards']>) => change((cur) => ({ ...cur, scorecards: edit(cur.scorecards ?? {}) }));
  const toggleCard = (id: string) => patch((sc) => {
    const hidden = new Set(sc.hidden ?? []);
    if (!hidden.delete(id)) hidden.add(id);
    return { ...sc, hidden: [...hidden] };
  });
  const panelProps = { martId, cf, r, filter, version, idle, hasFilters, formatOf, ready: !!settings, onFilter };
  const items: MenuItem[] = [
    ...cf.marts.flatMap((m, i) => cardsOf(m).map((c): MenuItem => ({ kind: 'check', label: i === 0 ? c.label : `${m.title} · ${c.label}`, checked: !r.hidden.has(c.id), onToggle: () => toggleCard(c.id) }))),
    { kind: 'check', label: 'Sparklines', checked: r.sparklines, onToggle: () => patch((sc) => ({ ...sc, sparklines: !(sc.sparklines ?? true) })) },
  ];

  return (
    <tbody>
      <tr data-chart-strip>
        <Gutter />
        {groups.map((g, i) => (
          <td key={g.path} colSpan={g.span} data-chart-group={g.id} data-chart-path={g.path}>
            <div className="flex items-start gap-1">
              <MartCards martId={martId} mart={cf.marts[i]!} main={g.path === ''} r={r} scores={scores} bucket={bucket} filter={filter} version={version} paused={idle} hasFilters={hasFilters} formatOf={formatOf} />
              {g.path === '' && settings && <ChartMenu name="Scorecards" items={items} />}
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
            {r.date && r.measure && <TimeSeriesPanel {...panelProps} bucket={bucket} range={{ error: rangeError, retry: retryRange }}
              onChange={(p) => change((cur) => ({ ...cur, timeSeries: { ...cur.timeSeries, ...p } }))} />}
            {r.pieMeasure && r.pieDimension && <PiePanel {...panelProps} onChange={(p) => change((cur) => ({ ...cur, pie: { ...cur.pie, ...p } }))} />}
          </div>
          {havingNote && <p data-chart-note className="mt-1 text-xs text-muted-foreground" style={{ position: 'sticky', left: GUTTER_PX }}>Charts can't apply filters on aggregates for this grouping.</p>}
        </td>
      </tr>
    </tbody>
  );
}
