import { columnTitle, fieldLabel } from '../model/fieldLabel';
import type { TraverseFilter } from '../sdk/types';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { ChartPanel } from './ChartPanel';
import type { ChartFields } from './fields';
import { metricKey, pieOtherQuery, TOP_N, topValuesQuery } from './queries';
import { metricLabel, metricText, numberOf, type Formatter } from './Scorecards';
import type { ChartSettings, ResolvedCharts } from './settings';
import { PieChart, type Slice } from './svg/PieChart';
import { OTHER_COLOR, seriesColor } from './TimeSeriesPanel';
import { useChartQuery } from './useChartQuery';

type Patch = NonNullable<ChartSettings['pie']>;

/** The metric's top values of a dimension as slices, with "Other" (a `not_in` query) when the top list was full. */
export function PiePanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, onChange }: {
  martId: string; cf: ChartFields; r: ResolvedCharts; filter: TraverseFilter[]; version: number; idle: boolean; hasFilters: boolean; formatOf: Formatter; ready: boolean; onChange: (patch: Patch) => void;
}) {
  const { pieMetric: metric, pieDimension: dim } = r;
  const top = useChartQuery(martId, !idle ? topValuesQuery(dim!, metric!, filter) : null, version);
  const names = top.rows?.map((row) => String(row[dim!.name]));
  const needOther = names?.length === TOP_N;
  const other = useChartQuery(martId, !idle && needOther ? pieOtherQuery(metric!, filter, dim!, names!) : null, version);
  const failed = [top, other].find((q) => q.error);
  const emptyNow = top.rows?.length === 0;
  const loading = !emptyNow && (!top.rows || (needOther && !other.rows));

  const key = metricKey(metric!);
  const slice = (name: string, v: unknown, color: string): Slice => ({ name, value: numberOf(v) ?? 0, valueText: metricText(metric!.field, metric!.fn, v, formatOf), color });
  const slices = (): Slice[] => [
    ...top.rows!.map((row, i) => slice(names![i]!, row[key], seriesColor(i))),
    ...(needOther && other.rows?.[0] && other.rows[0][key] != null ? [slice('Other', other.rows[0][key], OTHER_COLOR)] : []),
  ];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: metric!.field.name, options: cf.metrics.map((m) => ({ value: m.field.name, label: metricLabel(m) })), onPick: (v) => onChange({ metric: v }) },
    { kind: 'radio', label: 'Dimension', value: dim!.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
  ];
  const title = `${metricLabel(metric!)} by ${fieldLabel(dim!)}`;
  return (
    <ChartPanel title={title} loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})}
      empty={emptyNow ? (hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.') : null}
      note={`Rows with a blank ${fieldLabel(dim!)} are not shown.`}
      actions={ready && <ChartMenu name="Pie" items={items} />}>
      {top.rows && <PieChart slices={slices()} ariaLabel={title} />}
    </ChartPanel>
  );
}
