import { formatBucket, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import type { ChartFields } from './fields';
import { BLANK_COLOR, BLANK_KEY, BLANK_LABEL, OTHER_KEY, blankFirst, isBlankKey, keyOf } from './blank';
import { measureKey, seriesBlankQuery, seriesOtherQuery, seriesQuery, TOP_N, topValuesQuery, type Measure } from './queries';
import { measureLabel, measureText, numberOf, sharedSeriesQuery, type Formatter } from './Scorecards';
import type { Spark } from './settings';
import type { Series } from './svg/BarChart';
import { labelColors, slotColor } from './labelColor';
import { useChartQuery } from './useChartQuery';

export const OTHER_COLOR = 'var(--dm-other)';

type DateSeries = { series: Series[] | null; failed: { error: unknown; retry: () => void } | undefined; empty: boolean; loading: boolean; label: string; names: string[] | undefined };

/**
 * A measure over a date, one point per bucket, split by a dimension's top values plus "Other" when `stack` is set.
 * Unstacked, it rides on the sparklines' read when it can (same key, one billed read). Each value is a returned row's value.
 */
export function useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, hold, formatOf, range, scope }: {
  martId: string; cf: ChartFields; spark: Spark; date: Field; bucket: DateBucket | null; measure: Measure; stack: Field | null;
  filter: TraverseFilter[]; version: number; idle: boolean; hold?: boolean; formatOf: Formatter; range?: { error: unknown; retry: () => void };
  /** The measures shown together with this one, so its label names its mart when they span more than one. */
  scope?: Measure[];
}): DateSeries {
  const live = !idle && !!bucket;
  // The top values do not depend on the bucket, so they are read while the Auto range is still loading.
  const top = useChartQuery(martId, !idle && stack ? topValuesQuery(stack, measure, filter) : null, version, undefined, undefined, hold);
  const keys = top.rows?.map((row) => keyOf(row[stack!.name]));
  // A top list cannot name NULL: `names` are the real values, the blank one is read apart.
  const names = keys?.filter((k) => !isBlankKey(k));
  const full = top.rows?.length === TOP_N;
  // The blank series is read when it ranked in the top list, or when the list was full and it may be beyond it.
  const needBlank = !!stack && !!keys && (keys.some(isBlankKey) || full);
  // Unstacked, the series asks for the sparklines' read when it can (same key, one billed read for both). If that read fails, the series reads for itself, so the chart is never worse off than with its own read.
  const sharedOptions = live && !stack ? sharedSeriesQuery(cf, spark, measure, bucket, filter, date) : null;
  const shared = useChartQuery(martId, sharedOptions, version, undefined, undefined, hold);
  const viaShared = !!sharedOptions && !shared.error;
  // With a stack the series query waits for the top values.
  const hasNames = !!names && names.length > 0;
  const own = useChartQuery(martId, live && !viaShared && (!stack || hasNames) ? seriesQuery(date, bucket!, measure, filter, stack ? { dim: stack, top: names! } : undefined) : null, version, undefined, undefined, hold);
  const series = viaShared ? shared : own;
  const blank = useChartQuery(martId, live && needBlank ? seriesBlankQuery(date, bucket!, measure, filter, stack!) : null, version, undefined, undefined, hold);
  const other = useChartQuery(martId, live && full ? seriesOtherQuery(date, bucket!, measure, filter, stack!, names!) : null, version, undefined, undefined, hold);
  const key = measureKey(measure);
  // A series only when its read returned a value: an all-null row would be an empty series with a legend entry.
  const hasValue = (rows: Row[] | null) => !!rows?.some((x) => x[key] != null);
  const hasOther = full && hasValue(other.rows);
  const hasBlank = needBlank && hasValue(blank.rows);
  const label = measureLabel(cf, measure, scope);
  const failed = [...(range ? [range] : []), top, series, blank, other].find((q) => q.error);
  const empty = stack ? top.rows?.length === 0 : series.rows?.length === 0;
  const mainDone = !!series.rows || (!!stack && !!keys && !hasNames);
  const loading = !empty && (!bucket || !mainDone || (full && !other.rows) || (needBlank && !blank.rows));
  if (!mainDone || loading || empty) return { series: null, failed, empty: !!empty, loading, label, names };

  const cell = (row: Row | undefined) => ({ y: row ? numberOf(row[key]) : null, valueText: row ? measureText(measure, row[key], formatOf) : '' });
  const pivot = (name: string, color: string, rows: Row[], xs: string[], key?: string): Series => {
    const at = new Map(rows.map((x) => [keyOf(x[date.name]), x]));
    return { ...(key !== undefined ? { key } : {}), name, color, points: xs.map((x) => ({ x, label: isBlankKey(x) ? BLANK_LABEL : formatBucket(x, bucket!) ?? x, ...cell(at.get(x)) })) };
  };
  const mainRows = series.rows ?? [];
  const all = [...mainRows, ...(blank.rows ?? []), ...(other.rows ?? [])];
  // ISO dates sort as text, the blank bucket first; the queries return them ascending, this only merges the extra reads' buckets in.
  const xs = blankFirst([...new Set(all.map((x) => keyOf(x[date.name])))].sort());
  if (!stack) return { series: [pivot(label, slotColor(0), mainRows, xs)], failed, empty: !!empty, loading, label, names };
  const rowsOf = (n: string) => mainRows.filter((x) => keyOf(x[stack.name]) === n);
  // Each value keeps the colour its text hashes to, so it matches the same value in a pie or a Sankey.
  const colors = labelColors(names!);
  const out = [
    ...(hasBlank ? [{ ...pivot(BLANK_LABEL, BLANK_COLOR, blank.rows ?? [], xs, BLANK_KEY), blank: true }] : []),
    ...names!.map((n) => pivot(n, colors.get(n)!, rowsOf(n), xs, n)),
    ...(hasOther ? [{ ...pivot('Other', OTHER_COLOR, other.rows ?? [], xs, OTHER_KEY), other: true }] : []),
  ];
  return { series: out, failed, empty: !!empty, loading, label, names };
}
