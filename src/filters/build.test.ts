import { describe } from 'vitest';
import { dropOrphanHaving, isComplete, toTraverseFilter, toTraverseFilters, type ColumnFilter } from './build';
import type { Field } from '../model/types';

const num: Field = { name: 'amount', alias: null, type: 'NUMERIC', category: 'number', description: null, isPrimaryKey: false };
const str: Field = { ...num, name: 'status', type: 'STRING', category: 'string' };
const date: Field = { ...num, name: 'day', type: 'DATE', category: 'date' };
const ts: Field = { ...num, name: 'created_at', type: 'TIMESTAMP', category: 'date' };

test.each([
  [str, { field: 'status', op: 'contains', value: 'paid' }, { column: 'status', operator: 'contains', value: 'paid' }],
  [num, { field: 'amount', op: 'gte', value: '10' }, { column: 'amount', operator: 'gte', value: 10 }],
  [num, { field: 'amount', op: 'between', value: { from: '1', to: '5' } }, { column: 'amount', operator: 'between', value: { from: 1, to: 5 } }],
  [date, { field: 'day', op: 'on', value: '2026-11-01' }, { column: 'day', operator: 'eq', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'before', value: '2026-11-01' }, { column: 'created_at', operator: 'lt', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'after', value: '2026-11-01' }, { column: 'created_at', operator: 'gt', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } }, { column: 'created_at', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }],
  [str, { field: 'status', op: 'is_blank' }, { column: 'status', operator: 'is_blank' }],
] as const)('%#', (field, filter, expected) => {
  expect(toTraverseFilter(filter as never, field)).toEqual(expected);
});

test('isComplete rejects missing or non-numeric values', () => {
  expect(isComplete({ field: 'amount', op: 'gt', value: '' }, num)).toBe(false);
  expect(isComplete({ field: 'amount', op: 'gt', value: 'abc' }, num)).toBe(false);
  expect(isComplete({ field: 'amount', op: 'between', value: { from: '1', to: '' } }, num)).toBe(false);
  expect(isComplete({ field: 'status', op: 'is_blank' }, str)).toBe(true);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 0 } }, ts)).toBe(false);
});

test('isComplete requires N for N-presets and rejects unknown kinds', () => {
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days' } as never }, ts)).toBe(false);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'bogus' } as never }, ts)).toBe(false);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } }, ts)).toBe(true);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'today' } }, ts)).toBe(true);
});

const time: Field = { ...num, name: 'at', type: 'TIME', category: 'time' };
const dt: Field = { ...num, name: 'seen', type: 'DATETIME', category: 'date' };

test('datetime-local values are sent with seconds', () => {
  expect(toTraverseFilter({ field: 'created_at', op: 'after', value: '2026-11-01T10:30' }, ts)).toEqual({ column: 'created_at', operator: 'gt', value: '2026-11-01 10:30:00' });
  expect(toTraverseFilter({ field: 'seen', op: 'before', value: '2026-11-01T10:30:15' }, dt)).toEqual({ column: 'seen', operator: 'lt', value: '2026-11-01 10:30:15' });
  expect(toTraverseFilter({ field: 'created_at', op: 'between', value: { from: '2026-11-01T08:00', to: '2026-11-01T09:15' } }, ts))
    .toEqual({ column: 'created_at', operator: 'between', value: { from: '2026-11-01 08:00:00', to: '2026-11-01 09:15:00' } });
});

test('between on a timestamp with date-only values includes the whole end day', () => {
  expect(toTraverseFilter({ field: 'created_at', op: 'between', value: { from: '2026-11-01', to: '2026-11-03' } }, ts))
    .toEqual({ column: 'created_at', operator: 'between', value: { from: '2026-11-01 00:00:00', to: '2026-11-03 23:59:59' } });
  // a DATE field is untouched
  expect(toTraverseFilter({ field: 'day', op: 'between', value: { from: '2026-11-01', to: '2026-11-03' } }, date))
    .toEqual({ column: 'day', operator: 'between', value: { from: '2026-11-01', to: '2026-11-03' } });
});

test('TIME values are sent as HH:MM:SS', () => {
  expect(toTraverseFilter({ field: 'at', op: 'after', value: '09:30' }, time)).toEqual({ column: 'at', operator: 'gt', value: '09:30:00' });
  expect(toTraverseFilter({ field: 'at', op: 'between', value: { from: '09:30', to: '17:45:10' } }, time))
    .toEqual({ column: 'at', operator: 'between', value: { from: '09:30:00', to: '17:45:10' } });
});

test('relative N is capped at 3650', () => {
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 3650 } }, ts)).toBe(true);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 3651 } }, ts)).toBe(false);
});

test('a full timestamp from a row (fraction or zone) is not rewritten', () => {
  expect(toTraverseFilter({ field: 'created_at', op: 'between', value: { from: '2026-11-01T10:00:00.123Z', to: '2026-11-01T10:00:00.123Z' } }, ts))
    .toEqual({ column: 'created_at', operator: 'between', value: { from: '2026-11-01T10:00:00.123Z', to: '2026-11-01T10:00:00.123Z' } });
});

describe('slices and HAVING in toTraverseFilters', () => {
  const main: Field = { ...num, name: 'status', type: 'STRING', category: 'string' };
  const joinedCountry: Field = { ...num, name: 'customers__country_code', type: 'STRING', category: 'string', joined: { martId: 'customers', label: 'Customers', aliasPath: 'customers' } };
  const revenue: Field = { ...num, name: 'net_revenue', type: 'STRING', category: 'string' };
  const schema = [main, joinedCountry, revenue, num];

  test('emits the filters, then the slices with placement pre-join', () => {
    const out = toTraverseFilters(schema, [{ field: 'status', op: 'eq', value: 'paid' }], [{ field: 'customers__country_code', op: 'eq', value: 'PL' }]);
    expect(out).toEqual([
      { column: 'status', operator: 'eq', value: 'paid' },
      { column: 'customers__country_code', operator: 'eq', value: 'PL', placement: 'pre-join' },
    ]);
  });
  test('drops a slice on a main field and an incomplete slice', () => {
    expect(toTraverseFilters(schema, [], [{ field: 'status', op: 'eq', value: 'paid' }])).toEqual([]);
    expect(toTraverseFilters(schema, [], [{ field: 'customers__country_code', op: 'eq', value: '' }])).toEqual([]);
  });
  test('emits HAVING with function only when the aggregations have the pair', () => {
    const f = [{ field: 'amount', op: 'gt', value: '100', fn: 'SUM' }] as const;
    expect(toTraverseFilters(schema, [...f], [], [{ column: 'amount', function: 'SUM' }])).toEqual([{ column: 'amount', operator: 'gt', value: 100, function: 'SUM' }]);
    expect(toTraverseFilters(schema, [...f], [], [{ column: 'amount', function: 'AVG' }])).toEqual([]);
    expect(toTraverseFilters(schema, [...f])).toEqual([]);
  });
  test('a HAVING value on a SUM over a STRING column is numeric', () => {
    const out = toTraverseFilters(schema, [{ field: 'net_revenue', op: 'gt', value: '100', fn: 'SUM' }], [], [{ column: 'net_revenue', function: 'SUM' }]);
    expect(out).toEqual([{ column: 'net_revenue', operator: 'gt', value: 100, function: 'SUM' }]);
  });
  test('the two-argument call shape still works', () => {
    expect(toTraverseFilters(schema, [{ field: 'status', op: 'is_blank' }])).toEqual([{ column: 'status', operator: 'is_blank' }]);
  });
});

describe('dropOrphanHaving', () => {
  const having: ColumnFilter = { field: 'net_revenue', op: 'gt', value: 100, fn: 'SUM' };
  const plain: ColumnFilter = { field: 'status', op: 'eq', value: 'paid' };
  test('drops a HAVING filter whose (column, function) aggregation is gone, and nothing else', () => {
    expect(dropOrphanHaving({ net_revenue: having, status: plain }, [])).toEqual({ status: plain });
    expect(dropOrphanHaving({ net_revenue: having, status: plain }, [{ column: 'net_revenue', function: 'AVG' }])).toEqual({ status: plain });
  });
  test('keeps a HAVING filter whose aggregation is still there, as the same map', () => {
    const m = { net_revenue: having, status: plain };
    expect(dropOrphanHaving(m, [{ column: 'net_revenue', function: 'SUM' }])).toBe(m);
  });
});

describe('a comma in a text eq/neq', () => {
  const sf = (list?: true): ColumnFilter => ({ field: 'status', op: 'eq', value: 'San Francisco, CA', ...(list ? { list } : {}) });
  test('stays one exact value without the list marker (chart click, join, saved rule)', () => {
    expect(toTraverseFilter(sf(), str)).toEqual({ column: 'status', operator: 'eq', value: 'San Francisco, CA' });
    expect(toTraverseFilter({ ...sf(), op: 'neq' }, str)).toEqual({ column: 'status', operator: 'neq', value: 'San Francisco, CA' });
  });
  test('a marked rule is a list: eq is in, neq is not_in', () => {
    expect(toTraverseFilter({ field: 'status', op: 'eq', value: 'a, b, ', list: true }, str)).toEqual({ column: 'status', operator: 'in', value: ['a', 'b'] });
    expect(toTraverseFilter({ field: 'status', op: 'neq', value: 'a, b', list: true }, str)).toEqual({ column: 'status', operator: 'not_in', value: ['a', 'b'] });
  });
});
