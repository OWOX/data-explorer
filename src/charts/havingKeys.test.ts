import { describe, expect, it } from 'vitest';
import type { ColumnFilter } from '../filters/build';
import { NO_AGGREGATION, type Aggregation } from '../model/aggregation';
import type { Field, Schema } from '../model/types';
import { IN_LIST_MAX, keysOutcome, keysPlan } from './havingKeys';

const f = (name: string, category: Field['category'], type = 'STRING'): Field => ({ name, type, category, isPrimaryKey: false } as unknown as Field);
const schema: Schema = [f('status', 'string'), f('country', 'string'), f('day', 'date'), f('flag', 'boolean'), f('revenue', 'number', 'NUMERIC')];
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
  it('falls back for a boolean key', () => expect(plain(['flag', 'revenue'])).toEqual({ kind: 'fallback' }));
  it('with no group key reads only the HAVING column', () => {
    const p = plain(['revenue']);
    expect(p).toMatchObject({ kind: 'read', key: null, options: { column: ['revenue'], limit: 501 } });
  });
});

describe('keysOutcome', () => {
  const rows = (...v: unknown[]) => v.map((x) => ({ status: x, 'revenue | SUM': 1 }));
  it('one key builds an in rule of the passing keys', () => {
    expect(keysOutcome('status', rows('paid', 'new'))).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: ['paid', 'new'] } });
    expect(keysOutcome('status', rows(1, 2))).toEqual({ kind: 'rule', rule: { column: 'status', operator: 'in', value: [1, 2] } });
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
