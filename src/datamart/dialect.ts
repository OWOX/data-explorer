import type { ColumnFilter } from '../filters/build';
import { toTraverseFilter } from '../filters/build';
import type { AggFn, DateBucket } from '../model/aggregation';
import { isDateBucket, isTimeZone } from '../model/aggregation';
import type { Field } from '../model/types';
import type { RelativeDatePreset } from '../sdk/types';

export type Dialect = 'bigquery' | 'athena' | 'snowflake' | 'redshift' | 'databricks';

const DIALECT_BY_STORAGE: Record<string, Dialect> = {
  GOOGLE_BIGQUERY: 'bigquery',
  AWS_ATHENA: 'athena',
  SNOWFLAKE: 'snowflake',
  AWS_REDSHIFT: 'redshift',
  DATABRICKS: 'databricks',
};

/** The dialect of a storage type, or why a data mart there cannot reference others. */
export function dialectFor(storageType: string): { dialect: Dialect } | { reason: string } {
  if (storageType === 'LEGACY_GOOGLE_BIGQUERY') return { reason: "References between data marts aren't available for Legacy Google BigQuery storages" };
  const dialect = DIALECT_BY_STORAGE[storageType];
  return dialect ? { dialect } : { reason: 'Not available for this storage type' };
}

/** One identifier as the engine spells it: bare when simple, except on Snowflake, which is always quoted. */
export function ident(d: Dialect, name: string): string {
  if (d !== 'snowflake' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return name;
  const q = d === 'bigquery' || d === 'databricks' ? '`' : '"';
  return `${q}${name.split(q).join(q + q)}${q}`;
}

/** A field reference: each dotted segment its own identifier (the engine's quoteFieldRef). */
export const fieldRef = (d: Dialect, name: string): string => name.split('.').map((s) => ident(d, s)).join('.');

/** The engine's field-type categories, case-sensitive, used where the engine decides by type. */
const E_STRING = new Set(['STRING', 'VARCHAR', 'CHAR', 'TEXT', 'BPCHAR']);
const E_NUMBER = new Set(['INTEGER', 'INT', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'NUMERIC', 'BIGNUMERIC', 'DECIMAL']);
const E_DATE = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ', 'TIMESTAMP_NTZ']);
const E_TIME = new Set(['TIME', 'TIME WITH TIME ZONE', 'TIMETZ']);
const isEngineString = (type: string) => E_STRING.has(type.trim().toUpperCase());
const isOrderable = (type: string) => E_NUMBER.has(type) || E_STRING.has(type) || E_DATE.has(type) || E_TIME.has(type);

export type JoinFn = 'STRING_AGG' | 'MAX' | 'MIN' | 'SUM' | 'AVG' | 'COUNT' | 'COUNT_DISTINCT' | 'ANY_VALUE';
const JOIN_FNS: readonly string[] = ['STRING_AGG', 'MAX', 'MIN', 'SUM', 'AVG', 'COUNT', 'COUNT_DISTINCT', 'ANY_VALUE'];
export const isJoinFn = (s: unknown): s is JoinFn => typeof s === 'string' && JOIN_FNS.includes(s);

/** The roll-up of a field's own rows: ANY_VALUE becomes MAX on an orderable raw type (re-aggregation.ts:55-61). */
export const leafFn = (fn: JoinFn, rawType: string): JoinFn => (fn === 'ANY_VALUE' && isOrderable(rawType) ? 'MAX' : fn);

/** The roll-up of a child's value in its parent (re-aggregation.ts:17-39). */
export const passFn = (fn: JoinFn): JoinFn => (fn === 'COUNT' || fn === 'COUNT_DISTINCT' ? 'SUM' : fn === 'ANY_VALUE' ? 'MAX' : fn);

/** `ANY_VALUE(x)`; Athena spells it `arbitrary`. */
export const anyValue = (d: Dialect, x: string): string => (d === 'athena' ? `arbitrary(${x})` : `ANY_VALUE(${x})`);

const PERCENTILE: Partial<Record<AggFn, { q: string; k: number }>> = { P25: { q: '0.25', k: 25 }, P50: { q: '0.5', k: 50 }, P75: { q: '0.75', k: 75 }, P95: { q: '0.95', k: 95 } };

/** A report-level aggregate over `x`, as the engine's renderAggregateExpression spells it (STRING_AGG here has no ORDER BY). */
export function reportAggregate(d: Dialect, fn: AggFn, x: string): string {
  const pct = PERCENTILE[fn];
  if (pct) {
    if (d === 'bigquery') return `APPROX_QUANTILES(${x}, 100)[OFFSET(${pct.k})]`;
    if (d === 'athena') return `APPROX_PERCENTILE(CAST(${x} AS DOUBLE), ${pct.q})`;
    return `PERCENTILE_CONT(${pct.q}) WITHIN GROUP (ORDER BY ${x})`;
  }
  switch (fn) {
    case 'COUNT_DISTINCT': return `COUNT(DISTINCT ${x})`;
    case 'ANY_VALUE': return anyValue(d, x);
    case 'STRING_AGG': return {
      bigquery: `STRING_AGG(CAST(${x} AS STRING), ', ')`,
      athena: `array_join(array_agg(CAST(${x} AS VARCHAR)), ', ')`,
      snowflake: `LISTAGG(CAST(${x} AS VARCHAR), ', ')`,
      redshift: `LISTAGG(CAST(${x} AS VARCHAR), ', ')`,
      databricks: `array_join(collect_list(CAST(${x} AS STRING)), ', ')`,
    }[d];
    default: return `${fn}(${x})`;
  }
}

/** One aggregate over `x`, spelled as the engine's buildAggregation and buildStringAgg do (STRING_AGG is the ordered form). */
export function aggregate(d: Dialect, fn: AggFn, x: string): string {
  switch (fn) {
    case 'STRING_AGG': return {
      bigquery: `STRING_AGG(CAST(${x} AS STRING), ', ' ORDER BY CAST(${x} AS STRING))`,
      athena: `ARRAY_JOIN(ARRAY_AGG(CAST(${x} AS VARCHAR) ORDER BY CAST(${x} AS VARCHAR)), ', ')`,
      snowflake: `LISTAGG(CAST(${x} AS VARCHAR), ', ') WITHIN GROUP (ORDER BY ${x})`,
      redshift: `LISTAGG(CAST(${x} AS VARCHAR), ', ') WITHIN GROUP (ORDER BY ${x})`,
      databricks: `CONCAT_WS(', ', SORT_ARRAY(COLLECT_LIST(CAST(${x} AS STRING))))`,
    }[d];
    default: return reportAggregate(d, fn, x);
  }
}

/** Whether a type is floating point, where NaN breaks an equality join (the engine's isFloatingPointType). */
export const isFloat = (type: string): boolean => ['FLOAT', 'FLOAT64', 'REAL', 'DOUBLE', 'DOUBLE PRECISION'].includes(type.trim().toUpperCase());

/** A join condition that matches NULL to NULL (and NaN to NaN where asked), as the engine's renderNullSafeJoinOn does. */
export const nullSafeOn = (pairs: { left: string; right: string; nanSafe: boolean }[]): string =>
  pairs.map(({ left: l, right: r, nanSafe }) => `((${l}) = (${r}) OR ((${l}) IS NULL AND (${r}) IS NULL)${nanSafe ? ` OR ((${l}) != (${l}) AND (${r}) != (${r}))` : ''})`).join(' AND ');

/** `x` cut to the start of its calendar bucket, in `timeZone` when given. Throws on a unit or zone the backend would refuse. */
export function dateTrunc(d: Dialect, x: string, unit: DateBucket, timeZone: string | undefined, type: string): string {
  if (!isDateBucket(unit)) throw new Error(`Unknown date bucket: ${String(unit)}`);
  if (timeZone !== undefined && !isTimeZone(timeZone)) throw new Error(`Invalid time zone: ${timeZone}`);
  const t = type.trim().toUpperCase();
  const lower = unit.toLowerCase();
  switch (d) {
    case 'bigquery':
      if (t === 'DATE') return `DATE_TRUNC(${x}, ${unit})`;
      if (timeZone !== undefined && t === 'DATETIME') return `DATE_TRUNC(DATE(TIMESTAMP(${x}, '${timeZone}'), '${timeZone}'), ${unit})`;
      return `DATE_TRUNC(${timeZone !== undefined ? `DATE(${x}, '${timeZone}')` : `DATE(${x})`}, ${unit})`;
    case 'athena': return timeZone !== undefined ? `date_trunc('${lower}', (${x}) AT TIME ZONE '${timeZone}')` : `date_trunc('${lower}', ${x})`;
    case 'snowflake': return timeZone !== undefined ? `DATE_TRUNC('${unit}', CONVERT_TIMEZONE('${timeZone}', ${x}))` : `DATE_TRUNC('${unit}', ${x})`;
    case 'redshift': return timeZone !== undefined ? `DATE_TRUNC('${lower}', CONVERT_TIMEZONE('${timeZone}', ${x}))` : `DATE_TRUNC('${lower}', ${x})`;
    case 'databricks': return timeZone !== undefined ? `DATE_TRUNC('${unit}', FROM_UTC_TIMESTAMP(${x}, '${timeZone}'))` : `DATE_TRUNC('${unit}', ${x})`;
  }
}

type Scalar = string | number;

/** A SQL literal: a number must be finite. Strings are escaped per dialect: BigQuery by backslash sequences, Redshift builds a backslash with CHR(92) so the standard_conforming_strings setting cannot change it, the rest double `'`. */
function literal(d: Dialect, v: Scalar): string {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`Non-finite filter value: ${String(v)}`);
    return String(v);
  }
  switch (d) {
    case 'bigquery': return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')}'`;
    case 'redshift': {
      const parts = v.split('\\').map((p) => `'${p.replace(/'/g, "''")}'`);
      return parts.length === 1 ? parts[0]! : `(${parts.join(' || CHR(92) || ')})`;
    }
    case 'athena': return `'${v.replace(/'/g, "''")}'`;
    default: return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "''")}'`;
  }
}

/** The column types whose compared value is cast to the column's own type, per dialect (as the backend renderers do). */
const CAST_TYPES: Record<Dialect, ReadonlySet<string>> = {
  bigquery: new Set(['DATE', 'DATETIME', 'TIME', 'TIMESTAMP']),
  athena: new Set(['DATE', 'TIME', 'TIMESTAMP', 'TIME WITH TIME ZONE', 'TIMESTAMP WITH TIME ZONE']),
  snowflake: new Set(['DATE', 'TIME', 'TIMESTAMP']),
  redshift: new Set(),
  databricks: new Set(['DATE', 'TIMESTAMP', 'TIMESTAMP_NTZ']),
};

/** BigQuery columns with a time part: relative dates compare their DATE part. */
const BQ_SUBDAY = new Set(['DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE']);

/** A string column is blank when NULL, empty or whitespace only; the trim form differs per dialect. */
const trimmed = (d: Dialect, col: string): string => {
  switch (d) {
    case 'snowflake': return `TRIM(${col}, ' \\t\\n\\r')`;
    case 'redshift': return `BTRIM(${col}, ' ' || CHR(9) || CHR(10) || CHR(13))`;
    case 'databricks': return `TRIM(BOTH ' \\t\\n\\r' FROM ${col})`;
    default: return `TRIM(${col})`;
  }
};

/** `n` goes into the SQL as is, so it must be a whole number. */
function wholeN(n: number): number {
  if (!Number.isInteger(n) || n < 0) throw new Error(`Invalid relative_date n: ${String(n)}`);
  return n;
}

/** A relative date preset as a range on `col`, with the current-date arithmetic of the dialect. */
function relative(d: Dialect, col: string, p: RelativeDatePreset, type: string): string {
  const n = 'n' in p ? wholeN(p.n) : 0;
  switch (d) {
    case 'bigquery': {
      const c = BQ_SUBDAY.has(type) ? `DATE(${col})` : col;
      const today = 'CURRENT_DATE()';
      const trunc = (unit: string, base = today) => `DATE_TRUNC(${base}, ${unit})`;
      switch (p.kind) {
        case 'today': return `${c} = ${today}`;
        case 'yesterday': return `${c} = DATE_SUB(${today}, INTERVAL 1 DAY)`;
        case 'last_n_days': return `${c} >= DATE_SUB(${today}, INTERVAL ${n} DAY) AND ${c} <= ${today}`;
        case 'last_n_months': return `${c} >= DATE_SUB(${today}, INTERVAL ${n} MONTH) AND ${c} <= ${today}`;
        case 'this_week': return `${c} >= ${trunc('ISOWEEK')} AND ${c} < DATE_ADD(${trunc('ISOWEEK')}, INTERVAL 7 DAY)`;
        case 'last_week': return `${c} >= DATE_SUB(${trunc('ISOWEEK')}, INTERVAL 7 DAY) AND ${c} < ${trunc('ISOWEEK')}`;
        case 'this_month': return `${c} >= ${trunc('MONTH')} AND ${c} < DATE_ADD(${trunc('MONTH')}, INTERVAL 1 MONTH)`;
        case 'last_month': return `${c} >= ${trunc('MONTH', `DATE_SUB(${today}, INTERVAL 1 MONTH)`)} AND ${c} < ${trunc('MONTH')}`;
        case 'this_quarter': return `${c} >= ${trunc('QUARTER')} AND ${c} < DATE_ADD(${trunc('QUARTER')}, INTERVAL 3 MONTH)`;
        case 'last_quarter': return `${c} >= DATE_SUB(${trunc('QUARTER')}, INTERVAL 3 MONTH) AND ${c} < ${trunc('QUARTER')}`;
        case 'this_year': return `${c} >= ${trunc('YEAR')} AND ${c} < DATE_ADD(${trunc('YEAR')}, INTERVAL 1 YEAR)`;
      }
      break;
    }
    case 'athena': {
      const today = 'current_date';
      const tr = (unit: string, base = today) => `date_trunc('${unit}', ${base})`;
      const add = (unit: string, k: number, base: string) => `date_add('${unit}', ${k}, ${base})`;
      switch (p.kind) {
        case 'today': return `${col} >= ${today} AND ${col} < ${add('day', 1, today)}`;
        case 'yesterday': return `${col} >= ${add('day', -1, today)} AND ${col} < ${today}`;
        case 'last_n_days': return `${col} >= ${add('day', -n, today)} AND ${col} < ${add('day', 1, today)}`;
        case 'last_n_months': return `${col} >= ${add('month', -n, today)} AND ${col} < ${add('day', 1, today)}`;
        case 'this_week': return `${col} >= ${tr('week')} AND ${col} < ${add('week', 1, tr('week'))}`;
        case 'last_week': return `${col} >= ${add('week', -1, tr('week'))} AND ${col} < ${tr('week')}`;
        case 'this_month': return `${col} >= ${tr('month')} AND ${col} < ${add('month', 1, tr('month'))}`;
        case 'last_month': return `${col} >= ${tr('month', add('month', -1, today))} AND ${col} < ${tr('month')}`;
        case 'this_quarter': return `${col} >= ${tr('quarter')} AND ${col} < ${add('month', 3, tr('quarter'))}`;
        case 'last_quarter': return `${col} >= ${add('month', -3, tr('quarter'))} AND ${col} < ${tr('quarter')}`;
        case 'this_year': return `${col} >= ${tr('year')} AND ${col} < ${add('year', 1, tr('year'))}`;
      }
      break;
    }
    case 'snowflake':
    case 'redshift': {
      const today = 'CURRENT_DATE';
      const tr = (unit: string, base = today) => `DATE_TRUNC('${unit}', ${base})`;
      const add = (unit: string, k: number | string, base: string) => `DATEADD(${unit}, ${k}, ${base})`;
      const sf = d === 'snowflake';
      const wk = sf ? `DAYOFWEEKISO(${today})` : '';
      switch (p.kind) {
        case 'today': return `${col} >= ${today} AND ${col} < ${add('day', 1, today)}`;
        case 'yesterday': return `${col} >= ${add('day', -1, today)} AND ${col} < ${today}`;
        case 'last_n_days': return `${col} >= ${add('day', -n, today)} AND ${col} < ${add('day', 1, today)}`;
        case 'last_n_months': return `${col} >= ${add('month', -n, today)} AND ${col} < ${add('day', 1, today)}`;
        case 'this_week': return sf
          ? `${col} >= ${add('day', `1 - ${wk}`, today)} AND ${col} < ${add('day', `8 - ${wk}`, today)}`
          : `${col} >= ${tr('week')} AND ${col} < ${add('day', 7, tr('week'))}`;
        case 'last_week': return sf
          ? `${col} >= ${add('day', `-6 - ${wk}`, today)} AND ${col} < ${add('day', `1 - ${wk}`, today)}`
          : `${col} >= ${add('day', -7, tr('week'))} AND ${col} < ${tr('week')}`;
        case 'this_month': return `${col} >= ${tr('month')} AND ${col} < ${add('month', 1, tr('month'))}`;
        case 'last_month': return `${col} >= ${tr('month', add('month', -1, today))} AND ${col} < ${tr('month')}`;
        case 'this_quarter': return `${col} >= ${tr('quarter')} AND ${col} < ${add('month', 3, tr('quarter'))}`;
        case 'last_quarter': return `${col} >= ${add('month', -3, tr('quarter'))} AND ${col} < ${tr('quarter')}`;
        case 'this_year': return `${col} >= ${tr('year')} AND ${col} < ${add('year', 1, tr('year'))}`;
      }
      break;
    }
    case 'databricks': {
      const today = 'CURRENT_DATE';
      const tr = (unit: string) => `trunc(${today}, '${unit}')`;
      const days = (k: number, base = today) => `date_add(${base}, ${k})`;
      const months = (k: number, base: string) => `add_months(${base}, ${k})`;
      switch (p.kind) {
        case 'today': return `${col} >= ${today} AND ${col} < ${days(1)}`;
        case 'yesterday': return `${col} >= ${days(-1)} AND ${col} < ${today}`;
        case 'last_n_days': return `${col} >= ${days(-n)} AND ${col} < ${days(1)}`;
        case 'last_n_months': return `${col} >= ${months(-n, today)} AND ${col} < ${days(1)}`;
        case 'this_week': return `${col} >= ${tr('WEEK')} AND ${col} < ${days(7, tr('WEEK'))}`;
        case 'last_week': return `${col} >= ${days(-7, tr('WEEK'))} AND ${col} < ${tr('WEEK')}`;
        case 'this_month': return `${col} >= ${tr('MONTH')} AND ${col} < ${months(1, tr('MONTH'))}`;
        case 'last_month': return `${col} >= ${months(-1, tr('MONTH'))} AND ${col} < ${tr('MONTH')}`;
        case 'this_quarter': return `${col} >= ${tr('QUARTER')} AND ${col} < ${months(3, tr('QUARTER'))}`;
        case 'last_quarter': return `${col} >= ${months(-3, tr('QUARTER'))} AND ${col} < ${tr('QUARTER')}`;
        case 'this_year': return `${col} >= ${tr('YEAR')} AND ${col} < ${months(12, tr('YEAR'))}`;
      }
      break;
    }
  }
  throw new Error(`Unknown relative_date kind: ${(p as { kind: string }).kind}`);
}

/** One complete filter as a SQL predicate on `col` (already a column reference). */
export function renderFilter(d: Dialect, col: string, field: Field, f: ColumnFilter): string {
  // The grid offers no list operator, so `toTraverseFilter` never returns `in` or `not_in`.
  const t = toTraverseFilter(f, field);
  const type = field.type.trim().toUpperCase();
  const cast = CAST_TYPES[d].has(type);
  /** A compared value, cast to the column type on date and time columns. */
  const lit = (v: Scalar) => (cast ? `CAST(${literal(d, v)} AS ${type})` : literal(d, v));
  /** A pattern or substring: always text. */
  const text = (v: Scalar) => literal(d, String(v));
  switch (t.operator) {
    case 'eq': return `${col} = ${lit(t.value)}`;
    case 'neq': return `(${col} IS NULL OR ${col} <> ${lit(t.value)})`;
    case 'gt': return `${col} > ${lit(t.value)}`;
    case 'lt': return `${col} < ${lit(t.value)}`;
    case 'gte': return `${col} >= ${lit(t.value)}`;
    case 'lte': return `${col} <= ${lit(t.value)}`;
    case 'contains': {
      const v = text(t.value);
      return { bigquery: `STRPOS(${col}, ${v}) > 0`, athena: `strpos(${col}, ${v}) > 0`, snowflake: `CONTAINS(${col}, ${v})`, redshift: `STRPOS(${col}, ${v}) > 0`, databricks: `contains(${col}, ${v})` }[d];
    }
    case 'not_contains': {
      const v = text(t.value);
      return { bigquery: `(${col} IS NULL OR STRPOS(${col}, ${v}) = 0)`, athena: `(${col} IS NULL OR strpos(${col}, ${v}) = 0)`, snowflake: `(${col} IS NULL OR NOT CONTAINS(${col}, ${v}))`, redshift: `(${col} IS NULL OR STRPOS(${col}, ${v}) = 0)`, databricks: `(${col} IS NULL OR NOT contains(${col}, ${v}))` }[d];
    }
    case 'starts_with': {
      const v = text(t.value);
      return { bigquery: `STARTS_WITH(${col}, ${v})`, athena: `strpos(${col}, ${v}) = 1`, snowflake: `STARTSWITH(${col}, ${v})`, redshift: `STRPOS(${col}, ${v}) = 1`, databricks: `startswith(${col}, ${v})` }[d];
    }
    case 'ends_with': {
      const v = text(t.value);
      return { bigquery: `ENDS_WITH(${col}, ${v})`, athena: `substr(${col}, -length(${v})) = ${v}`, snowflake: `ENDSWITH(${col}, ${v})`, redshift: `RIGHT(${col}, LEN(${v})) = ${v}`, databricks: `endswith(${col}, ${v})` }[d];
    }
    case 'is_blank':
    case 'is_not_blank': {
      const blank = t.operator === 'is_blank';
      if (!isEngineString(field.type)) return `${col} IS ${blank ? '' : 'NOT '}NULL`;
      return blank ? `(${col} IS NULL OR ${trimmed(d, col)} = '')` : `(${col} IS NOT NULL AND ${trimmed(d, col)} <> '')`;
    }
    case 'is_true': return `${col} = TRUE`;
    case 'is_false': return `${col} = FALSE`;
    case 'between': return `${col} BETWEEN ${lit(t.value.from)} AND ${lit(t.value.to)}`;
    case 'relative_date': return relative(d, col, t.value, type);
    default: throw new Error(`Unsupported filter operator: ${t.operator}`);
  }
}
