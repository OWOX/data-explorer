import type { ColumnFilter } from '../filters/build';
import { formatNumber } from '../ui/format';
import { columnTitle, fieldLabel } from '../model/fieldLabel';
import type { TraverseFilter } from '../sdk/types';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { ChartPanel } from './ChartPanel';
import { dimensionFilter } from './clickFilters';
import { pieMeasures, type ChartFields } from './fields';
import { measureKey, pieOtherQuery, TOP_N, topValuesQuery } from './queries';
import { measureLabel, measureOptions, metricText, numberOf, type Formatter } from './Scorecards';
import { measureId, type ChartSettings, type ResolvedCharts } from './settings';
import { PieChart, type Slice } from './svg/PieChart';
import { OTHER_COLOR, seriesColor } from './TimeSeriesPanel';
import { useChartQuery } from './useChartQuery';

type Patch = NonNullable<ChartSettings['pie']>;

/** The measure's top values of a dimension as slices, with "Other" (a `not_in` query) when the top list was full. */
export function PiePanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, onChange, onFilter }: {
  martId: string; cf: ChartFields; r: ResolvedCharts; filter: TraverseFilter[]; version: number; idle: boolean; hasFilters: boolean; formatOf: Formatter; ready: boolean; onChange: (patch: Patch) => void; onFilter: (add: ColumnFilter[]) => void;
}) {
  const { pieMeasure: measure, pieDimension: dim } = r;
  const top = useChartQuery(martId, !idle ? topValuesQuery(dim!, measure!, filter) : null, version);
  const names = top.rows?.map((row) => String(row[dim!.name]));
  const needOther = names?.length === TOP_N;
  const other = useChartQuery(martId, !idle && needOther ? pieOtherQuery(measure!, filter, dim!, names!) : null, version);
  const failed = [top, other].find((q) => q.error);
  const emptyNow = top.rows?.length === 0;
  const loading = !emptyNow && (!top.rows || (needOther && !other.rows));

  const key = measureKey(measure!);
  const slice = (name: string, v: unknown, color: string): Slice => ({ name, value: numberOf(v) ?? 0, valueText: measure!.kind === 'metric' ? metricText(measure!.metric.field, measure!.metric.fn, v, formatOf) : formatNumber(v) ?? String(v ?? ''), color });
  const slices = (): Slice[] => [
    ...top.rows!.map((row, i) => slice(names![i]!, row[key], seriesColor(i))),
    ...(needOther && other.rows?.[0] && other.rows[0][key] != null ? [{ ...slice('Other', other.rows[0][key], OTHER_COLOR), other: true }] : []),
  ];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: measureId(measure!, cf.marts[0]?.martId ?? ''), options: measureOptions(cf, pieMeasures(cf)), onPick: (v) => onChange({ metric: v }) },
    { kind: 'radio', label: 'Dimension', value: dim!.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
  ];
  const title = `${measureLabel(cf, measure!)} by ${fieldLabel(dim!)}`;
  return (
    <ChartPanel title={title} loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})}
      empty={emptyNow ? (hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.') : null}
      note={`Rows with a blank ${fieldLabel(dim!)} are not shown.`}
      actions={ready && <ChartMenu name="Pie" items={items} />}>
      {top.rows && <PieChart slices={slices()} ariaLabel={title} onPick={(name) => onFilter([dimensionFilter(dim!, name)])} />}
    </ChartPanel>
  );
}
