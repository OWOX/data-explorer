import { ArrowRightLeft, Calendar, CalendarRange, ChartColumn, ChartColumnStacked } from 'lucide-react';
import { BUCKET_LABELS, type DateBucket } from '../../model/aggregation';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { BLANK_KEY } from '../blank';
import { bucketFilter, dimensionFilter } from '../clickFilters';
import { tickText } from '../compact';
import type { MenuItem } from '../ChartMenu';
import { axisTitle, BUCKET_OPTIONS, fieldGroups, measureAxisTitle, metricItem } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { measuresOf, type ChartFields } from '../fields';
import { bucketZone, type Measure } from '../queries';
import { isIntegerMeasure, measureFormat, measureLabel } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure, type Orientation } from '../settings';
import { BarChart } from '../svg/BarChart';
import { useBucket } from '../useBucket';
import { useDateSeries } from '../useDateSeries';
import { BOX_WIDTH, carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

type TimeSeriesR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; stack: Field | null; orientation: Orientation };

/** The shared rows of a date chart's menu: Date field (when there is a choice), Bucket and Metric (when there is a choice). */
export function dateMenu(cf: ChartFields, r: { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure }, onChange: PanelProps<unknown>['onChange']): MenuItem[] {
  const measures = measuresOf(cf);
  return [
    ...(cf.dates.length > 1 ? [{ kind: 'radio', label: 'Date field', icon: Calendar, value: r.date.name, options: [], groups: fieldGroups(cf, cf.dates), onPick: (v: string) => onChange({ date: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Bucket', icon: CalendarRange, value: r.bucket, options: BUCKET_OPTIONS, onPick: (v) => onChange({ bucket: v as DateBucket | 'AUTO' }) },
    ...(measures.length > 1 ? [metricItem(cf, measureId(r.measure), measures, onChange)] : []),
  ];
}

function TimeSeriesPanel({ martId, cf, title: memoKey, r, spark, filter, version, idle, hold, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<TimeSeriesR>) {
  const { date, measure, stack } = r;
  const { bucket, error, retry } = useBucket(martId, date, r.bucket, filter, version, idle, hold);
  const s = useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, hold, formatOf, range: { error, retry } });
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    ...dateMenu(cf, r, onChange),
    { kind: 'radio', label: 'Stack by', icon: ChartColumnStacked, value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }], groups: fieldGroups(cf, cf.dimensions), onPick: (v) => onChange({ stack: v === '' ? null : v }) },
    { kind: 'radio', label: 'Orientation', icon: ArrowRightLeft, value: r.orientation, options: [{ value: 'vertical', label: 'Vertical' }, { value: 'horizontal', label: 'Horizontal' }], onPick: (v) => onChange({ orientation: v as Orientation }) },
    ...tail,
  ];
  const heading = `${s.label} by ${BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase()}`;
  const full = stack ? `${heading} · by ${fieldLabel(stack)}` : heading;
  const buckets = s.series?.[0]?.points.length ?? null;
  return (
    <ChartPanel title={bucket ? full : `${s.label} by date`} name="Time series" memoKey={memoKey} items={items} ready={ready}
      width={r.orientation === 'horizontal' ? BOX_WIDTH : seriesWidth(buckets)}
      loading={s.loading} failed={s.failed} empty={s.empty} hasFilters={hasFilters}>
      {s.series && (() => {
        const shown = s.series;
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date, x, bucket!, bucketZone(date)), ...(stack && i !== undefined ? [dimensionFilter(stack, shown[i]!.blank ? BLANK_KEY : shown[i]!.name)] : [])]);
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
