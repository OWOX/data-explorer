import { formatBucket, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import type { ChartFields } from './fields';
import { dateFilter, measureKey, seriesOtherQuery, seriesQuery, TOP_N, topValuesQuery, type Measure } from './queries';
import { measureLabel, measureText, numberOf, sharedSeriesQuery, type Formatter } from './Scorecards';
import type { Spark } from './settings';
import type { Series } from './svg/BarChart';
import { useChartQuery } from './useChartQuery';

export const seriesColor = (i: number): string => `var(--dm-series-${i + 1})`;
export const OTHER_COLOR = 'var(--dm-series-9)';

export type DateSeries = { series: Series[] | null; failed: { error: unknown; retry: () => void } | undefined; empty: boolean; loading: boolean; label: string; names: string[] | undefined };

/**
 * A measure over a date, one point per bucket, split by a dimension's top values plus "Other" when `stack` is set.
 * Unstacked, it rides on the sparklines' read when it can (same key, one billed read). Each value is a returned row's value.
 */
export function useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, blanks = false, version, idle, formatOf, range }: {
  martId: string; cf: ChartFields; spark: Spark; date: Field; bucket: DateBucket | null; measure: Measure; stack: Field | null;
  filter: TraverseFilter[]; /** Keep rows with a blank date. */ blanks?: boolean; version: number; idle: boolean; formatOf: Formatter; range?: { error: unknown; retry: () => void };
}): DateSeries {
  const live = !idle && !!bucket;
  // The stack's top values read the grid's filter as it is; the series reads leave out blank dates.
  const seriesFilter = dateFilter(filter, date, blanks);
  // The top values do not depend on the bucket, so they are read while the Auto range is still loading.
  const top = useChartQuery(martId, !idle && stack ? topValuesQuery(stack, measure, filter) : null, version);
  const names = top.rows?.map((row) => String(row[stack!.name]));
  // Unstacked and without blanks, the series asks for the sparklines' read when it can (same key, one billed read for both; both drop blank dates). With blanks kept its filter differs, so it reads for itself. If that read fails, the series reads for itself, so the chart is never worse off than with its own read.
  const sharedOptions = live && !stack && !blanks ? sharedSeriesQuery(cf, spark, measure, bucket, filter, date) : null;
  const shared = useChartQuery(martId, sharedOptions, version);
  const viaShared = !!sharedOptions && !shared.error;
  // With a stack the series query waits for the top values.
  const own = useChartQuery(martId, live && !viaShared && (!stack || (names && names.length > 0)) ? seriesQuery(date, bucket!, measure, seriesFilter, stack ? { dim: stack, top: names! } : undefined) : null, version);
  const series = viaShared ? shared : own;
  const needOther = !!stack && names?.length === TOP_N;
  const other = useChartQuery(martId, live && needOther ? seriesOtherQuery(date, bucket!, measure, seriesFilter, stack!, names!) : null, version);
  // Other only when the not_in query returned a value: an all-null row would be an empty series with a legend entry.
  const hasOther = needOther && !!other.rows?.some((x) => x[measureKey(measure)] != null);
  const label = measureLabel(cf, measure);
  const failed = [...(range ? [range] : []), top, series, other].find((q) => q.error);
  const empty = stack ? top.rows?.length === 0 : series.rows?.length === 0;
  const loading = !empty && (!bucket || !series.rows || (needOther && !other.rows));
  if (!series.rows || loading || empty) return { series: null, failed, empty: !!empty, loading, label, names };

  const key = measureKey(measure);
  const cell = (row: Row | undefined) => ({ y: row ? numberOf(row[key]) : null, valueText: row ? measureText(measure, row[key], formatOf) : '' });
  const pivot = (name: string, color: string, rows: Row[], xs: string[]): Series => {
    const at = new Map(rows.map((x) => [String(x[date.name]), x]));
    return { name, color, points: xs.map((x) => ({ x, label: formatBucket(x, bucket!) ?? x, ...cell(at.get(x)) })) };
  };
  const all = [...series.rows, ...(other.rows ?? [])];
  // ISO dates sort as text; the queries return them ascending, this only merges the Other query's buckets in.
  const xs = [...new Set(all.map((x) => String(x[date.name])))].sort();
  if (!stack) return { series: [pivot(label, seriesColor(0), series.rows, xs)], failed, empty: !!empty, loading, label, names };
  const rowsOf = (n: string) => series.rows!.filter((x) => String(x[stack.name]) === n);
  const out = [...names!.map((n, i) => pivot(n, seriesColor(i), rowsOf(n), xs)), ...(hasOther ? [{ ...pivot('Other', OTHER_COLOR, other.rows ?? [], xs), other: true }] : [])];
  return { series: out, failed, empty: !!empty, loading, label, names };
}
