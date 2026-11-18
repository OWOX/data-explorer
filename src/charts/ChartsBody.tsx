import { useEffect, useRef, useState } from 'react';
import type { JoinedSource } from '../api/blendable';
import type { Aggregation } from '../model/aggregation';
import type { Format } from '../format/formats';
import type { Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { useServices } from '../state/store';
import { chartFields } from './fields';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { cardsOf, MartCards, useScorecards } from './Scorecards';
import { resolveCharts, type ChartSettings } from './settings';
import { useBucket } from './useBucket';

/** The gutter cell of a row that is not a data row; the grid has the same one. */
const Gutter = () => <th aria-hidden data-chrome className="dm-chrome" />;

/**
 * The Charts mode's `<tbody>`: a strip of scorecards, one cell per data mart under that mart's header, then the panels
 * on a row of their own, as wide as the visible grid and pinned left so a wide table does not push them out of view.
 * Settings load once per mart; a fallback `resolveCharts` picks is never written back, only the member's own changes are.
 */
export function ChartsBody({ martId, schema, shown, agg, filter, groups, version, paused, hasFilters, sources, formatOf, scrollerWidth }: {
  martId: string; schema: Schema; shown: string[]; agg: Aggregation; filter: TraverseFilter[]; groups: { id: string; span: number; title: string }[]; version: number; paused: boolean; hasFilters: boolean; sources: JoinedSource[];
  formatOf: (column: string, type: string) => Format; scrollerWidth: number;
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
  const cf = chartFields(schema, shown, agg, martId, groups.map((g) => g.id), uniqueCountPaths);
  const r = resolveCharts(settings ?? {}, cf);
  // Nothing is read until the member's saved choices are known: a read with the defaults would be billed and then thrown away.
  const idle = paused || !settings;
  const { bucket } = useBucket(martId, r.date, r.bucket, filter, version, idle);
  const scores = useScorecards(martId, cf, filter, version, idle);
  const columns = groups.reduce((n, g) => n + g.span, 0);

  if (cf.marts.every((m) => m.metrics.length === 0 && !m.hasPk)) {
    return <tbody><tr><Gutter /><td colSpan={columns + 1} className="p-4 text-sm text-muted-foreground">Show a number column to chart it.</td></tr></tbody>;
  }

  const patch = (edit: (cur: NonNullable<ChartSettings['scorecards']>) => NonNullable<ChartSettings['scorecards']>) => change((cur) => ({ ...cur, scorecards: edit(cur.scorecards ?? {}) }));
  const toggleCard = (id: string) => patch((sc) => {
    const hidden = new Set(sc.hidden ?? []);
    if (!hidden.delete(id)) hidden.add(id);
    return { ...sc, hidden: [...hidden] };
  });
  const items: MenuItem[] = [
    ...cf.marts.flatMap((m, i) => cardsOf(m).map((c): MenuItem => ({ kind: 'check', label: i === 0 ? c.label : `${groups[i]!.title} · ${c.label}`, checked: !r.hidden.has(c.id), onToggle: () => toggleCard(c.id) }))),
    { kind: 'check', label: 'Sparklines', checked: r.sparklines, onToggle: () => patch((sc) => ({ ...sc, sparklines: !(sc.sparklines ?? true) })) },
  ];

  return (
    <tbody>
      <tr data-chart-strip>
        <Gutter />
        {groups.map((g, i) => (
          <td key={g.id} colSpan={g.span} data-chart-group={g.id} className="align-top p-2">
            <div className="flex items-start gap-1">
              <MartCards martId={martId} mart={cf.marts[i]!} main={g.id === martId} r={r} scores={scores} bucket={bucket} filter={filter} version={version} paused={idle} hasFilters={hasFilters} formatOf={formatOf} />
              {g.id === martId && settings && <ChartMenu name="Scorecards" items={items} />}
            </div>
          </td>
        ))}
        <td aria-hidden className="p-0" />
      </tr>
      <tr data-chart-panels-row>
        <td colSpan={columns + 2} className="p-0">
          {/* Sticky and as wide as the scroller shows, so the panels stay in view however wide the table is. The time series and pie go in here. */}
          <div data-chart-panels className="sticky left-0 p-2" style={{ width: scrollerWidth }} />
        </td>
      </tr>
    </tbody>
  );
}
