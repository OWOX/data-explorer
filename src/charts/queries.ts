// Backend queries behind every number the charts show: the plugin never sums, counts or buckets data itself.
import { aggregatedKey, isTimeZone, zonesBuckets, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { TraverseFilter, TraverseOptions } from '../sdk/types';
import type { ChartMart, Metric } from './fields';

export const TOP_N = 8;

/** What a time series or top list counts: a metric, or a mart's records (its unique count on the mart's alias path, '' for the main one). */
export type Measure = { kind: 'metric'; metric: Metric } | { kind: 'records'; aliasPath: string; recordsId: string };

export const metricKey = (m: Metric): string => aggregatedKey(m.field.name, m.fn);
/** The row key of a mart's unique count (the backend's contract: each dot of the alias path becomes `_`). */
export const uniqueKey = (aliasPath: string): string => (aliasPath === '' ? 'Unique Count' : `${aliasPath.replaceAll('.', '_')}__unique_count`);
export const measureKey = (m: Measure): string => (m.kind === 'metric' ? metricKey(m.metric) : uniqueKey(m.aliasPath));
export const rangeKeys = (date: Field): { min: string; max: string } => ({ min: aggregatedKey(date.name, 'MIN'), max: aggregatedKey(date.name, 'MAX') });

/** The grid's rules that this query can carry. Charts show the data before HAVING, so no HAVING rule goes out. A slice needs an explicit column list, which `withCounter` gives a query that has none. */
const fit = (o: TraverseOptions, filter: TraverseFilter[]): TraverseFilter[] => filter.filter((f) => {
  if (f.function) return false;
  if (f.placement === 'pre-join') return !!o.column?.length;
  return true;
});
/** A query with a slice and no column (a records count) reads one COUNT of `counter`: an aggregated column does not group the rows, and nobody reads its value. Without a counter the slice is left out. */
const withCounter = (o: TraverseOptions, filter: TraverseFilter[], counter?: Field | null): TraverseOptions =>
  !o.column?.length && counter && filter.some((f) => f.placement === 'pre-join')
    ? { ...o, column: [counter.name], aggregation: [...(o.aggregation ?? []), { column: counter.name, function: 'COUNT' }] }
    : o;
const withFilter = (o: TraverseOptions, filter: TraverseFilter[]): TraverseOptions => { const kept = fit(o, filter); return kept.length ? { ...o, filter: kept } : o; };
// A metric reads its column with an aggregation; records read the unique count and name no column.
const measureColumns = (m: Measure): string[] => (m.kind === 'metric' ? [m.metric.field.name] : []);
const measureParts = (m: Measure): Pick<TraverseOptions, 'aggregation' | 'uniqueCount'> => (m.kind === 'metric' ? { aggregation: aggs([m.metric]) } : { uniqueCount: [m.aliasPath] });
const aggs = (metrics: Metric[]) => metrics.map((m) => ({ column: m.field.name, function: m.fn }));

// The browser's zone, read once: resolving it builds an Intl formatter, and every query builder asks on every render.
let browserZoneName: string | undefined;
const browserZone = (): string => (browserZoneName ??= Intl.DateTimeFormat().resolvedOptions().timeZone);

/** The IANA zone a date column's buckets are cut in (the browser's), or undefined when they are not zoned. Shared by the series queries and the click filters. */
export function bucketZone(date: Field, zone: string = browserZone()): string | undefined {
  return zonesBuckets(date) && isTimeZone(zone) ? zone : undefined;
}
function truncRule(date: Field, unit: DateBucket) {
  const zone = bucketZone(date);
  return { column: date.name, unit, ...(zone ? { timeZone: zone } : {}) };
}

/** `null` when there is nothing to count. */
export function scorecardsQuery(marts: ChartMart[], filter: TraverseFilter[], counter?: Field | null): TraverseOptions | null {
  const metrics = marts.flatMap((m) => m.metrics);
  const uniqueCount = marts.filter((m) => m.hasPk).map((m) => m.aliasPath);
  if (!metrics.length && !uniqueCount.length) return null;
  const o: TraverseOptions = {
    ...(metrics.length ? { column: metrics.map((m) => m.field.name), aggregation: aggs(metrics) } : {}),
    ...(uniqueCount.length ? { uniqueCount } : {}),
  };
  return withFilter(withCounter(o, filter, counter), filter);
}

export function rangeQuery(date: Field, filter: TraverseFilter[]): TraverseOptions {
  return withFilter({ column: [date.name], aggregation: [{ column: date.name, function: 'MIN' }, { column: date.name, function: 'MAX' }] }, filter);
}

/** The date's distinct months, oldest first: Auto's range for a date whose governance forbids MIN or MAX (no aggregation, so none applies). */
export function monthsQuery(date: Field, filter: TraverseFilter[]): TraverseOptions {
  return withFilter({ column: [date.name], dateTrunc: [truncRule(date, 'MONTH')], sort: [{ column: date.name, direction: 'asc' }] }, filter);
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
/** The rows outside a top list: a real value that is none of the top ones. */
const outside = (dim: Field, top: string[]): TraverseFilter[] => [notBlank(dim), { column: dim.name, operator: 'not_in', value: list(top) }];

export function topValuesQuery(dim: Field, measure: Measure, filter: TraverseFilter[]): TraverseOptions {
  const o: TraverseOptions = {
    column: [dim.name, ...measureColumns(measure)],
    ...measureParts(measure),
    sort: [{ column: measure.kind === 'metric' ? measure.metric.field.name : measureKey(measure), direction: 'desc' }],
    limit: TOP_N,
  };
  return { ...o, filter: [...fit(o, filter), notBlank(dim)] };
}

export function seriesQuery(date: Field, bucket: DateBucket, measure: Measure, filter: TraverseFilter[], stack?: { dim: Field; top: string[] }): TraverseOptions {
  const o: TraverseOptions = {
    column: [date.name, ...(stack ? [stack.dim.name] : []), ...measureColumns(measure)],
    ...measureParts(measure),
    dateTrunc: [truncRule(date, bucket)],
    sort: [{ column: date.name, direction: 'asc' }],
  };
  return withFilter(o, stack ? [...filter, notBlank(stack.dim), { column: stack.dim.name, operator: 'in', value: list(stack.top) }] : filter);
}

export const seriesOtherQuery = (date: Field, bucket: DateBucket, measure: Measure, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions =>
  seriesQuery(date, bucket, measure, [...filter, ...outside(dim, top)]);

export function pieOtherQuery(measure: Measure, filter: TraverseFilter[], dim: Field, top: string[], counter?: Field | null): TraverseOptions {
  const o: TraverseOptions = { ...(measure.kind === 'metric' ? { column: measureColumns(measure) } : {}), ...measureParts(measure) };
  return withFilter(withCounter(o, filter, counter), [...filter, ...outside(dim, top)]);
}
