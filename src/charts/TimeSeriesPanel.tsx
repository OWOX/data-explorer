import { ChartBar, ChartColumn } from 'lucide-react';
import { BUCKET_LABELS, DATE_BUCKETS, formatBucket, type DateBucket } from '../model/aggregation';
import { columnTitle, fieldLabel } from '../model/fieldLabel';
import type { Row, TraverseFilter } from '../sdk/types';
import { formatNumber } from '../ui/format';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { ChartPanel } from './ChartPanel';
import type { ChartFields } from './fields';
import { metricKey, seriesOtherQuery, seriesQuery, TOP_N, topValuesQuery } from './queries';
import { metricLabel, metricText, numberOf, type Formatter } from './Scorecards';
import type { ChartSettings, ResolvedCharts } from './settings';
import { BarChart, type Series } from './svg/BarChart';
import { useChartQuery } from './useChartQuery';

type Patch = NonNullable<ChartSettings['timeSeries']>;
export const seriesColor = (i: number): string => `var(--dm-series-${i + 1})`;
export const OTHER_COLOR = 'var(--dm-series-9)';

/** Drawing positions only: a tick is a fraction of the largest total, so it is rounded to read as a number. */
const tick = (n: number): string => formatNumber(Number(n.toFixed(2))) ?? String(n);

/**
 * The metric over time, one bar per bucket, stacked by a dimension's top values plus "Other" when chosen. Each value on
 * screen is a returned row's value; the pivot below only places returned numbers under their bucket.
 */
export function TimeSeriesPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, bucket, range, ready, onChange }: {
  martId: string; cf: ChartFields; r: ResolvedCharts; filter: TraverseFilter[]; version: number; idle: boolean; hasFilters: boolean; formatOf: Formatter;
  bucket: DateBucket | null; range: { error: unknown; retry: () => void }; ready: boolean; onChange: (patch: Patch) => void;
}) {
  const { date, metric, stack } = r;
  const live = !idle && !!date && !!metric && !!bucket;
  const top = useChartQuery(martId, live && stack ? topValuesQuery(stack, metric!, filter) : null, version);
  const names = top.rows?.map((row) => String(row[stack!.name]));
  // Without a stack the series query needs nothing else; with one it waits for the top values.
  const series = useChartQuery(martId, live && (!stack || (names && names.length > 0)) ? seriesQuery(date!, bucket!, metric!, filter, stack ? { dim: stack, top: names! } : undefined) : null, version);
  const needOther = !!stack && names?.length === TOP_N;
  const other = useChartQuery(martId, live && needOther ? seriesOtherQuery(date!, bucket!, metric!, filter, stack!, names!) : null, version);

  const failed = [{ error: range.error, retry: range.retry }, top, series, other].find((q) => q.error);
  const emptyNow = stack ? top.rows?.length === 0 : series.rows?.length === 0;
  const loading = !emptyNow && (!bucket || !series.rows || (needOther && !other.rows));

  const chart = (): Series[] => {
    const key = metricKey(metric!);
    const cell = (row: Row | undefined) => ({ y: row ? numberOf(row[key]) : null, valueText: row ? metricText(metric!.field, metric!.fn, row[key], formatOf) : '' });
    const byDate = (rows: Row[]) => new Map(rows.map((x) => [String(x[date!.name]), x]));
    const pivot = (name: string, color: string, rows: Row[], xs: string[]): Series => {
      const at = byDate(rows);
      return { name, color, points: xs.map((x) => ({ x, label: formatBucket(x, bucket!) ?? x, ...cell(at.get(x)) })) };
    };
    const all = [...(series.rows ?? []), ...(other.rows ?? [])];
    // ISO dates sort as text; the queries return them ascending, this only merges the Other query's buckets in.
    const xs = [...new Set(all.map((x) => String(x[date!.name])))].sort();
    if (!stack) return [pivot(metricLabel(metric!), seriesColor(0), series.rows ?? [], xs)];
    const rowsOf = (n: string) => (series.rows ?? []).filter((x) => String(x[stack.name]) === n);
    return [...names!.map((n, i) => pivot(n, seriesColor(i), rowsOf(n), xs)), ...(needOther ? [pivot('Other', OTHER_COLOR, other.rows ?? [], xs)] : [])];
  };

  const id = (f: { name: string }) => f.name;
  const items: MenuItem[] = [
    ...(cf.dates.length > 1 ? [{ kind: 'radio', label: 'Date field', value: date ? id(date) : '', options: cf.dates.map((d) => ({ value: id(d), label: columnTitle(d) })), onPick: (v: string) => onChange({ date: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Bucket', value: r.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v) => onChange({ bucket: v as Patch['bucket'] }) },
    ...(cf.metrics.length > 1 ? [{ kind: 'radio', label: 'Metric', value: id(metric!.field), options: cf.metrics.map((m) => ({ value: id(m.field), label: metricLabel(m) })), onPick: (v: string) => onChange({ metric: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Stack by', value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }, ...cf.dimensions.map((d) => ({ value: id(d), label: columnTitle(d) }))], onPick: (v) => onChange({ stack: v === '' ? null : v }) },
  ];
  const orient = (o: 'vertical' | 'horizontal', label: string, Icon: typeof ChartColumn) => (
    <button key={o} type="button" aria-label={label} aria-pressed={r.orientation === o} onClick={() => onChange({ orientation: o })}
      className={`inline-flex size-7 items-center justify-center rounded-md hover:bg-accent ${r.orientation === o ? 'bg-accent' : ''}`}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
  const title = `${metricLabel(metric!)} by ${BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase()}`;
  const full = stack ? `${title} · by ${fieldLabel(stack)}` : title;
  return (
    <ChartPanel title={bucket ? full : `${metricLabel(metric!)} by date`} loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})}
      empty={emptyNow ? (hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.') : null}
      note={stack ? `Rows with a blank ${fieldLabel(stack)} are not shown.` : undefined}
      actions={ready && <>{orient('vertical', 'Vertical bars', ChartColumn)}{orient('horizontal', 'Horizontal bars', ChartBar)}<ChartMenu name="Time series" items={items} /></>}>
      {series.rows && <BarChart series={chart()} orientation={r.orientation} ariaLabel={full} formatTick={tick} />}
    </ChartPanel>
  );
}
