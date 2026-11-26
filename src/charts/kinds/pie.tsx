import { ChartPie } from 'lucide-react';
import type { Field } from '../../model/types';
import { BLANK_COLOR, BLANK_KEY, BLANK_LABEL, OTHER_KEY } from '../blank';
import { dimensionFilter } from '../clickFilters';
import type { MenuItem } from '../ChartMenu';
import { dimensionItem, metricItem } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { measurePath, menuOf, pathOf, pieMeasures } from '../fields';
import type { Measure } from '../queries';
import { measureText, numberOf } from '../Scorecards';
import { measureId } from '../settings';
import { PieChart, type Slice } from '../svg/PieChart';
import { labelColors } from '../labelColor';
import { OTHER_COLOR } from '../useDateSeries';
import { useTopValues } from '../useTopValues';
import { measureByDimension, type MeasureByDimensionR } from './categoryBar';
import { BOX_WIDTH, type ChartKindDef, type PanelProps } from './types';

/** Parts are shares of a whole only when the measure and the dimension are of the same mart at the same path (compared by path: a mart joined twice, or to itself, is more than one cell). */
export const sharesWhole = (measure: Measure, dim: Field): boolean => measurePath(measure) === pathOf(dim);

/** The measure's top values of a dimension as slices, the blank value first, with "Other" (a `not_in` query) when the top list was full. */
function PiePanel({ martId, cf, title, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<MeasureByDimensionR>) {
  const { measure, dimension: dim } = r;
  const top = useTopValues({ martId, counter: cf.counter, dim, measure, filter, version, idle });
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
    metricItem(cf, measureId(measure), pieMeasures(menuOf(cf)), onChange),
    dimensionItem(cf, dim.name, onChange),
    ...tail,
  ];
  // A measure of another mart than the dimension's can repeat one row in several slices (a one-to-many join), and a records measure of another mart counts each mart's rows per slice: the slices overlap, so the parts are not shares of a whole.
  const showShare = sharesWhole(measure, dim);
  return (
    <ChartPanel title={title} name="Pie" items={items} ready={ready} width={BOX_WIDTH} loading={top.loading} failed={top.failed} empty={top.empty} hasFilters={hasFilters}>
      {top.categories && <PieChart slices={slices()} ariaLabel={title} onPick={(name, blank) => onFilter([dimensionFilter(dim, blank ? BLANK_KEY : name)])} showShare={showShare} />}
    </ChartPanel>
  );
}

export const pie: ChartKindDef<MeasureByDimensionR> = {
  kind: 'pie',
  label: 'Pie',
  icon: ChartPie,
  ...measureByDimension('pie', pieMeasures),
  Panel: PiePanel,
};
