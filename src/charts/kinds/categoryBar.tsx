import { Gauge, Shapes, type LucideIcon } from 'lucide-react';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { axisTitle, fieldGroups, measureAxisTitle, measureGroups } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { BLANK_COLOR, BLANK_KEY, labelOf } from '../blank';
import { labelColors } from '../labelColor';
import { OTHER_COLOR } from '../useDateSeries';
import { dimensionFilter } from '../clickFilters';
import { measuresOf, menuOf } from '../fields';
import type { Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { BarChart, type Series } from '../svg/BarChart';
import { useTopValues } from '../useTopValues';
import { seriesColor, tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type CategoryBarR = { measure: Measure; dimension: Field };
/** The x of the "Other" bar: never a real value, so it is never filtered to. */
export const OTHER_X = '\u0000other';

function categoryPanel(orientation: 'vertical' | 'horizontal', name: string) {
  return function CategoryBarPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<CategoryBarR>) {
    const { measure, dimension: dim } = r;
    const top = useTopValues({ martId, cf, dim, measure, filter, version, idle });
    const point = (x: string, label: string, v: unknown, color: string) => ({ x, label, y: numberOf(v), valueText: measureText(measure, v, formatOf), color });
    const series = (): Series[] => {
      // Each bar keeps the colour its label hashes to, the same as the same value's pie slice, stack segment or Sankey node.
      const colors = labelColors(top.categories!.filter((c) => c.key !== BLANK_KEY).map((c) => c.key));
      return [{ name: measureLabel(cf, measure), color: seriesColor(0), points: [
        ...top.categories!.map((c) => point(c.key, labelOf(c.key), c.value, c.key === BLANK_KEY ? BLANK_COLOR : colors.get(c.key)!)),
        ...(top.other != null ? [point(OTHER_X, 'Other', top.other, OTHER_COLOR)] : []),
      ] }];
    };
    const [tickType, tickFormat] = measureFormat(measure, formatOf);
    const items: MenuItem[] = [
      { kind: 'radio', label: 'Metric', icon: Gauge, value: measureId(measure), options: [], groups: measureGroups(menuOf(cf), measuresOf(menuOf(cf))), onPick: (v) => onChange({ measure: v }) },
      { kind: 'radio', label: 'Dimension', icon: Shapes, value: dim.name, options: [], groups: fieldGroups(menuOf(cf), menuOf(cf).dimensions), onPick: (v) => onChange({ dimension: v }) },
      ...tail,
    ];
    const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
    return (
      <ChartPanel title={title} name={name} items={ready ? items : null} width={BOX_WIDTH}
        loading={top.loading} error={top.failed?.error} onRetry={top.failed?.retry ?? (() => {})} empty={top.empty ? emptyText(hasFilters) : null}>
        {top.categories && !top.loading && <BarChart series={series()} orientation={orientation} categorical ariaLabel={title} stacked={false} xTitle={axisTitle(cf, dim)} yTitle={measureAxisTitle(cf, measure)} integer={isIntegerMeasure(measure)}
          formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={(x) => onFilter([dimensionFilter(dim, x)])} canPick={(x) => x !== OTHER_X} />}
      </ChartPanel>
    );
  }
}

/** A bar chart of a measure by a category: `vertical` is the Bar chart, `horizontal` the Ranked bar. */
export function categoryBar(kind: 'bar' | 'rankedBar', label: string, icon: LucideIcon, orientation: 'vertical' | 'horizontal'): ChartKindDef<CategoryBarR> {
  return {
    kind,
    label,
    icon,
    eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 0,
    create: (_cf, from) => ({ kind, ...carry(from, ['measure', 'dimension']) }),
    resolve(spec, cf) {
      const measure = pickMeasure(measuresOf(cf), spec.measure);
      const dimension = pickField(cf.dimensions, spec.dimension);
      return measure && dimension ? { measure, dimension } : null;
    },
    title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
    Panel: categoryPanel(orientation, label),
  };
}
