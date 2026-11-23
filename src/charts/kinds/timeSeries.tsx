import { ArrowRightLeft, Calendar, CalendarRange, ChartColumn, ChartColumnStacked, Gauge } from 'lucide-react';
import { formatValue, type Format } from '../../format/formats';
import { BUCKET_LABELS, DATE_BUCKETS, type DateBucket } from '../../model/aggregation';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import { BLANK_KEY } from '../blank';
import { bucketFilter, dimensionFilter } from '../clickFilters';
import { compactValue } from '../compact';
import type { MenuItem } from '../ChartMenu';
import { axisTitle, fieldGroups, measureAxisTitle, measureGroups } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { measuresOf, menuOf, type ChartFields } from '../fields';
import { bucketZone, type Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure, type Orientation } from '../settings';
import { BarChart } from '../svg/BarChart';
import { useBucket } from '../useBucket';
import { useDateSeries } from '../useDateSeries';
import { BOX_WIDTH, carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

export { OTHER_COLOR, seriesColor } from '../useDateSeries';
export type TimeSeriesR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; stack: Field | null; orientation: Orientation };

/** An axis tick in the measure's format: short ($10.2K) when it has a short form, else the value rounded to 2 decimals unless the format scales or rounds it itself. */
export const tickText = (n: number, type: string, format: Format): string => compactValue(n, type, format) ?? formatValue(format.kind === 'percent' || format.kind === 'money' ? n : Number(n.toFixed(2)), type, format);

/** The shared rows of a date chart's menu: Date field (when there is a choice), Bucket and Metric (when there is a choice). */
export function dateMenu(cf: ChartFields, r: { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure }, onChange: PanelProps<unknown>['onChange']): MenuItem[] {
  const mc = menuOf(cf);
  const measures = measuresOf(mc);
  return [
    ...(mc.dates.length > 1 ? [{ kind: 'radio', label: 'Date field', icon: Calendar, value: r.date.name, options: [], groups: fieldGroups(mc, mc.dates), onPick: (v: string) => onChange({ date: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Bucket', icon: CalendarRange, value: r.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v) => onChange({ bucket: v as DateBucket | 'AUTO' }) },
    ...(measures.length > 1 ? [{ kind: 'radio', label: 'Metric', icon: Gauge, value: measureId(r.measure), options: [], groups: measureGroups(mc, measures), onPick: (v: string) => onChange({ measure: v }) } as MenuItem] : []),
  ];
}

function TimeSeriesPanel({ martId, cf, r, spark, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<TimeSeriesR>) {
  const { date, measure, stack } = r;
  const { bucket, error, retry } = useBucket(martId, date, r.bucket, filter, version, idle);
  const s = useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, formatOf, range: { error, retry } });
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    ...dateMenu(cf, r, onChange),
    { kind: 'radio', label: 'Stack by', icon: ChartColumnStacked, value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }], groups: fieldGroups(menuOf(cf), menuOf(cf).dimensions), onPick: (v) => onChange({ stack: v === '' ? null : v }) },
    { kind: 'radio', label: 'Orientation', icon: ArrowRightLeft, value: r.orientation, options: [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }], onPick: (v) => onChange({ orientation: v as Orientation }) },
    ...tail,
  ];
  const title = `${s.label} by ${BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase()}`;
  const full = stack ? `${title} · by ${fieldLabel(stack)}` : title;
  const buckets = s.series?.[0]?.points.length ?? null;
  return (
    <ChartPanel title={bucket ? full : `${s.label} by date`} name="Time series" items={ready ? items : null}
      width={r.orientation === 'horizontal' ? BOX_WIDTH : seriesWidth(buckets)}
      loading={s.loading} error={s.failed?.error} onRetry={s.failed?.retry ?? (() => {})} empty={s.empty ? emptyText(hasFilters) : null}>
      {s.series && (() => {
        const shown = s.series;
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date, x, bucket!, bucketZone(date)), ...(stack && i !== undefined && !shown[i]!.other ? [dimensionFilter(stack, shown[i]!.blank ? BLANK_KEY : shown[i]!.name)] : [])]);
        return <BarChart series={shown} orientation={r.orientation} ariaLabel={full} formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={bucket ? pick : undefined} stacked={!!stack} xTitle={axisTitle(cf, date)} yTitle={measureAxisTitle(cf, measure)} integer={isIntegerMeasure(measure)} />;
      })()}
    </ChartPanel>
  );
}

export const timeSeries: ChartKindDef<TimeSeriesR> = {
  kind: 'timeSeries',
  label: 'Time series',
  icon: ChartColumn,
  eligible: (cf) => cf.dates.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'timeSeries', ...carry(from, ['measure', 'date', 'bucket', 'stack']) }),
  resolve(spec, cf) {
    const date = pickField(cf.dates, spec.date);
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    if (!date || !measure) return null;
    return { date, bucket: pickBucketChoice(spec.bucket), measure, stack: pickField(cf.dimensions, spec.stack, null), orientation: spec.orientation === 'horizontal' ? 'horizontal' : 'vertical' };
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by date`,
  Panel: TimeSeriesPanel,
};
