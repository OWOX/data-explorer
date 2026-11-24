import { ChartPie, Gauge, Shapes } from 'lucide-react';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import { BLANK_COLOR, BLANK_KEY, BLANK_LABEL, OTHER_KEY } from '../blank';
import { dimensionFilter } from '../clickFilters';
import type { MenuItem } from '../ChartMenu';
import { fieldGroups, measureGroups } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { menuOf, pieMeasures } from '../fields';
import type { Measure } from '../queries';
import { measureLabel, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { PieChart, type Slice } from '../svg/PieChart';
import { labelColors } from '../labelColor';
import { OTHER_COLOR } from '../useDateSeries';
import { useTopValues } from '../useTopValues';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type PieR = { measure: Measure; dimension: Field };

/** Parts are shares of a whole only when the measure and the dimension are of the same mart at the same path (compared by path: a mart joined twice, or to itself, is more than one cell). */
export const sharesWhole = (measure: Measure, dim: Field): boolean => (measure.kind === 'records' ? measure.aliasPath : measure.metric.field.joined?.aliasPath ?? '') === (dim.joined?.aliasPath ?? '');

/** The measure's top values of a dimension as slices, the blank value first, with "Other" (a `not_in` query) when the top list was full. */
function PiePanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<PieR>) {
  const { measure, dimension: dim } = r;
  const top = useTopValues({ martId, cf, dim, measure, filter, version, idle });
  const slice = (key: string, name: string, v: unknown, color: string): Slice => ({ key, name, value: numberOf(v) ?? 0, valueText: measureText(measure, v, formatOf), color });
  const slices = (): Slice[] => {
    // Each slice keeps the colour its label hashes to, the same as the same value in a stack or a Sankey.
    const colors = labelColors(top.categories!.filter((c) => c.key !== BLANK_KEY).map((c) => c.key));
    return [
      ...top.categories!.map((c) => (c.key === BLANK_KEY ? { ...slice(BLANK_KEY, BLANK_LABEL, c.value, BLANK_COLOR), blank: true } : slice(c.key, c.key, c.value, colors.get(c.key)!))),
      ...(top.other != null ? [{ ...slice(OTHER_KEY, 'Other', top.other, OTHER_COLOR), other: true }] : []),
    ];
  };
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', icon: Gauge, value: measureId(measure), options: [], groups: measureGroups(menuOf(cf), pieMeasures(menuOf(cf))), onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Dimension', icon: Shapes, value: dim.name, options: [], groups: fieldGroups(menuOf(cf), menuOf(cf).dimensions), onPick: (v) => onChange({ dimension: v }) },
    ...tail,
  ];
  // A measure of another mart than the dimension's can repeat one row in several slices (a one-to-many join), and a records measure of another mart counts each mart's rows per slice: the slices overlap, so the parts are not shares of a whole.
  const showShare = sharesWhole(measure, dim);
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Pie" items={ready ? items : null} width={BOX_WIDTH} loading={top.loading} error={top.failed?.error} onRetry={top.failed?.retry ?? (() => {})}
      empty={top.empty ? emptyText(hasFilters) : null}>
      {top.categories && <PieChart slices={slices()} ariaLabel={title} onPick={(name, blank) => onFilter([dimensionFilter(dim, blank ? BLANK_KEY : name)])} showShare={showShare} />}
    </ChartPanel>
  );
}

export const pie: ChartKindDef<PieR> = {
  kind: 'pie',
  label: 'Pie',
  icon: ChartPie,
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
