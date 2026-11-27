import type { LucideIcon } from 'lucide-react';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { MenuItem } from '../ChartMenu';
import { axisTitle, dimensionItem, measureAxisTitle, metricItem } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { BLANK_COLOR, BLANK_KEY, labelOf, OTHER_KEY } from '../blank';
import { tickText } from '../compact';
import { labelColors, slotColor } from '../labelColor';
import { OTHER_COLOR } from '../useDateSeries';
import { dimensionFilter } from '../clickFilters';
import { measuresOf, type ChartFields } from '../fields';
import type { Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure, type ChartKind, type ChartSpec } from '../settings';
import { BarChart, type Series } from '../svg/BarChart';
import { useTopValues } from '../useTopValues';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type MeasureByDimensionR = { measure: Measure; dimension: Field };

function categoryPanel(orientation: 'vertical' | 'horizontal', name: string) {
  return function CategoryBarPanel({ martId, cf, title, r, filter, version, idle, hold, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<MeasureByDimensionR>) {
    const { measure, dimension: dim } = r;
    const top = useTopValues({ martId, counter: cf.counter, dim, measure, filter, version, idle, hold });
    const point = (x: string, label: string, v: unknown, color: string) => ({ x, label, y: numberOf(v), valueText: measureText(measure, v, formatOf), color });
    const series = (): Series[] => {
      // Each bar keeps the colour its label hashes to, the same as the same value's pie slice, stack segment or Sankey node.
      const colors = labelColors(top.categories!.filter((c) => c.key !== BLANK_KEY).map((c) => c.key));
      return [{ name: measureLabel(cf, measure), color: slotColor(0), points: [
        ...top.categories!.map((c) => point(c.key, labelOf(c.key), c.value, c.key === BLANK_KEY ? BLANK_COLOR : colors.get(c.key)!)),
        ...(top.other != null ? [point(OTHER_KEY, 'Other', top.other, OTHER_COLOR)] : []),
      ] }];
    };
    const [tickType, tickFormat] = measureFormat(measure, formatOf);
    const items: MenuItem[] = [
      metricItem(cf, measureId(measure), measuresOf(cf), onChange),
      dimensionItem(cf, dim.name, onChange),
      ...tail,
    ];
    return (
      <ChartPanel title={title} name={name} items={items} ready={ready} width={BOX_WIDTH}
        loading={top.loading} failed={top.failed} empty={top.empty} hasFilters={hasFilters}>
        {top.categories && !top.loading && <BarChart series={series()} orientation={orientation} categorical ariaLabel={title} stacked={false} xTitle={axisTitle(cf, dim)} yTitle={measureAxisTitle(cf, measure)} integer={isIntegerMeasure(measure)}
          formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={(x) => onFilter([dimensionFilter(dim, x)])} canPick={(x) => x !== OTHER_KEY} />}
      </ChartPanel>
    );
  }
}

/** What a chart of a measure by a dimension (a bar, a ranked bar, a pie) does with the saved choices; `listOf` is the measures it offers. */
export const measureByDimension = (kind: ChartKind, listOf: (cf: ChartFields) => Measure[]) => ({
  eligible: (cf: ChartFields): boolean => cf.dimensions.length > 0 && listOf(cf).length > 0,
  create: (_cf: ChartFields, from?: ChartSpec): Omit<ChartSpec, 'id' | 'hidden'> => ({ kind, ...carry(from, ['measure', 'dimension']) }),
  resolve(spec: ChartSpec, cf: ChartFields): MeasureByDimensionR | null {
    const measure = pickMeasure(listOf(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r: MeasureByDimensionR, cf: ChartFields): string => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
});

/** A bar chart of a measure by a category: `vertical` is the Bar chart, `horizontal` the Ranked bar. */
export function categoryBar(kind: 'bar' | 'rankedBar', label: string, icon: LucideIcon, orientation: 'vertical' | 'horizontal'): ChartKindDef<MeasureByDimensionR> {
  return { kind, label, icon, ...measureByDimension(kind, measuresOf), Panel: categoryPanel(orientation, label) };
}
