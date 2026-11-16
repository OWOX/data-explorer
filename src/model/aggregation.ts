// Column aggregation in the Data grid: a port of the OWOX web app's report column picker (aggregation governance,
// applyAggregationDraft, aggregation labels) and of the traverseData row keys (`"<column> | <TOKEN>"`).
import type { Field, FieldCategory } from './types';

export const AGGREGATE_FUNCTIONS = ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'] as const;
export type AggFn = (typeof AGGREGATE_FUNCTIONS)[number];
export const DATE_BUCKETS = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
export type DateBucket = (typeof DATE_BUCKETS)[number];

export type AggregationRule = { column: string; function: AggFn };
export type DateTruncRule = { column: string; unit: DateBucket; timeZone?: string };
/** What a grid keeps: functions per column (in the order chosen) and one bucket per date column. */
export type Aggregation = { aggregations: AggregationRule[]; dateTrunc: DateTruncRule[] };
export const NO_AGGREGATION: Aggregation = { aggregations: [], dateTrunc: [] };

export const isGrouped = (a: Aggregation | undefined): boolean => !!a && (a.aggregations.length > 0 || a.dateTrunc.length > 0);

/** Title Case label per function (mirror of the backend REPORT_AGGREGATE_FUNCTION_LABELS). */
export const AGG_LABELS: Record<AggFn, string> = {
  SUM: 'Sum', AVG: 'Average', MIN: 'Min', MAX: 'Max', COUNT: 'Count', COUNT_DISTINCT: 'Count Unique', STRING_AGG: 'Combined', ANY_VALUE: 'Sample',
  P25: '25th Percentile', P50: 'Median', P75: '75th Percentile', P95: '95th Percentile',
};
/** The suffix of an output column's name (mirror of REPORT_AGGREGATE_FUNCTION_TOKENS). */
export const AGG_TOKENS: Record<AggFn, string> = {
  SUM: 'SUM', AVG: 'AVG', MIN: 'MIN', MAX: 'MAX', COUNT: 'COUNT', COUNT_DISTINCT: 'COUNTUNIQUE', STRING_AGG: 'STRINGAGG', ANY_VALUE: 'ANYVALUE',
  P25: 'P25', P50: 'MEDIAN', P75: 'P75', P95: 'P95',
};
export const BUCKET_LABELS: Record<DateBucket, string> = { DAY: 'Day', WEEK: 'Week', MONTH: 'Month', QUARTER: 'Quarter', YEAR: 'Year' };

/** The row key of one aggregated output (the backend's `aggregatedColumnLabel`: dots in the column become `_`). */
export const aggregatedKey = (column: string, fn: AggFn): string => `${column.replace(/\./g, '_')} | ${AGG_TOKENS[fn]}`;

// What a field category permits at most (SUPPORTED_BY_CATEGORY) and offers by default (DEFAULTS_BY_CATEGORY).
const SUPPORTED: Record<FieldCategory, AggFn[]> = {
  number: ['SUM', 'AVG', 'MIN', 'MAX', 'ANY_VALUE', 'P25', 'P50', 'P75', 'P95'],
  string: ['MIN', 'MAX', 'ANY_VALUE', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG'],
  date: ['MIN', 'MAX', 'ANY_VALUE', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG'],
  time: ['MIN', 'MAX', 'ANY_VALUE', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG'],
  boolean: ['COUNT', 'COUNT_DISTINCT', 'ANY_VALUE'],
  other: ['COUNT', 'ANY_VALUE'],
};
const DEFAULTS: Record<FieldCategory, AggFn[]> = {
  number: ['SUM', 'AVG', 'MIN', 'MAX'],
  string: ['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE'],
  date: ['MIN', 'MAX'],
  time: ['MIN', 'MAX'],
  boolean: ['COUNT', 'COUNT_DISTINCT'],
  other: ['COUNT'],
};

/** The functions a field may be aggregated by: a joined field's analyst-allowed set when it has one, else the field's own
 * governance (narrowed to what its type supports), else the category defaults. An explicit empty list means none. */
export function allowedFunctions(field: Pick<Field, 'category' | 'allowedAggregations' | 'postJoinAggregations' | 'joined' | 'isCalculated'>): AggFn[] {
  // The backend refuses a function on a calculated field and on an array, JSON, struct or geography field (category 'other').
  if (field.isCalculated || field.category === 'other') return [];
  const supported = new Set(SUPPORTED[field.category]);
  if (field.joined && field.postJoinAggregations !== undefined) return field.postJoinAggregations;
  if (field.allowedAggregations) return AGGREGATE_FUNCTIONS.filter((f) => field.allowedAggregations!.includes(f) && supported.has(f));
  return DEFAULTS[field.category];
}

/** A column that can be grouped by a date bucket: DATE, DATETIME and TIMESTAMP (not TIME). */
export const canBucket = (field: Pick<Field, 'category' | 'isCalculated'>): boolean => field.category === 'date' && !field.isCalculated;
/** A bucket carries a time zone only on a type with a time of day: a plain DATE cannot be converted. */
export const canZone = (field: Pick<Field, 'category' | 'type' | 'isCalculated'>): boolean => field.category === 'date' && !field.isCalculated && field.type.trim().toUpperCase() !== 'DATE';

/** What the popover edits for one column: several functions, or one bucket (never both). */
export type AggregationDraft = { functions: AggFn[]; bucket: DateBucket | null; timeZone: string | null };

export function draftOf(column: string, a: Aggregation): AggregationDraft {
  const t = a.dateTrunc.find((r) => r.column === column);
  return { functions: a.aggregations.filter((r) => r.column === column).map((r) => r.function), bucket: t?.unit ?? null, timeZone: t?.timeZone ?? null };
}

/** The column's rules rewritten from the draft; other columns' rules keep their place (port of `applyAggregationDraft`). */
export function applyDraft(column: string, draft: AggregationDraft, a: Aggregation): Aggregation {
  const aggregations = [...a.aggregations.filter((r) => r.column !== column), ...draft.functions.map((fn) => ({ column, function: fn }))];
  const others = a.dateTrunc.filter((r) => r.column !== column);
  const dateTrunc = draft.bucket !== null ? [...others, { column, unit: draft.bucket, ...(draft.timeZone !== null ? { timeZone: draft.timeZone } : {}) }] : others;
  return { aggregations, dateTrunc };
}

/** The backend's shape of an IANA time-zone name (it is inlined into SQL, so this is an injection guard), and its length cap. */
export const IANA_TIME_ZONE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$/;
export const MAX_TIME_ZONE_LENGTH = 64;
export const isTimeZone = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_TIME_ZONE_LENGTH && IANA_TIME_ZONE.test(v);

/**
 * The rules the backend would accept for these fields: a function the field does not allow goes, a bucket on a column that cannot be
 * bucketed goes, a time zone on a plain DATE goes (the bucket stays), and a column with functions keeps no bucket. A column the schema
 * does not know is left alone (a joined mart may not be read yet). Returns the same object when nothing changed.
 */
export function sanitizeAggregation(a: Aggregation, fields: readonly Field[]): Aggregation {
  const by = new Map(fields.map((f) => [f.name, f]));
  const aggregations = a.aggregations.filter((r) => { const f = by.get(r.column); return !f || allowedFunctions(f).includes(r.function); });
  const dateTrunc = a.dateTrunc.flatMap((r): DateTruncRule[] => {
    const f = by.get(r.column);
    if (aggregations.some((x) => x.column === r.column)) return [];
    if (!f) return [r];
    if (!canBucket(f)) return [];
    if (r.timeZone !== undefined && !canZone(f)) return [{ column: r.column, unit: r.unit }];
    return [r];
  });
  const same = aggregations.length === a.aggregations.length && dateTrunc.length === a.dateTrunc.length && dateTrunc.every((r, i) => r === a.dateTrunc[i]);
  return same ? a : { aggregations, dateTrunc };
}

/** A shown column the grouped query cannot carry: an array, JSON, struct or geography field, or a calculated one, with no rule of its own. It would become a GROUP BY key. */
export function ungroupableColumn(fields: readonly Field[], a: Aggregation): Field | null {
  if (!isGrouped(a)) return null;
  return fields.find((f) => (f.isCalculated || f.category === 'other') && !a.aggregations.some((r) => r.column === f.name) && !a.dateTrunc.some((r) => r.column === f.name)) ?? null;
}

/** The rules of the columns still shown. */
export function keepVisible(a: Aggregation, columns: string[]): Aggregation {
  const shown = new Set(columns);
  const aggregations = a.aggregations.filter((r) => shown.has(r.column));
  const dateTrunc = a.dateTrunc.filter((r) => shown.has(r.column));
  return aggregations.length === a.aggregations.length && dateTrunc.length === a.dateTrunc.length ? a : { aggregations, dateTrunc };
}

/** One column of the grouped result. */
export type Output = {
  /** The key of the value in a row. */
  key: string;
  /** The field it comes from (the column the member ticked). */
  column: string;
  fn?: AggFn;
  bucket?: DateBucket;
  /** Whether the output can be sorted: a group key, or the first function of an aggregated column (the backend sorts that alias). */
  sortable: boolean;
};

/** The outputs of the visible columns in grid order: one per function of an aggregated column, else the column itself. Ungrouped: one per column. */
export function outputsOf(columns: string[], a: Aggregation): Output[] {
  return columns.flatMap((column): Output[] => {
    const fns = a.aggregations.filter((r) => r.column === column).map((r) => r.function);
    if (fns.length > 0) return fns.map((fn, i) => ({ key: aggregatedKey(column, fn), column, fn, sortable: i === 0 }));
    const bucket = a.dateTrunc.find((r) => r.column === column)?.unit;
    return [{ key: column, column, ...(bucket ? { bucket } : {}), sortable: true }];
  });
}

/** What to tell the member's own words: "Sum, Average" for a column's functions, "by month" for its bucket. */
export function describeColumn(column: string, a: Aggregation): string | null {
  const fns = a.aggregations.filter((r) => r.column === column).map((r) => AGG_LABELS[r.function].toLowerCase());
  if (fns.length) return fns.join(', ');
  const t = a.dateTrunc.find((r) => r.column === column);
  return t ? `by ${BUCKET_LABELS[t.unit].toLowerCase()}${t.timeZone ? ` (${t.timeZone})` : ''}` : null;
}

const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DATE_PART = /^(\d{4})-(\d{2})-(\d{2})/;

/** A bucket start as the grid shows it: Month "Nov 2026", Quarter "Q4 2026", Year "2026", Week and Day the calendar day. Unreadable values show as stored. */
export function formatBucket(value: unknown, unit: DateBucket, locale?: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  const m = DATE_PART.exec(String(value));
  if (!m) return String(value);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (unit === 'YEAR') return String(y);
  if (unit === 'QUARTER') return `Q${Math.floor((mo - 1) / 3) + 1} ${y}`;
  if (unit === 'MONTH') return `${SHORT_MONTHS[mo - 1]} ${y}`;
  // DAY and WEEK: the calendar day, no time-zone shift.
  return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });
}

/** The names the backend sent that this build knows, in the canonical order. */
export const knownFunctions = (names: readonly string[]): AggFn[] => AGGREGATE_FUNCTIONS.filter((f) => names.includes(f));
