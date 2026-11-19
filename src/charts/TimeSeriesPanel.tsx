import { ChartBar, ChartColumn } from 'lucide-react';
import type { ColumnFilter } from '../filters/build';
import { AUTO, formatValue, keepsUnit, type Format } from '../format/formats';
import { BUCKET_LABELS, DATE_BUCKETS, formatBucket, outputType, type DateBucket } from '../model/aggregation';
import { columnTitle, fieldLabel } from '../model/fieldLabel';
import type { Row, TraverseFilter } from '../sdk/types';
import { formatNumber } from '../ui/format';
import { bucketFilter, dimensionFilter } from './clickFilters';
import { compactValue } from './compact';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { ChartPanel } from './ChartPanel';
import { measuresOf, type ChartFields } from './fields';
import { measureKey, seriesOtherQuery, seriesQuery, TOP_N, topValuesQuery } from './queries';
import { measureLabel, measureOptions, metricText, numberOf, type Formatter } from './Scorecards';
import { measureId, type ChartSettings, type ResolvedCharts } from './settings';
import { BarChart, type Series } from './svg/BarChart';
import { useChartQuery } from './useChartQuery';

type Patch = NonNullable<ChartSettings['timeSeries']>;
export const seriesColor = (i: number): string => `var(--dm-series-${i + 1})`;
export const OTHER_COLOR = 'var(--dm-series-9)';

/** An axis tick in the measure's format: short ($10.2K) when it has a short form, else the value (rounded to 2 decimals unless the format scales or rounds it itself; a tick is a drawing position, a fraction of the largest total). */
export const tickText = (n: number, type: string, format: Format): string => compactValue(n, type, format) ?? formatValue(format.kind === 'percent' || format.kind === 'money' ? n : Number(n.toFixed(2)), type, format);

/**
 * The metric over time, one bar per bucket, stacked by a dimension's top values plus "Other" when chosen. Each value on
 * screen is a returned row's value; the pivot below only places returned numbers under their bucket.
 */
export function TimeSeriesPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, bucket, range, ready, onChange, onFilter }: {
  martId: string; cf: ChartFields; r: ResolvedCharts; filter: TraverseFilter[]; version: number; idle: boolean; hasFilters: boolean; formatOf: Formatter;
  bucket: DateBucket | null; range: { error: unknown; retry: () => void }; ready: boolean; onChange: (patch: Patch) => void; onFilter: (add: ColumnFilter[]) => void;
}) {
  const { date, measure, stack } = r;
  const live = !idle && !!date && !!measure && !!bucket;
  // The top values do not depend on the bucket, so they are read while the Auto range is still loading.
  const top = useChartQuery(martId, !idle && date && measure && stack ? topValuesQuery(stack, measure, filter) : null, version);
  const names = top.rows?.map((row) => String(row[stack!.name]));
  // Without a stack the series query needs nothing else; with one it waits for the top values.
  const series = useChartQuery(martId, live && (!stack || (names && names.length > 0)) ? seriesQuery(date!, bucket!, measure!, filter, stack ? { dim: stack, top: names! } : undefined) : null, version);
  const needOther = !!stack && names?.length === TOP_N;
  const other = useChartQuery(martId, live && needOther ? seriesOtherQuery(date!, bucket!, measure!, filter, stack!, names!) : null, version);

  // Other only when the not_in query returned a value: an all-null row would be an empty series with a legend entry.
  const hasOther = needOther && !!other.rows?.some((x) => x[measureKey(measure!)] != null);
  const label = measureLabel(cf, measure!);
  const failed = [{ error: range.error, retry: range.retry }, top, series, other].find((q) => q.error);
  const emptyNow = stack ? top.rows?.length === 0 : series.rows?.length === 0;
  const loading = !emptyNow && (!bucket || !series.rows || (needOther && !other.rows));

  const chart = (): Series[] => {
    const key = measureKey(measure!);
    const cell = (row: Row | undefined) => ({ y: row ? numberOf(row[key]) : null, valueText: row ? (measure!.kind === 'metric' ? metricText(measure!.metric.field, measure!.metric.fn, row[key], formatOf) : formatNumber(row[key]) ?? String(row[key] ?? '')) : '' });
    const byDate = (rows: Row[]) => new Map(rows.map((x) => [String(x[date!.name]), x]));
    const pivot = (name: string, color: string, rows: Row[], xs: string[]): Series => {
      const at = byDate(rows);
      return { name, color, points: xs.map((x) => ({ x, label: formatBucket(x, bucket!) ?? x, ...cell(at.get(x)) })) };
    };
    const all = [...(series.rows ?? []), ...(other.rows ?? [])];
    // ISO dates sort as text; the queries return them ascending, this only merges the Other query's buckets in.
    const xs = [...new Set(all.map((x) => String(x[date!.name])))].sort();
    if (!stack) return [pivot(label, seriesColor(0), series.rows ?? [], xs)];
    const rowsOf = (n: string) => (series.rows ?? []).filter((x) => String(x[stack.name]) === n);
    return [...names!.map((n, i) => pivot(n, seriesColor(i), rowsOf(n), xs)), ...(hasOther ? [{ ...pivot('Other', OTHER_COLOR, other.rows ?? [], xs), other: true }] : [])];
  };

  // The axis follows the measure as its values do: a metric's output type and format, Records an integer count.
  const [tickType, tickFormat]: [string, Format] = measure!.kind === 'metric'
    ? (() => { const f = measure!.metric.field; const t = outputType(f, measure!.metric.fn); return [t, keepsUnit(measure!.metric.fn) ? formatOf(f.name, t) : AUTO] as [string, Format]; })()
    : ['INTEGER', AUTO];
  const id = (f: { name: string }) => f.name;
  // Each mart's records, then its metrics, in group order.
  const measures = measureOptions(cf, measuresOf(cf));
  const items: MenuItem[] = [
    ...(cf.dates.length > 1 ? [{ kind: 'radio', label: 'Date field', value: date ? id(date) : '', options: cf.dates.map((d) => ({ value: id(d), label: columnTitle(d) })), onPick: (v: string) => onChange({ date: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Bucket', value: r.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v) => onChange({ bucket: v as Patch['bucket'] }) },
    ...(measures.length > 1 ? [{ kind: 'radio', label: 'Metric', value: measureId(measure!, cf.marts[0]?.martId ?? ''), options: measures, onPick: (v: string) => onChange({ metric: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Stack by', value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }, ...cf.dimensions.map((d) => ({ value: id(d), label: columnTitle(d) }))], onPick: (v) => onChange({ stack: v === '' ? null : v }) },
  ];
  const orient = (o: 'vertical' | 'horizontal', label: string, Icon: typeof ChartColumn) => (
    <button key={o} type="button" aria-label={label} aria-pressed={r.orientation === o} onClick={() => onChange({ orientation: o })}
      className={`inline-flex size-7 items-center justify-center rounded-md hover:bg-accent ${r.orientation === o ? 'bg-accent' : ''}`}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
  const title = `${label} by ${BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase()}`;
  const full = stack ? `${title} · by ${fieldLabel(stack)}` : title;
  return (
    <ChartPanel title={bucket ? full : `${label} by date`} loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})}
      empty={emptyNow ? (hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.') : null}
      note={stack ? `Rows with a blank ${fieldLabel(stack)} are not shown.` : undefined}
      actions={ready && <>{orient('vertical', 'Vertical bars', ChartColumn)}{orient('horizontal', 'Horizontal bars', ChartBar)}<ChartMenu name="Time series" items={items} /></>}>
      {series.rows && (() => {
        const shown = chart();
        // The bucket's date range, plus (stacked) the segment's value of the stack dimension.
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date!, x, bucket!), ...(stack && i !== undefined && !shown[i]!.other ? [dimensionFilter(stack, shown[i]!.name)] : [])]);
        return <BarChart series={shown} orientation={r.orientation} ariaLabel={full} formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={bucket ? pick : undefined} />;
      })()}
    </ChartPanel>
  );
}
