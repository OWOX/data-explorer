import { ChartColumnBig } from 'lucide-react';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { labelOf } from '../blank';
import { dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import type { Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { BarChart, type Series } from '../svg/BarChart';
import { useTopValues } from '../useTopValues';
import { OTHER_X } from './rankedBar';
import { seriesColor, tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type BarR = { measure: Measure; dimension: Field };

function BarPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<BarR>) {
  const { measure, dimension: dim } = r;
  const top = useTopValues({ martId, cf, dim, measure, filter, version, idle });
  const point = (x: string, label: string, v: unknown) => ({ x, label, y: numberOf(v), valueText: measureText(measure, v, formatOf) });
  const series = (): Series[] => [{ name: measureLabel(cf, measure), color: seriesColor(0), points: [
    ...top.categories!.map((c) => point(c.key, labelOf(c.key), c.value)),
    ...(top.other != null ? [point(OTHER_X, 'Other', top.other)] : []),
  ] }];
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    ...tail,
  ];
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Bar chart" items={ready ? items : null} width={BOX_WIDTH}
      loading={top.loading} error={top.failed?.error} onRetry={top.failed?.retry ?? (() => {})} empty={top.empty ? emptyText(hasFilters) : null}>
      {top.categories && !top.loading && <BarChart series={series()} orientation="vertical" ariaLabel={title} stacked={false} xTitle={columnTitle(dim)} yTitle={measureLabel(cf, measure)} integer={isIntegerMeasure(measure)}
        formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={(x) => onFilter([dimensionFilter(dim, x)])} canPick={(x) => x !== OTHER_X} />}
    </ChartPanel>
  );
}

export const bar: ChartKindDef<BarR> = {
  kind: 'bar',
  label: 'Bar chart',
  icon: ChartColumnBig,
  eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'bar', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
  Panel: BarPanel,
};
