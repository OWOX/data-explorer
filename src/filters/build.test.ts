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
  test('is part of the one exact value', () => {
    expect(toTraverseFilter({ field: 'status', op: 'eq', value: 'San Francisco, CA' }, str)).toEqual({ column: 'status', operator: 'eq', value: 'San Francisco, CA' });
    expect(toTraverseFilter({ field: 'status', op: 'neq', value: 'San Francisco, CA' }, str)).toEqual({ column: 'status', operator: 'neq', value: 'San Francisco, CA' });
  });
});

describe('is any of / is none of', () => {
  const num: Field = { name: 'n', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: false };
  const day: Field = { name: 'd', alias: null, type: 'DATE', category: 'date', description: null, isPrimaryKey: false };
  const ts: Field = { name: 't', alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false };
  const clock: Field = { name: 'c', alias: null, type: 'TIME', category: 'time', description: null, isPrimaryKey: false };
  test('a string list is in / not_in, a trailing comma ignored, one value still a 1-element array', () => {
    expect(toTraverseFilter({ field: 'status', op: 'in', value: 'a, b, ' }, str)).toEqual({ column: 'status', operator: 'in', value: ['a', 'b'] });
    expect(toTraverseFilter({ field: 'status', op: 'not_in', value: 'a,b' }, str)).toEqual({ column: 'status', operator: 'not_in', value: ['a', 'b'] });
    expect(toTraverseFilter({ field: 'status', op: 'in', value: 'a' }, str)).toEqual({ column: 'status', operator: 'in', value: ['a'] });
  });
  test('numbers are sent as numbers, dates as typed, datetimes and times with seconds', () => {
    expect(toTraverseFilter({ field: 'n', op: 'in', value: '1, 2.5' }, num)).toEqual({ column: 'n', operator: 'in', value: [1, 2.5] });
    expect(toTraverseFilter({ field: 'd', op: 'not_in', value: '2026-01-01, 2026-01-02' }, day)).toEqual({ column: 'd', operator: 'not_in', value: ['2026-01-01', '2026-01-02'] });
    expect(toTraverseFilter({ field: 't', op: 'in', value: '2026-01-01T10:00, 2026-01-02T11:30' }, ts)).toEqual({ column: 't', operator: 'in', value: ['2026-01-01 10:00:00', '2026-01-02 11:30:00'] });
    expect(toTraverseFilter({ field: 'c', op: 'in', value: '10:00, 11:30' }, clock)).toEqual({ column: 'c', operator: 'in', value: ['10:00:00', '11:30:00'] });
  });
  test('complete with one token; numbers need every token numeric', () => {
    expect(isComplete({ field: 'status', op: 'in', value: ', ' }, str)).toBe(false);
    expect(isComplete({ field: 'status', op: 'in', value: 'a' }, str)).toBe(true);
    expect(isComplete({ field: 'n', op: 'in', value: '1, 2' }, num)).toBe(true);
    expect(isComplete({ field: 'n', op: 'in', value: '1, x' }, num)).toBe(false);
  });
  test('on is an eq with the same value shape as the other date rules', () => {
    expect(toTraverseFilter({ field: 'd', op: 'on', value: '2026-01-01' }, day)).toEqual({ column: 'd', operator: 'eq', value: '2026-01-01' });
    // A datetime column has no single moment: on a day is the whole day.
    expect(toTraverseFilter({ field: 't', op: 'on', value: '2026-01-01' }, ts)).toEqual({ column: 't', operator: 'between', value: { from: '2026-01-01 00:00:00', to: '2026-01-01 23:59:59' } });
    expect(toTraverseFilter({ field: 'c', op: 'on', value: '10:00' }, clock)).toEqual({ column: 'c', operator: 'eq', value: '10:00:00' });
  });
  test('list entries on date and time columns must be real dates and clock times', () => {
    expect(isComplete({ field: 'd', op: 'in', value: '2026-01-01, 2026-02-28' }, day)).toBe(true);
    expect(isComplete({ field: 'd', op: 'in', value: '2026-02-30' }, day)).toBe(false);
    expect(isComplete({ field: 'd', op: 'in', value: '2026-13-01' }, day)).toBe(false);
    expect(isComplete({ field: 'd', op: 'in', value: '2026-01-01 10:00' }, day)).toBe(false);
    expect(isComplete({ field: 't', op: 'in', value: '2026-01-01, 2026-01-01 10:00:00, 2026-01-01T10:00' }, ts)).toBe(true);
    expect(isComplete({ field: 't', op: 'in', value: 'yesterday' }, ts)).toBe(false);
    expect(isComplete({ field: 'c', op: 'in', value: '10:00, 23:59:59' }, clock)).toBe(true);
    expect(isComplete({ field: 'c', op: 'in', value: '24:00' }, clock)).toBe(false);
  });
  test('a list holds at most 500 values', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`).join(', ');
    expect(isComplete({ field: 'status', op: 'in', value: many(500) }, str)).toBe(true);
    expect(isComplete({ field: 'status', op: 'in', value: many(501) }, str)).toBe(false);
  });
  test('the 500 cap counts parsed values, not commas', () => {
    const quoted = (n: number) => Array.from({ length: n }, (_, i) => `"v, ${i}"`).join(', ');
    expect(isComplete({ field: 'status', op: 'in', value: quoted(500) }, str)).toBe(true);
    expect(isComplete({ field: 'status', op: 'in', value: quoted(501) }, str)).toBe(false);
  });
  test('a regex that does not compile is incomplete', () => {
    expect(isComplete({ field: 'status', op: 'regex', value: '^a(' }, str)).toBe(false);
    expect(isComplete({ field: 'status', op: 'not_regex', value: '[' }, str)).toBe(false);
    expect(isComplete({ field: 'status', op: 'regex', value: '^a.*' }, str)).toBe(true);
  });
  test('regex rules go out as they are', () => {
    expect(toTraverseFilter({ field: 'status', op: 'regex', value: '^a.*' }, str)).toEqual({ column: 'status', operator: 'regex', value: '^a.*' });
    expect(toTraverseFilter({ field: 'status', op: 'not_regex', value: 'x' }, str)).toEqual({ column: 'status', operator: 'not_regex', value: 'x' });
  });
});
