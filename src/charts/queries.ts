// Backend queries behind every number the charts show: the plugin never sums, counts or buckets data itself.
// The one exception is the Sankey (decision 7 in the chart-list spec): it adds up the rows of one grouped read into top values, (blank) and Other
// per column, for additive measures only (pieMeasures). Its column totals still come from their own reads, so node sizes stay exact.
import { aggregatedKey, allowedFunctions, isTimeZone, zonesBuckets, type AggFn, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import { uniqueKey } from '../model/unique-count';
import type { TraverseFilter, TraverseOptions } from '../sdk/types';
import type { ChartFields, ChartMart, Metric } from './fields';

export const TOP_N = 8;

/** What a time series or top list counts: a metric, or a mart's records (its unique count on the mart's alias path, '' for the main one). */
export type Measure = { kind: 'metric'; metric: Metric } | { kind: 'records'; aliasPath: string; recordsId: string };

/** A calculated metric has no function, so its row key is its column name as it is. */
export const metricKey = (m: Metric): string => (m.fn ? aggregatedKey(m.field.name, m.fn) : m.field.name);
/** The row key of a mart's unique count (the backend's contract: each dot of the alias path becomes `_`). */
export { uniqueKey };
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
const measureParts = (m: Measure): Pick<TraverseOptions, 'aggregation' | 'uniqueCount'> => (m.kind === 'metric' ? aggsOf([m.metric]) : { uniqueCount: [m.aliasPath] });
/** The rules of the metrics that have a function. A calculated metric has none (the backend refuses one), so it is named in `column` only; no rule left, no `aggregation` key. */
const aggs = (metrics: Metric[]) => metrics.flatMap((m) => (m.fn ? [{ column: m.field.name, function: m.fn }] : []));
const aggsOf = (metrics: Metric[]): Pick<TraverseOptions, 'aggregation'> => { const rules = aggs(metrics); return rules.length ? { aggregation: rules } : {}; };

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

/**
 * `null` when there is nothing to count. `kept` are the alias paths of marts the report keeps with no column that have a usable key:
 * their unique count rides on this read (it counts the records of the report), and they draw no scorecard.
 */
export function scorecardsQuery(marts: ChartMart[], filter: TraverseFilter[], counter?: Field | null, kept: readonly string[] = []): TraverseOptions | null {
  const metrics = marts.flatMap((m) => m.metrics);
  const keyed = marts.filter((m) => m.hasPk).map((m) => m.aliasPath);
  const uniqueCount = [...new Set([...keyed, ...kept])];
  // Kept paths alone are no query: with no metric and no key on a mart with a column the charts show their hint and read nothing.
  if (!metrics.length && !keyed.length) return null;
  const o: TraverseOptions = {
    ...(metrics.length ? { column: metrics.map((m) => m.field.name), ...aggsOf(metrics) } : {}),
    ...(uniqueCount.length ? { uniqueCount } : {}),
  };
  return withFilter(withCounter(o, filter, counter), filter);
}

/** The one scorecard query of a grid, for Table and for Charts: both ask with this, so one billed read answers both and its cache key is shared. */
export const scoreQuery = (cf: ChartFields, filter: TraverseFilter[], kept: readonly string[] = []): TraverseOptions | null => scorecardsQuery(cf.marts, filter, cf.counter, kept);

/** A rule that the scorecard query was built without: a slice needs an explicit column list, which a mart with no metric and no countable field cannot give it. The read would be unfiltered. */
export const scoreRulesLost = (filter: TraverseFilter[], o: TraverseOptions | null): boolean =>
  !!o && filter.filter((f) => f.placement === 'pre-join').length !== (o.filter ?? []).filter((f) => f.placement === 'pre-join').length;

/** The same ask with no metric: what the counts need and nothing else. A cached read of the same rules that holds these counts answers it. */
export const countsOf = (o: TraverseOptions): TraverseOptions => ({ ...(o.uniqueCount ? { uniqueCount: o.uniqueCount } : {}), ...(o.filter ? { filter: o.filter } : {}) });

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
    ...aggsOf(mart.metrics),
    dateTrunc: [truncRule(date, bucket)],
    ...(mart.hasPk ? { uniqueCount: [mart.aliasPath] } : {}),
    sort: [{ column: date.name, direction: 'asc' }],
  };
  return withFilter(o, filter);
}

// A top list holds real values only (the blank one is read apart, see `blankRule`), because `in` and `not_in` never match NULL.
// A boolean dimension's values arrive as booleans; the filter takes strings.
const list = (top: string[]): string[] => top.map(String);
const blankRule = (dim: Field): TraverseFilter => ({ column: dim.name, operator: 'is_blank' });
/** The rows outside a top list: a real value that is none of the top ones. Blank rows are the blank category's, never "Other" (NOT IN drops NULL on a real backend, the explicit rule makes any backend agree). */
const outside = (dim: Field, top: string[]): TraverseFilter[] => [{ column: dim.name, operator: 'is_not_blank' }, { column: dim.name, operator: 'not_in', value: list(top) }];

export function topValuesQuery(dim: Field, measure: Measure, filter: TraverseFilter[]): TraverseOptions {
  const o: TraverseOptions = {
    column: [dim.name, ...measureColumns(measure)],
    ...measureParts(measure),
    sort: [{ column: measure.kind === 'metric' ? measure.metric.field.name : measureKey(measure), direction: 'desc' }],
    limit: TOP_N,
  };
  return withFilter(o, filter);
}

export function seriesQuery(date: Field, bucket: DateBucket, measure: Measure, filter: TraverseFilter[], stack?: { dim: Field; top: string[] }): TraverseOptions {
  const o: TraverseOptions = {
    column: [date.name, ...(stack ? [stack.dim.name] : []), ...measureColumns(measure)],
    ...measureParts(measure),
    dateTrunc: [truncRule(date, bucket)],
    sort: [{ column: date.name, direction: 'asc' }],
  };
  return withFilter(o, stack ? [...filter, { column: stack.dim.name, operator: 'in', value: list(stack.top) }] : filter);
}

/** The series of the blank value of a stack dimension: the measure by bucket over the rows where `dim` is blank. */
export const seriesBlankQuery = (date: Field, bucket: DateBucket, measure: Measure, filter: TraverseFilter[], dim: Field): TraverseOptions =>
  seriesQuery(date, bucket, measure, [...filter, blankRule(dim)]);

export const seriesOtherQuery = (date: Field, bucket: DateBucket, measure: Measure, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions =>
  seriesQuery(date, bucket, measure, [...filter, ...outside(dim, top)]);

export function pieOtherQuery(measure: Measure, filter: TraverseFilter[], dim: Field, top: string[], counter?: Field | null): TraverseOptions {
  const o: TraverseOptions = { ...(measure.kind === 'metric' ? { column: measureColumns(measure) } : {}), ...measureParts(measure) };
  return withFilter(withCounter(o, filter, counter), [...filter, ...outside(dim, top)]);
}

/** The measure over the rows where `dim` is blank: one row, read apart because a top list cannot name NULL. */
export function pieBlankQuery(measure: Measure, filter: TraverseFilter[], dim: Field, counter?: Field | null): TraverseOptions {
  const o: TraverseOptions = { ...(measure.kind === 'metric' ? { column: measureColumns(measure) } : {}), ...measureParts(measure) };
  return withFilter(withCounter(o, filter, counter), [...filter, blankRule(dim)]);
}

export const SCATTER_LIMIT = 200;
/** A heatmap axis' values: the listed real ones, or `null` for the blank value alone (a list cannot name NULL). */
export type HeatX = { kind: 'date'; date: Field; bucket: DateBucket } | { kind: 'dim'; dim: Field; top: string[] | null };
const axisRule = (dim: Field, top: string[] | null): TraverseFilter => (top === null ? blankRule(dim) : { column: dim.name, operator: 'in', value: list(top) });

/** One cell per (x, y): rows kept to the top values of y (and of x when it is a dimension); a date x is bucketed. A `null` list reads the blank value of that axis alone. */
export function heatmapQuery(x: HeatX, y: Field, yTop: string[] | null, measure: Measure, filter: TraverseFilter[]): TraverseOptions {
  const xCol = x.kind === 'date' ? x.date.name : x.dim.name;
  const o: TraverseOptions = {
    column: [xCol, y.name, ...measureColumns(measure)],
    ...measureParts(measure),
    ...(x.kind === 'date' ? { dateTrunc: [truncRule(x.date, x.bucket)], sort: [{ column: xCol, direction: 'asc' as const }] } : {}),
  };
  const axes: TraverseFilter[] = [axisRule(y, yTop), ...(x.kind === 'dim' ? [axisRule(x.dim, x.top)] : [])];
  return { ...o, filter: [...fit(o, filter), ...axes] };
}

const columnsOf = (ms: Measure[]): string[] => [...new Set(ms.flatMap(measureColumns))];

/** Two measures per value of a dimension, the top SCATTER_LIMIT values by X. A sort on an aggregated column sorts by its first function, so X's rule comes first. */
export function scatterQuery(dim: Field, x: Measure, y: Measure, filter: TraverseFilter[]): TraverseOptions {
  const metrics = [x, y].flatMap((m) => (m.kind === 'metric' ? [m.metric] : []));
  const paths = [...new Set([x, y].flatMap((m) => (m.kind === 'records' ? [m.aliasPath] : [])))];
  const o: TraverseOptions = {
    column: [dim.name, ...columnsOf([x, y])],
    ...aggsOf(metrics),
    ...(paths.length ? { uniqueCount: paths } : {}),
    sort: [{ column: x.kind === 'metric' ? x.metric.field.name : measureKey(x), direction: 'desc' }],
    limit: SCATTER_LIMIT,
  };
  return withFilter(o, filter);
}

/** The most combinations the Sankey's flow read returns (largest first). A read that fills it leaves smaller flows out. */
export const SANKEY_FLOW_LIMIT = 5000;
/** The rows the ascending negative check reads: NULL sums may sort ahead of the smallest real one. */
export const SANKEY_LOW_LIMIT = 5;
/** The most distinct values one Sankey column's total read returns (largest first). Past it the smallest values are unread, so Other counts only the values read. */
export const SANKEY_COLUMN_LIMIT = 10000;

const bySize = (measure: Measure, direction: 'asc' | 'desc' = 'desc'): TraverseOptions['sort'] => [{ column: measure.kind === 'metric' ? measure.metric.field.name : measureKey(measure), direction }];

/** The measure per combination of values of all the Sankey's columns, largest first, capped at SANKEY_FLOW_LIMIT. A blank value comes back as a NULL group. */
export function sankeyFlowQuery(dims: Field[], measure: Measure, filter: TraverseFilter[], counter?: Field | null): TraverseOptions {
  const o: TraverseOptions = {
    column: [...dims.map((d) => d.name), ...measureColumns(measure)],
    ...measureParts(measure),
    sort: bySize(measure),
    limit: SANKEY_FLOW_LIMIT,
  };
  return withFilter(withCounter(o, filter, counter), filter);
}

/**
 * The smallest combinations: the flow read sorted the other way, a few rows. Read only when a metric's flow read is capped, to see whether the left-out flows hold a negative.
 * A HAVING `is_not_blank` on the aggregate keeps NULL sums out of the rows, so they cannot fill the few the read returns and hide the smallest real sum.
 */
export function sankeyLowQuery(dims: Field[], measure: Measure, filter: TraverseFilter[], counter?: Field | null): TraverseOptions {
  const o = sankeyFlowQuery(dims, measure, filter, counter);
  const notBlank: TraverseFilter[] = measure.kind === 'metric' && measure.metric.fn ? [{ column: measure.metric.field.name, operator: 'is_not_blank', function: measure.metric.fn }] : [];
  const rules = [...(o.filter ?? []), ...notBlank];
  return { ...o, ...(rules.length ? { filter: rules } : {}), sort: bySize(measure, 'asc'), limit: SANKEY_LOW_LIMIT };
}

/** The measure per value of one Sankey column (blank included), largest first, capped at SANKEY_COLUMN_LIMIT: exact node sizes. */
export function sankeyColumnQuery(dim: Field, measure: Measure, filter: TraverseFilter[], counter?: Field | null): TraverseOptions {
  const o: TraverseOptions = {
    column: [dim.name, ...measureColumns(measure)],
    ...measureParts(measure),
    sort: bySize(measure),
    limit: SANKEY_COLUMN_LIMIT,
  };
  return withFilter(withCounter(o, filter, counter), filter);
}

/** The functions a spread reads:the median first (it sorts the rows), the quartiles, and the whiskers when governance allows them. Empty when a percentile is not allowed. */
export function spreadFns(field: Field): AggFn[] {
  const allowed = allowedFunctions(field);
  if (!(['P25', 'P50', 'P75'] as const).every((fn) => allowed.includes(fn))) return [];
  return ['P50', 'P25', 'P75', ...(allowed.includes('MIN') && allowed.includes('MAX') ? (['MIN', 'MAX'] as const) : [])];
}

export function spreadQuery(dim: Field, field: Field, filter: TraverseFilter[]): TraverseOptions {
  const o: TraverseOptions = {
    column: [dim.name, field.name],
    aggregation: spreadFns(field).map((fn) => ({ column: field.name, function: fn })),
    sort: [{ column: field.name, direction: 'desc' }],
    limit: TOP_N,
  };
  return withFilter(o, filter);
}
