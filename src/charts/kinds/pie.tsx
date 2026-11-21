import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import { dimensionFilter } from '../clickFilters';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { pieMeasures } from '../fields';
import { measureKey, pieOtherQuery, TOP_N, topValuesQuery, type Measure } from '../queries';
import { measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { PieChart, type Slice } from '../svg/PieChart';
import { OTHER_COLOR, seriesColor } from '../useDateSeries';
import { useChartQuery } from '../useChartQuery';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type PieR = { measure: Measure; dimension: Field };

/** Parts are shares of a whole only when the measure and the dimension are of the same mart at the same path (compared by path: a mart joined twice, or to itself, is more than one cell). */
export const sharesWhole = (measure: Measure, dim: Field): boolean => (measure.kind === 'records' ? measure.aliasPath : measure.metric.field.joined?.aliasPath ?? '') === (dim.joined?.aliasPath ?? '');

/** The measure's top values of a dimension as slices, with "Other" (a `not_in` query) when the top list was full. */
function PiePanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<PieR>) {
  const { measure, dimension: dim } = r;
  const top = useChartQuery(martId, !idle ? topValuesQuery(dim, measure, filter) : null, version);
  const names = top.rows?.map((row) => String(row[dim.name]));
  const needOther = names?.length === TOP_N;
  const other = useChartQuery(martId, !idle && needOther ? pieOtherQuery(measure, filter, dim, names!, cf.counter) : null, version);
  const failed = [top, other].find((q) => q.error);
  const emptyNow = top.rows?.length === 0;
  const loading = !emptyNow && (!top.rows || (needOther && !other.rows));

  const key = measureKey(measure);
  const slice = (name: string, v: unknown, color: string): Slice => ({ name, value: numberOf(v) ?? 0, valueText: measureText(measure, v, formatOf), color });
  const slices = (): Slice[] => [
    ...top.rows!.map((row, i) => slice(names![i]!, row[key], seriesColor(i))),
    ...(needOther && other.rows?.[0] && other.rows[0][key] != null ? [{ ...slice('Other', other.rows[0][key], OTHER_COLOR), other: true }] : []),
  ];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, pieMeasures(cf)), onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    ...tail,
  ];
  // A measure of another mart than the dimension's can repeat one row in several slices (a one-to-many join), and a records measure of another mart counts each mart's rows per slice: the slices overlap, so the parts are not shares of a whole.
  const showShare = sharesWhole(measure, dim);
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Pie" items={ready ? items : null} width={BOX_WIDTH} loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})}
      empty={emptyNow ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(dim)} are not shown.`}>
      {top.rows && <PieChart slices={slices()} ariaLabel={title} onPick={(name) => onFilter([dimensionFilter(dim, name)])} showShare={showShare} />}
    </ChartPanel>
  );
}

export const pie: ChartKindDef<PieR> = {
  kind: 'pie',
  label: 'Pie',
  eligible: (cf) => cf.dimensions.length > 0 && pieMeasures(cf).length > 0,
  create: (_cf, from) => ({ kind: 'pie', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const measure = pickMeasure(pieMeasures(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
  Panel: PiePanel,
};
