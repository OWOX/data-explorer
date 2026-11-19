import { describe, expect, it } from 'vitest';
import { columnRef, dialectFor, quoteIdent, renderFilter, type Dialect } from './dialect';
import type { Field } from '../model/types';

const field = (over: Partial<Field>): Field => ({ name: 'x', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...over });
const text = field({ name: 'city' });
const num = field({ name: 'qty', type: 'INTEGER', category: 'number' });
const stamp = field({ name: 'at', type: 'TIMESTAMP', category: 'date' });
const flag = field({ name: 'ok', type: 'BOOLEAN', category: 'boolean' });

const DIALECTS: Dialect[] = ['bigquery', 'athena', 'snowflake', 'redshift', 'databricks'];
const col = (d: Dialect, name: string) => columnRef(d, 't0', name);

describe('quoteIdent', () => {
  it('quotes per dialect and doubles an embedded quote', () => {
    expect(quoteIdent('bigquery', 'city')).toBe('`city`');
    expect(quoteIdent('databricks', 'ci`ty')).toBe('`ci``ty`');
    expect(quoteIdent('athena', 'city')).toBe('"city"');
    expect(quoteIdent('snowflake', 'ci"ty')).toBe('"ci""ty"');
    expect(quoteIdent('redshift', 'a.b')).toBe('"a.b"');
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

describe('columnRef', () => {
  it('splits a nested path on BigQuery only', () => {
    expect(columnRef('bigquery', 't1', 'address.city')).toBe('t1.`address`.`city`');
    expect(columnRef('snowflake', 't1', 'address.city')).toBe('t1."address.city"');
    expect(columnRef('databricks', 't1', 'address.city')).toBe('t1.`address.city`');
    expect(columnRef('athena', 't1', 'city')).toBe('t1."city"');
  });
});

describe('renderFilter', () => {
  const eqO = (d: Dialect) => renderFilter(d, col(d, 'city'), text, { field: 'city', op: 'eq', value: "O'Brien" });
  it('escapes a quote in a string literal', () => {
    expect(eqO('athena')).toBe(`t0."city" = 'O''Brien'`);
    expect(eqO('redshift')).toBe(`t0."city" = 'O''Brien'`);
    expect(eqO('bigquery')).toBe("t0.`city` = 'O\\'Brien'");
    expect(eqO('snowflake')).toBe(`t0."city" = 'O''Brien'`);
    expect(eqO('databricks')).toBe("t0.`city` = 'O''Brien'");
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
