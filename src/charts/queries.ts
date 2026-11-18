// Backend queries behind every number the charts show: the plugin never sums, counts or buckets data itself.
import { aggregatedKey, canZone, isTimeZone, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { TraverseFilter, TraverseOptions } from '../sdk/types';
import type { ChartMart, Metric } from './fields';

export const TOP_N = 8;

export const metricKey = (m: Metric): string => aggregatedKey(m.field.name, m.fn);
/** The row key of a mart's unique count (the backend's contract: each dot of the alias path becomes `_`). */
export const uniqueKey = (aliasPath: string): string => (aliasPath === '' ? 'Unique Count' : `${aliasPath.replaceAll('.', '_')}__unique_count`);
export const rangeKeys = (date: Field): { min: string; max: string } => ({ min: aggregatedKey(date.name, 'MIN'), max: aggregatedKey(date.name, 'MAX') });

const withFilter = (o: TraverseOptions, filter: TraverseFilter[]): TraverseOptions => (filter.length ? { ...o, filter } : o);
const aggs = (metrics: Metric[]) => metrics.map((m) => ({ column: m.field.name, function: m.fn }));

// The same zone rule the grid uses: only a type with a time of day can be converted, and only to a valid IANA name.
function truncRule(date: Field, unit: DateBucket) {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return { column: date.name, unit, ...(canZone(date) && isTimeZone(zone) ? { timeZone: zone } : {}) };
}

/** `null` when there is nothing to count. */
export function scorecardsQuery(marts: ChartMart[], filter: TraverseFilter[]): TraverseOptions | null {
  const metrics = marts.flatMap((m) => m.metrics);
  const uniqueCount = marts.filter((m) => m.hasPk).map((m) => m.aliasPath);
  if (!metrics.length && !uniqueCount.length) return null;
  const o: TraverseOptions = {
    ...(metrics.length ? { column: metrics.map((m) => m.field.name), aggregation: aggs(metrics) } : {}),
    ...(uniqueCount.length ? { uniqueCount } : {}),
  };
  return withFilter(o, filter);
}

export function rangeQuery(date: Field, filter: TraverseFilter[]): TraverseOptions {
  return withFilter({ column: [date.name], aggregation: [{ column: date.name, function: 'MIN' }, { column: date.name, function: 'MAX' }] }, filter);
}

export function sparklineQuery(mart: ChartMart, date: Field, bucket: DateBucket, filter: TraverseFilter[]): TraverseOptions | null {
  if (!mart.metrics.length && !mart.hasPk) return null;
  const o: TraverseOptions = {
    column: [date.name, ...mart.metrics.map((m) => m.field.name)],
    ...(mart.metrics.length ? { aggregation: aggs(mart.metrics) } : {}),
    dateTrunc: [truncRule(date, bucket)],
    ...(mart.hasPk ? { uniqueCount: [mart.aliasPath] } : {}),
    sort: [{ column: date.name, direction: 'asc' }],
  };
  return withFilter(o, filter);
}

// Blank is its own concern: the "Other" bar and the top list both leave it out so every shown value is a real one.
const notBlank = (dim: Field): TraverseFilter => ({ column: dim.name, operator: 'is_not_blank' });
// A boolean dimension's values arrive as booleans; the filter takes strings.
const list = (top: string[]): string[] => top.map(String);

export function topValuesQuery(dim: Field, metric: Metric, filter: TraverseFilter[]): TraverseOptions {
  return {
    column: [dim.name, metric.field.name],
    aggregation: aggs([metric]),
    filter: [...filter, notBlank(dim)],
    sort: [{ column: metric.field.name, direction: 'desc' }],
    limit: TOP_N,
  };
}

export function seriesQuery(date: Field, bucket: DateBucket, metric: Metric, filter: TraverseFilter[], stack?: { dim: Field; top: string[] }): TraverseOptions {
  const o: TraverseOptions = {
    column: stack ? [date.name, stack.dim.name, metric.field.name] : [date.name, metric.field.name],
    aggregation: aggs([metric]),
    dateTrunc: [truncRule(date, bucket)],
    sort: [{ column: date.name, direction: 'asc' }],
  };
  return withFilter(o, stack ? [...filter, notBlank(stack.dim), { column: stack.dim.name, operator: 'in', value: list(stack.top) }] : filter);
}

export function seriesOtherQuery(date: Field, bucket: DateBucket, metric: Metric, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions {
  return withFilter(
    { column: [date.name, metric.field.name], aggregation: aggs([metric]), dateTrunc: [truncRule(date, bucket)], sort: [{ column: date.name, direction: 'asc' }] },
    [...filter, notBlank(dim), { column: dim.name, operator: 'not_in', value: list(top) }],
  );
}

export function pieOtherQuery(metric: Metric, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions {
  return withFilter({ column: [metric.field.name], aggregation: aggs([metric]) }, [...filter, notBlank(dim), { column: dim.name, operator: 'not_in', value: list(top) }]);
}
