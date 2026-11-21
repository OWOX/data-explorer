import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import { measureKey, pieOtherQuery, TOP_N, topValuesQuery, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { BarChart, type Series } from '../svg/BarChart';
import { useChartQuery } from '../useChartQuery';
import { seriesColor, tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type RankedR = { measure: Measure; dimension: Field };
/** The x of the "Other" bar: never a real value, so it is never filtered to. */
export const OTHER_X = '\u0000other';

function RankedBarPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<RankedR>) {
  const { measure, dimension: dim } = r;
  const top = useChartQuery(martId, idle ? null : topValuesQuery(dim, measure, filter), version);
  const names = top.rows?.map((row) => String(row[dim.name]));
  const needOther = names?.length === TOP_N;
  const other = useChartQuery(martId, !idle && needOther ? pieOtherQuery(measure, filter, dim, names!, cf.counter) : null, version);
  const failed = [top, other].find((q) => q.error);
  const empty = top.rows?.length === 0;
  const loading = !empty && (!top.rows || (needOther && !other.rows));
  const key = measureKey(measure);
  const point = (x: string, label: string, v: unknown) => ({ x, label, y: numberOf(v), valueText: measureText(measure, v, formatOf) });
  const otherRow = other.rows?.[0];
  const series = (): Series[] => [{ name: measureLabel(cf, measure), color: seriesColor(0), points: [
    ...top.rows!.map((row, i) => point(names![i]!, names![i]!, row[key])),
    ...(needOther && otherRow && otherRow[key] != null ? [point(OTHER_X, 'Other', otherRow[key])] : []),
  ] }];
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    ...tail,
  ];
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Ranked bar" items={ready ? items : null} width={BOX_WIDTH}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(dim)} are not shown.`}>
      {top.rows && !loading && <BarChart series={series()} orientation="horizontal" ariaLabel={title} stacked={false}
        formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={(x) => onFilter([dimensionFilter(dim, x)])} canPick={(x) => x !== OTHER_X} />}
    </ChartPanel>
  );
}
export const rankedBar: ChartKindDef<RankedR> = {
  kind: 'rankedBar',
  label: 'Ranked bar',
  eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'rankedBar', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
  Panel: RankedBarPanel,
};
