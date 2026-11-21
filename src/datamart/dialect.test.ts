import { describe, expect, it } from 'vitest';
import { aggregate, anyValue, dateTrunc, dialectFor, fieldRef, ident, isFloat, isJoinFn, leafFn, nullSafeOn, passFn, renderFilter, reportAggregate, type Dialect, type JoinFn } from './dialect';
import type { Field } from '../model/types';

const field = (over: Partial<Field>): Field => ({ name: 'x', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...over });
const text = field({ name: 'city' });
const num = field({ name: 'qty', type: 'INTEGER', category: 'number' });
const stamp = field({ name: 'at', type: 'TIMESTAMP', category: 'date' });
const flag = field({ name: 'ok', type: 'BOOLEAN', category: 'boolean' });

const DIALECTS: Dialect[] = ['bigquery', 'athena', 'snowflake', 'redshift', 'databricks'];
const col = (d: Dialect, name: string) => `t0.${fieldRef(d, name)}`;

describe('ident', () => {
  it('leaves a simple name bare except on Snowflake, which always quotes', () => {
    for (const d of ['bigquery', 'athena', 'redshift', 'databricks'] as const) expect(ident(d, 'city_2')).toBe('city_2');
    expect(ident('snowflake', 'city')).toBe('"city"');
  });
  it('quotes any other name per dialect and doubles an embedded quote', () => {
    expect(ident('bigquery', 'my city')).toBe('`my city`');
    expect(ident('databricks', 'ci`ty')).toBe('`ci``ty`');
    expect(ident('athena', 'my city')).toBe('"my city"');
    expect(ident('redshift', '1st')).toBe('"1st"');
    expect(ident('snowflake', 'ci"ty')).toBe('"ci""ty"');
    expect(ident('bigquery', 'a.b')).toBe('`a.b`');
  });
});

describe('dialectFor', () => {
  it('maps the supported storages', () => {
    expect(dialectFor('GOOGLE_BIGQUERY')).toEqual({ dialect: 'bigquery' });
    expect(dialectFor('AWS_ATHENA')).toEqual({ dialect: 'athena' });
    expect(dialectFor('SNOWFLAKE')).toEqual({ dialect: 'snowflake' });
    expect(dialectFor('AWS_REDSHIFT')).toEqual({ dialect: 'redshift' });
    expect(dialectFor('DATABRICKS')).toEqual({ dialect: 'databricks' });
  });
  it('refuses legacy BigQuery and unknown types', () => {
    expect(dialectFor('LEGACY_GOOGLE_BIGQUERY')).toEqual({ reason: "References between data marts aren't available for Legacy Google BigQuery storages" });
    expect(dialectFor('MYSQL')).toEqual({ reason: 'Not available for this storage type' });
  });
});

describe('fieldRef', () => {
  it('splits a dotted name into one identifier per segment', () => {
    expect(fieldRef('bigquery', 'address.city')).toBe('address.city');
    expect(fieldRef('snowflake', 'address.city')).toBe('"address"."city"');
    expect(fieldRef('databricks', 'my a.city')).toBe('`my a`.city');
    expect(fieldRef('athena', 'city')).toBe('city');
  });
});

describe('aggregate', () => {
  it('spells STRING_AGG per dialect', () => {
    expect(aggregate('bigquery', 'STRING_AGG', 'x')).toBe("STRING_AGG(CAST(x AS STRING), ', ' ORDER BY CAST(x AS STRING))");
    expect(aggregate('athena', 'STRING_AGG', 'x')).toBe("ARRAY_JOIN(ARRAY_AGG(CAST(x AS VARCHAR) ORDER BY CAST(x AS VARCHAR)), ', ')");
    expect(aggregate('snowflake', 'STRING_AGG', 'x')).toBe("LISTAGG(CAST(x AS VARCHAR), ', ') WITHIN GROUP (ORDER BY x)");
    expect(aggregate('redshift', 'STRING_AGG', 'x')).toBe("LISTAGG(CAST(x AS VARCHAR), ', ') WITHIN GROUP (ORDER BY x)");
    expect(aggregate('databricks', 'STRING_AGG', 'x')).toBe("CONCAT_WS(', ', SORT_ARRAY(COLLECT_LIST(CAST(x AS STRING))))");
  });
  it('spells ANY_VALUE as arbitrary on Athena only', () => {
    expect(aggregate('athena', 'ANY_VALUE', 'x')).toBe('arbitrary(x)');
    for (const d of ['bigquery', 'snowflake', 'redshift', 'databricks'] as const) expect(aggregate(d, 'ANY_VALUE', 'x')).toBe('ANY_VALUE(x)');
  });
  it('spells the plain functions the same on every dialect', () => {
    for (const d of DIALECTS) {
      for (const fn of ['SUM', 'MIN', 'MAX', 'AVG', 'COUNT'] as const) expect(aggregate(d, fn, 'x')).toBe(`${fn}(x)`);
      expect(aggregate(d, 'COUNT_DISTINCT', 'x')).toBe('COUNT(DISTINCT x)');
    }
  });
});

describe('leafFn and passFn', () => {
  it('leafFn turns ANY_VALUE into MAX on an orderable raw type only', () => {
    for (const t of ['STRING', 'INTEGER', 'DATE', 'TIME', 'TIMESTAMP', 'NUMERIC']) expect(leafFn('ANY_VALUE', t)).toBe('MAX');
    for (const t of ['BOOLEAN', 'JSON', 'string']) expect(leafFn('ANY_VALUE', t)).toBe('ANY_VALUE');
    expect(leafFn('SUM', 'BOOLEAN')).toBe('SUM');
  });
  it('passFn re-aggregates COUNT and COUNT_DISTINCT as SUM, ANY_VALUE as MAX, the rest as themselves', () => {
    expect(passFn('COUNT')).toBe('SUM');
    expect(passFn('COUNT_DISTINCT')).toBe('SUM');
    expect(passFn('ANY_VALUE')).toBe('MAX');
    for (const fn of ['STRING_AGG', 'MAX', 'MIN', 'SUM', 'AVG'] as JoinFn[]) expect(passFn(fn)).toBe(fn);
  });
  it('isJoinFn knows the eight functions', () => {
    expect(isJoinFn('STRING_AGG')).toBe(true);
    expect(isJoinFn('MEDIAN')).toBe(false);
    expect(isJoinFn(undefined)).toBe(false);
  });
});

describe('renderFilter', () => {
  it('renders a list filter as IN / NOT IN with each dialect\'s escaping', () => {
    const inF = (d: Dialect) => renderFilter(d, 'c', text, { field: 'city', op: 'eq', value: "a, O'B", list: true });
    const notIn = (d: Dialect) => renderFilter(d, 'c', text, { field: 'city', op: 'neq', value: 'a, b', list: true });
    expect(inF('athena')).toBe("c IN ('a', 'O''B')");
    expect(inF('bigquery')).toBe("c IN ('a', 'O\\'B')");
    expect(inF('snowflake')).toBe("c IN ('a', 'O''B')");
    expect(inF('redshift')).toBe("c IN ('a', 'O''B')");
    expect(inF('databricks')).toBe("c IN ('a', 'O''B')");
    for (const d of ['athena', 'bigquery', 'snowflake', 'redshift', 'databricks'] as Dialect[]) expect(notIn(d)).toBe("(c IS NULL OR c NOT IN ('a', 'b'))");
  });
  const eqO = (d: Dialect) => renderFilter(d, col(d, 'city'), text, { field: 'city', op: 'eq', value: "O'Brien" });
  it('escapes a quote in a string literal', () => {
    expect(eqO('athena')).toBe("t0.city = 'O''Brien'");
    expect(eqO('redshift')).toBe("t0.city = 'O''Brien'");
    expect(eqO('bigquery')).toBe("t0.city = 'O\\'Brien'");
    expect(eqO('snowflake')).toBe(`t0."city" = 'O''Brien'`);
    expect(eqO('databricks')).toBe("t0.city = 'O''Brien'");
  });
  it('doubles a backslash where the dialect reads escapes', () => {
    const f = (d: Dialect) => renderFilter(d, 'c', text, { field: 'city', op: 'eq', value: 'a\\b' });
    expect(f('bigquery')).toBe("c = 'a\\\\b'");
    expect(f('snowflake')).toBe("c = 'a\\\\b'");
    expect(f('databricks')).toBe("c = 'a\\\\b'");
    expect(f('athena')).toBe("c = 'a\\b'");
  });
  it('BigQuery escapes a backslash, a quote, a newline and a carriage return', () => {
    expect(renderFilter('bigquery', 'c', text, { field: 'city', op: 'eq', value: "a\\b'c\nd\re" })).toBe("c = 'a\\\\b\\'c\\nd\\re'");
  });
  it('Redshift builds a backslash with CHR(92) and still doubles quotes', () => {
    expect(renderFilter('redshift', 'c', text, { field: 'city', op: 'eq', value: "a\\b'c" })).toBe("c = ('a' || CHR(92) || 'b''c')");
    expect(renderFilter('redshift', 'c', text, { field: 'city', op: 'eq', value: '\\' })).toBe("c = ('' || CHR(92) || '')");
  });
  it('contains', () => {
    const f = (d: Dialect) => renderFilter(d, 'c', text, { field: 'city', op: 'contains', value: 'ber' });
    expect(f('bigquery')).toBe("STRPOS(c, 'ber') > 0");
    expect(f('athena')).toBe("strpos(c, 'ber') > 0");
    expect(f('snowflake')).toBe("CONTAINS(c, 'ber')");
    expect(f('redshift')).toBe("STRPOS(c, 'ber') > 0");
    expect(f('databricks')).toBe("contains(c, 'ber')");
  });
  it('between on numbers', () => {
    for (const d of DIALECTS) expect(renderFilter(d, 'c', num, { field: 'qty', op: 'between', value: { from: 1, to: '5.5' } })).toBe('c BETWEEN 1 AND 5.5');
  });
  it('between on a date-only DATETIME field is inclusive of the end day', () => {
    const f = (d: Dialect) => renderFilter(d, 'c', stamp, { field: 'at', op: 'between', value: { from: '2024-01-01', to: '2024-01-31' } });
    const lo = "'2024-01-01 00:00:00'";
    const hi = "'2024-01-31 23:59:59'";
    expect(f('bigquery')).toBe(`c BETWEEN CAST(${lo} AS TIMESTAMP) AND CAST(${hi} AS TIMESTAMP)`);
    expect(f('athena')).toBe(`c BETWEEN CAST(${lo} AS TIMESTAMP) AND CAST(${hi} AS TIMESTAMP)`);
    expect(f('snowflake')).toBe(`c BETWEEN CAST(${lo} AS TIMESTAMP) AND CAST(${hi} AS TIMESTAMP)`);
    expect(f('databricks')).toBe(`c BETWEEN CAST(${lo} AS TIMESTAMP) AND CAST(${hi} AS TIMESTAMP)`);
    expect(f('redshift')).toBe(`c BETWEEN ${lo} AND ${hi}`);
  });
  it('is_blank on a string checks NULL, empty and whitespace', () => {
    const f = (d: Dialect) => renderFilter(d, 'c', text, { field: 'city', op: 'is_blank' });
    expect(f('bigquery')).toBe("(c IS NULL OR TRIM(c) = '')");
    expect(f('athena')).toBe("(c IS NULL OR TRIM(c) = '')");
    expect(f('snowflake')).toBe("(c IS NULL OR TRIM(c, ' \\t\\n\\r') = '')");
    expect(f('redshift')).toBe("(c IS NULL OR BTRIM(c, ' ' || CHR(9) || CHR(10) || CHR(13)) = '')");
    expect(f('databricks')).toBe("(c IS NULL OR TRIM(BOTH ' \\t\\n\\r' FROM c) = '')");
  });
  it('is_not_blank on a string, and is_blank on a number is NULL only', () => {
    expect(renderFilter('bigquery', 'c', text, { field: 'city', op: 'is_not_blank' })).toBe("(c IS NOT NULL AND TRIM(c) <> '')");
    for (const d of DIALECTS) expect(renderFilter(d, 'c', num, { field: 'qty', op: 'is_blank' })).toBe('c IS NULL');
  });
  it('is_blank follows the engine string set, not the plugin category', () => {
    const citext = field({ name: 'c', type: 'CITEXT', category: 'string' });
    const varchar = field({ name: 'c', type: 'varchar', category: 'string' });
    expect(renderFilter('bigquery', 'c', citext, { field: 'c', op: 'is_blank' })).toBe('c IS NULL');
    expect(renderFilter('bigquery', 'c', citext, { field: 'c', op: 'is_not_blank' })).toBe('c IS NOT NULL');
    expect(renderFilter('bigquery', 'c', varchar, { field: 'c', op: 'is_blank' })).toBe("(c IS NULL OR TRIM(c) = '')");
  });
  it('is_true', () => {
    for (const d of DIALECTS) expect(renderFilter(d, 'c', flag, { field: 'ok', op: 'is_true' })).toBe('c = TRUE');
  });
  it('relative last_n_days', () => {
    const f = (d: Dialect, fl: Field) => renderFilter(d, 'c', fl, { field: fl.name, op: 'relative', value: { kind: 'last_n_days', n: 7 } });
    expect(f('bigquery', stamp)).toBe('DATE(c) >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND DATE(c) <= CURRENT_DATE()');
    expect(f('bigquery', field({ name: 'd', type: 'DATE', category: 'date' }))).toBe('c >= DATE_SUB(CURRENT_DATE(), INTERVAL 7 DAY) AND c <= CURRENT_DATE()');
    expect(f('athena', stamp)).toBe("c >= date_add('day', -7, current_date) AND c < date_add('day', 1, current_date)");
    expect(f('snowflake', stamp)).toBe('c >= DATEADD(day, -7, CURRENT_DATE) AND c < DATEADD(day, 1, CURRENT_DATE)');
    expect(f('redshift', stamp)).toBe('c >= DATEADD(day, -7, CURRENT_DATE) AND c < DATEADD(day, 1, CURRENT_DATE)');
    expect(f('databricks', stamp)).toBe('c >= date_add(CURRENT_DATE, -7) AND c < date_add(CURRENT_DATE, 1)');
  });
  it('relative presets without n, per dialect', () => {
    const f = (d: Dialect, kind: 'this_week' | 'last_month') => renderFilter(d, 'c', field({ name: 'd', type: 'DATE', category: 'date' }), { field: 'd', op: 'relative', value: { kind } });
    expect(f('bigquery', 'this_week')).toBe('c >= DATE_TRUNC(CURRENT_DATE(), ISOWEEK) AND c < DATE_ADD(DATE_TRUNC(CURRENT_DATE(), ISOWEEK), INTERVAL 7 DAY)');
    expect(f('snowflake', 'this_week')).toBe('c >= DATEADD(day, 1 - DAYOFWEEKISO(CURRENT_DATE), CURRENT_DATE) AND c < DATEADD(day, 8 - DAYOFWEEKISO(CURRENT_DATE), CURRENT_DATE)');
    expect(f('databricks', 'last_month')).toBe("c >= add_months(trunc(CURRENT_DATE, 'MONTH'), -1) AND c < trunc(CURRENT_DATE, 'MONTH')");
    expect(f('athena', 'last_month')).toBe("c >= date_trunc('month', date_add('month', -1, current_date)) AND c < date_trunc('month', current_date)");
  });
  it('rejects a non-finite number', () => {
    expect(() => renderFilter('athena', 'c', num, { field: 'qty', op: 'eq', value: 'abc' })).toThrow('Non-finite');
  });
});

describe('reportAggregate', () => {
  it('spells the plain functions the same on every dialect', () => {
    for (const d of DIALECTS) {
      for (const fn of ['SUM', 'AVG', 'MIN', 'MAX', 'COUNT'] as const) expect(reportAggregate(d, fn, 'x')).toBe(`${fn}(x)`);
      expect(reportAggregate(d, 'COUNT_DISTINCT', 'x')).toBe('COUNT(DISTINCT x)');
    }
  });
  it('ANY_VALUE is arbitrary on Athena', () => {
    expect(reportAggregate('athena', 'ANY_VALUE', 'x')).toBe('arbitrary(x)');
    expect(anyValue('snowflake', 'x')).toBe('ANY_VALUE(x)');
  });
  it('STRING_AGG has no ORDER BY', () => {
    expect(reportAggregate('bigquery', 'STRING_AGG', 'x')).toBe("STRING_AGG(CAST(x AS STRING), ', ')");
    expect(reportAggregate('athena', 'STRING_AGG', 'x')).toBe("array_join(array_agg(CAST(x AS VARCHAR)), ', ')");
    expect(reportAggregate('snowflake', 'STRING_AGG', 'x')).toBe("LISTAGG(CAST(x AS VARCHAR), ', ')");
    expect(reportAggregate('redshift', 'STRING_AGG', 'x')).toBe("LISTAGG(CAST(x AS VARCHAR), ', ')");
    expect(reportAggregate('databricks', 'STRING_AGG', 'x')).toBe("array_join(collect_list(CAST(x AS STRING)), ', ')");
  });
  it('percentiles per dialect', () => {
    expect(reportAggregate('bigquery', 'P25', 'x')).toBe('APPROX_QUANTILES(x, 100)[OFFSET(25)]');
    expect(reportAggregate('bigquery', 'P50', 'x')).toBe('APPROX_QUANTILES(x, 100)[OFFSET(50)]');
    expect(reportAggregate('athena', 'P75', 'x')).toBe('APPROX_PERCENTILE(CAST(x AS DOUBLE), 0.75)');
    expect(reportAggregate('athena', 'P95', 'x')).toBe('APPROX_PERCENTILE(CAST(x AS DOUBLE), 0.95)');
    for (const d of ['snowflake', 'redshift', 'databricks'] as const) expect(reportAggregate(d, 'P50', 'x')).toBe('PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x)');
  });
  it('aggregate hands percentiles to it and keeps the ordered STRING_AGG', () => {
    expect(aggregate('snowflake', 'P95', '_val')).toBe('PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY _val)');
    expect(aggregate('bigquery', 'STRING_AGG', 'x')).toContain('ORDER BY');
  });
});

describe('dateTrunc', () => {
  const units = ['DAY', 'WEEK', 'MONTH', 'QUARTER', 'YEAR'] as const;
  it('BigQuery: DATE truncates directly, DATETIME with a zone goes through TIMESTAMP, the rest through DATE', () => {
    expect(dateTrunc('bigquery', 'x', 'MONTH', undefined, 'DATE')).toBe('DATE_TRUNC(x, MONTH)');
    expect(dateTrunc('bigquery', 'x', 'MONTH', 'Europe/Berlin', 'DATE')).toBe('DATE_TRUNC(x, MONTH)');
    expect(dateTrunc('bigquery', 'x', 'DAY', 'America/New_York', 'DATETIME')).toBe("DATE_TRUNC(DATE(TIMESTAMP(x, 'America/New_York'), 'America/New_York'), DAY)");
    expect(dateTrunc('bigquery', 'x', 'DAY', undefined, 'DATETIME')).toBe('DATE_TRUNC(DATE(x), DAY)');
    expect(dateTrunc('bigquery', 'x', 'WEEK', 'UTC', 'TIMESTAMP')).toBe("DATE_TRUNC(DATE(x, 'UTC'), WEEK)");
    expect(dateTrunc('bigquery', 'x', 'YEAR', undefined, ' timestamp ')).toBe('DATE_TRUNC(DATE(x), YEAR)');
  });
  it('every unit on every dialect, with and without a zone', () => {
    for (const u of units) {
      expect(dateTrunc('athena', 'x', u, 'UTC', 'TIMESTAMP')).toBe(`date_trunc('${u.toLowerCase()}', (x) AT TIME ZONE 'UTC')`);
      expect(dateTrunc('athena', 'x', u, undefined, 'TIMESTAMP')).toBe(`date_trunc('${u.toLowerCase()}', x)`);
      expect(dateTrunc('snowflake', 'x', u, 'UTC', 'TIMESTAMP')).toBe(`DATE_TRUNC('${u}', CONVERT_TIMEZONE('UTC', x))`);
      expect(dateTrunc('snowflake', 'x', u, undefined, 'TIMESTAMP')).toBe(`DATE_TRUNC('${u}', x)`);
      expect(dateTrunc('redshift', 'x', u, 'UTC', 'TIMESTAMP')).toBe(`DATE_TRUNC('${u.toLowerCase()}', CONVERT_TIMEZONE('UTC', x))`);
      expect(dateTrunc('redshift', 'x', u, undefined, 'TIMESTAMP')).toBe(`DATE_TRUNC('${u.toLowerCase()}', x)`);
      expect(dateTrunc('databricks', 'x', u, 'UTC', 'TIMESTAMP')).toBe(`DATE_TRUNC('${u}', FROM_UTC_TIMESTAMP(x, 'UTC'))`);
      expect(dateTrunc('databricks', 'x', u, undefined, 'TIMESTAMP')).toBe(`DATE_TRUNC('${u}', x)`);
      expect(dateTrunc('bigquery', 'x', u, undefined, 'TIMESTAMP')).toBe(`DATE_TRUNC(DATE(x), ${u})`);
    }
  });
  it('refuses a unit or a zone the backend would refuse', () => {
    expect(() => dateTrunc('bigquery', 'x', 'HOUR' as never, undefined, 'DATE')).toThrow('Unknown date bucket');
    expect(() => dateTrunc('bigquery', 'x', 'DAY', "UTC'); DROP", 'TIMESTAMP')).toThrow('Invalid time zone');
    expect(() => dateTrunc('snowflake', 'x', 'DAY', '', 'TIMESTAMP')).toThrow('Invalid time zone');
  });
});

describe('nullSafeOn and isFloat', () => {
  it('matches NULL to NULL, and NaN to NaN only where asked', () => {
    expect(nullSafeOn([{ left: 'a', right: 's.d0', nanSafe: false }])).toBe('((a) = (s.d0) OR ((a) IS NULL AND (s.d0) IS NULL))');
    expect(nullSafeOn([{ left: 'a', right: 's.d0', nanSafe: true }])).toBe('((a) = (s.d0) OR ((a) IS NULL AND (s.d0) IS NULL) OR ((a) != (a) AND (s.d0) != (s.d0)))');
    expect(nullSafeOn([{ left: 'a', right: 'r0', nanSafe: false }, { left: 'b', right: 'r1', nanSafe: false }])).toBe('((a) = (r0) OR ((a) IS NULL AND (r0) IS NULL)) AND ((b) = (r1) OR ((b) IS NULL AND (r1) IS NULL))');
  });
  it('isFloat knows the floating point types', () => {
    for (const t of ['FLOAT', 'float64', 'REAL', 'DOUBLE', 'double precision']) expect(isFloat(t)).toBe(true);
    for (const t of ['INTEGER', 'NUMERIC', 'DECIMAL', 'STRING']) expect(isFloat(t)).toBe(false);
  });
});
