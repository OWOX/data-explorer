import { ChartCandlestick } from 'lucide-react';
import { aggregatedKey, AGG_LABELS, type AggFn } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import type { ChartFields } from '../fields';
import { spreadFns, spreadQuery } from '../queries';
import { metricFormat, metricText, numberOf } from '../Scorecards';
import { pickField } from '../settings';
import { SpreadChart, type SpreadRow } from '../svg/SpreadChart';
import { useChartQuery } from '../useChartQuery';
import { tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type SpreadR = { dimension: Field; field: Field };
const fieldsOf = (cf: ChartFields): Field[] => cf.marts.flatMap((m) => m.metrics.map((x) => x.field)).filter((f) => spreadFns(f).length > 0);

function SpreadPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<SpreadR>) {
  const { dimension: dim, field } = r;
  const fns = spreadFns(field);
  const read = useChartQuery(martId, idle ? null : spreadQuery(dim, field, filter), version);
  const v = (row: Record<string, unknown>, fn: AggFn) => (fns.includes(fn) ? numberOf(row[aggregatedKey(field.name, fn)]) : null);
  const text = (row: Record<string, unknown>, fn: AggFn) => metricText(field, fn, row[aggregatedKey(field.name, fn)], formatOf);
  const rows: SpreadRow[] = (read.rows ?? []).flatMap((row) => {
    const p25 = v(row, 'P25'); const p50 = v(row, 'P50'); const p75 = v(row, 'P75');
    if (p25 === null || p50 === null || p75 === null) return [];
    const parts = (['MIN', 'P25', 'P50', 'P75', 'MAX'] as const).filter((fn) => fns.includes(fn)).map((fn) => `${AGG_LABELS[fn]} ${text(row, fn)}`);
    const key = String(row[dim.name]);
    return [{ key, label: key, p25, p50, p75, min: v(row, 'MIN'), max: v(row, 'MAX'), text: parts.join(', ') }];
  });
  const [tt, tf] = metricFormat(field, 'P50', formatOf);
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (x) => onChange({ dimension: x }) },
    { kind: 'radio', label: 'Metric', value: field.name, options: fieldsOf(cf).map((f) => ({ value: f.name, label: columnTitle(f) })), onPick: (x) => onChange({ measure: x }) },
    ...tail,
  ];
  const title = `${fieldLabel(field)} spread by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Spread" items={ready ? items : null} width={BOX_WIDTH}
      loading={!read.rows && !read.error} error={read.error} onRetry={read.retry} empty={read.rows?.length === 0 ? emptyText(hasFilters) : null}
      note={`The ${fns.length > 3 ? 'line spans the minimum to the maximum, the ' : ''}box spans the 25th to the 75th percentile, the bar is the median. The 8 values with the largest median are shown.`}>
      {read.rows && <SpreadChart rows={rows} ariaLabel={title} formatTick={(n) => tickText(n, tt, tf)} onPick={(k) => onFilter([dimensionFilter(dim, k)])} />}
    </ChartPanel>
  );
}

export const spread: ChartKindDef<SpreadR> = {
  kind: 'spread',
  label: 'Spread',
  icon: ChartCandlestick,
  eligible: (cf) => cf.dimensions.length > 0 && fieldsOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'spread', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const dimension = pickField(cf.dimensions, spec.dimension);
    const field = pickField(fieldsOf(cf), spec.measure);
    return dimension && field ? { dimension, field } : null;
  },
  title: (r) => `${fieldLabel(r.field)} spread by ${fieldLabel(r.dimension)}`,
  Panel: SpreadPanel,
};
