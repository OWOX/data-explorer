import { ChartScatter } from 'lucide-react';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { keyOf, labelOf } from '../blank';
import { dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import { measureKey, SCATTER_LIMIT, scatterQuery, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { Scatter, type Dot } from '../svg/Scatter';
import { useChartQuery } from '../useChartQuery';
import { tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type ScatterR = { dimension: Field; x: Measure; y: Measure };

function ScatterPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<ScatterR>) {
  const { dimension: dim, x, y } = r;
  const read = useChartQuery(martId, idle ? null : scatterQuery(dim, x, y, filter), version);
  const [xk, yk] = [measureKey(x), measureKey(y)];
  const points: Dot[] = (read.rows ?? []).flatMap((row) => {
    const xv = numberOf(row[xk]); const yv = numberOf(row[yk]);
    if (xv === null || yv === null) return [];
    const key = keyOf(row[dim.name]);
    return [{ key, label: labelOf(key), x: xv, y: yv, xText: measureText(x, row[xk], formatOf), yText: measureText(y, row[yk], formatOf) }];
  });
  const [xt, xf] = measureFormat(x, formatOf);
  const [yt, yf] = measureFormat(y, formatOf);
  const options = measureOptions(cf, measuresOf(cf));
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    { kind: 'radio', label: 'X metric', value: measureId(x), options, onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Y metric', value: measureId(y), options: options.filter((o) => o.value !== measureId(x)), onPick: (v) => onChange({ measure2: v }) },
    ...tail,
  ];
  const title = `${measureLabel(cf, y)} vs ${measureLabel(cf, x)} per ${fieldLabel(dim)}`;
  const full = read.rows?.length === SCATTER_LIMIT;
  return (
    <ChartPanel title={title} name="Scatter" items={ready ? items : null} width={BOX_WIDTH}
      loading={!read.rows && !read.error} error={read.error} onRetry={read.retry} empty={read.rows?.length === 0 ? emptyText(hasFilters) : null}
      note={full ? `Only the ${SCATTER_LIMIT} values with the largest ${measureLabel(cf, x)} are drawn.` : undefined}>
      {read.rows && <Scatter points={points} ariaLabel={title} xTitle={measureLabel(cf, x)} yTitle={measureLabel(cf, y)}
        formatX={(n) => tickText(n, xt, xf)} formatY={(n) => tickText(n, yt, yf)} onPick={(k) => onFilter([dimensionFilter(dim, k)])} />}
    </ChartPanel>
  );
}

export const scatter: ChartKindDef<ScatterR> = {
  kind: 'scatter',
  label: 'Scatter',
  icon: ChartScatter,
  eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 1,
  create: (_cf, from) => ({ kind: 'scatter', ...carry(from, ['measure', 'measure2', 'dimension']) }),
  resolve(spec, cf) {
    const list = measuresOf(cf);
    const dimension = pickField(cf.dimensions, spec.dimension);
    const x = pickMeasure(list, spec.measure);
    if (!dimension || !x) return null;
    const y = list.find((m) => measureId(m) === spec.measure2 && measureId(m) !== measureId(x)) ?? list.find((m) => measureId(m) !== measureId(x));
    return y ? { dimension, x, y } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.y)} vs ${measureLabel(cf, r.x)} per ${fieldLabel(r.dimension)}`,
  Panel: ScatterPanel,
};
