import { describe, expect, it } from 'vitest';
import type { ColumnFilter } from '../filters/build';
import { NO_AGGREGATION, type Aggregation } from '../model/aggregation';
import type { Field, Schema } from '../model/types';
import { IN_LIST_MAX, keysOutcome, keysPlan } from './havingKeys';

const f = (name: string, category: Field['category'], type = 'STRING'): Field => ({ name, type, category, isPrimaryKey: false } as unknown as Field);
const schema: Schema = [f('id', 'number', 'INT64'), f('at', 'date', 'TIMESTAMP'), f('clock', 'time', 'TIME'), f('status', 'string'), f('country', 'string'), f('day', 'date'), f('flag', 'boolean'), f('revenue', 'number', 'NUMERIC'), { ...f('net', 'number', 'NUMERIC'), isCalculated: true, calculatedLevel: 'metric' } as Field, { ...f('margin', 'number', 'NUMERIC'), isCalculated: true, calculatedLevel: 'column' } as Field];
const sum: Aggregation = { aggregations: [{ column: 'revenue', function: 'SUM' }], dateTrunc: [] };
const having: Record<string, ColumnFilter> = { revenue: { field: 'revenue', op: 'gt', value: 100, fn: 'SUM' } };
const plain = (names: string[], agg: Aggregation = sum, filters = having) => keysPlan(schema, names, agg, Object.values(filters), []);

describe('keysPlan', () => {
  it('one group key reads the key and the HAVING column, with the table filters and a limit of 501', () => {
    expect(plain(['status', 'revenue'])).toEqual({
      kind: 'read', key: 'status',
      options: { column: ['status', 'revenue'], aggregation: [{ column: 'revenue', function: 'SUM' }], filter: [{ column: 'revenue', operator: 'gt', value: 100, function: 'SUM' }], limit: 501 },
    });
  });
  it('is off without a HAVING filter, or when the table is not grouped', () => {
    expect(plain(['status', 'revenue'], sum, {})).toEqual({ kind: 'off' });
    expect(plain(['status', 'revenue'], NO_AGGREGATION)).toEqual({ kind: 'off' });
  });
  it('falls back for two group keys', () => expect(plain(['status', 'country', 'revenue'])).toEqual({ kind: 'fallback' }));
  it('falls back for a bucketed date key', () => {
    expect(plain(['day', 'revenue'], { ...sum, dateTrunc: [{ column: 'day', unit: 'MONTH' }] })).toEqual({ kind: 'fallback' });
  });
  it('falls back for datetime, timestamp and time keys, but keeps a plain date', () => {
    expect(plain(['at', 'revenue'])).toEqual({ kind: 'fallback' });
    expect(plain(['clock', 'revenue'])).toEqual({ kind: 'fallback' });
    expect(plain(['day', 'revenue'])).toMatchObject({ kind: 'read', key: 'day' });
  });
  it('falls back for a boolean key', () => expect(plain(['flag', 'revenue'])).toEqual({ kind: 'fallback' }));
  it('with no group key reads only the HAVING column', () => {
    const p = plain(['revenue']);
    expect(p).toMatchObject({ kind: 'read', key: null, options: { column: ['revenue'], limit: 501 } });
  });
});

describe('keysPlan with a calculated metric', () => {
  const net: ColumnFilter = { field: 'net', op: 'gt', value: 100 };
  const netRule = { column: 'net', operator: 'gt', value: 100 };
  const sumRule = { column: 'revenue', operator: 'gt', value: 100, function: 'SUM' };
  const run = (names: string[], filters: ColumnFilter[], agg: Aggregation = sum) => keysPlan(schema, names, agg, filters, []);
  const sumFilter = having.revenue!;
  it('is not a group key when shown next to a HAVING rule', () => {
    expect(run(['status', 'net', 'revenue'], [sumFilter])).toEqual({
      kind: 'read', key: 'status',
      options: { column: ['status', 'revenue'], aggregation: [{ column: 'revenue', function: 'SUM' }], filter: [sumRule], limit: 501 },
    });
  });
  it('is not the only group key either', () => {
    expect(run(['net', 'revenue'], [sumFilter])).toMatchObject({ kind: 'read', key: null, options: { column: ['revenue'] } });
  });
  it('a row-level calculated column still is a group key', () => {
    expect(run(['status', 'margin', 'revenue'], [sumFilter])).toEqual({ kind: 'fallback' });
  });
  it('a filter on it alone makes the plan read, names the column and has no aggregation', () => {
    const p = run(['status', 'net'], [net], NO_AGGREGATION);
    expect(p).toEqual({ kind: 'read', key: 'status', options: { column: ['status', 'net'], filter: [netRule], limit: 501 } });
    expect(p.kind === 'read' && 'aggregation' in p.options).toBe(false);
  });
  it('a filter on it next to a HAVING rule keeps only the HAVING rule in aggregation', () => {
    expect(run(['status', 'net', 'revenue'], [net, sumFilter])).toEqual({
      kind: 'read', key: 'status',
      options: { column: ['status', 'revenue', 'net'], aggregation: [{ column: 'revenue', function: 'SUM' }], filter: [netRule, sumRule], limit: 501 },
    });
  });
  it('a filter on a metric that is not shown is still read, in a grouped table', () => {
    expect(run(['status', 'revenue'], [net])).toMatchObject({ kind: 'read', key: 'status', options: { column: ['status', 'net'] } });
  });
  it('falls back when the rows are ungrouped and no calculated metric is a column', () => {
    expect(run(['status'], [net], NO_AGGREGATION)).toEqual({ kind: 'fallback' });
    expect(run(['status'], [net, sumFilter], NO_AGGREGATION)).toEqual({ kind: 'fallback' });
  });
  it('a filter on a row-level calculated column is a plain rule: the plan is off', () => {
    expect(run(['status', 'margin'], [{ field: 'margin', op: 'gt', value: 1 }], NO_AGGREGATION)).toEqual({ kind: 'off' });
  });
});

describe('keysOutcome', () => {
  const rows = (...v: unknown[]) => v.map((x) => ({ status: x, 'revenue | SUM': 1 }));
  it('one key builds an in rule of the passing keys', () => {
    expect(keysOutcome('status', rows('paid', 'new'))).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: ['paid', 'new'] } });
    expect(keysOutcome('status', rows(1, 2))).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: [1, 2] } });
  });
  it('number keys that arrive as strings become numbers', () => {
    const num = { category: 'number' as const };
    expect(keysOutcome('status', rows('1', '2.50', '-3'), num)).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: [1, 2.5, -3] } });
    expect(keysOutcome('status', rows(4, '5.0'), num)).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: [4, 5] } });
  });
  it('number keys a double cannot hold, or that are not numbers, fall back', () => {
    const num = { category: 'number' as const };
    expect(keysOutcome('status', rows('9007199254740993'), num)).toEqual({ kind: 'fallback' });
    expect(keysOutcome('status', rows('1.00000000000000000001'), num)).toEqual({ kind: 'fallback' });
    expect(keysOutcome('status', rows('abc'), num)).toEqual({ kind: 'fallback' });
    expect(keysOutcome('status', rows(1, null), num)).toEqual({ kind: 'fallback' });
  });
  it('zero passing groups is empty, with or without a key', () => {
    expect(keysOutcome('status', [])).toEqual({ kind: 'empty' });
    expect(keysOutcome(null, [])).toEqual({ kind: 'empty' });
  });
  it('zero keys with one row adds no rule', () => expect(keysOutcome(null, [{ 'revenue | SUM': 130 }])).toEqual({ kind: 'rule', rule: null }));
  it('falls back for more than 500 keys, but takes exactly 500', () => {
    expect(keysOutcome('status', rows(...Array.from({ length: IN_LIST_MAX }, (_, i) => `k${i}`)))).toMatchObject({ kind: 'rule' });
    expect(keysOutcome('status', rows(...Array.from({ length: IN_LIST_MAX + 1 }, (_, i) => `k${i}`)))).toEqual({ kind: 'fallback' });
  });
  it('falls back for a null key and for mixed types', () => {
    expect(keysOutcome('status', rows('a', null))).toEqual({ kind: 'fallback' });
    expect(keysOutcome('status', rows('a', 2))).toEqual({ kind: 'fallback' });
  });
});
