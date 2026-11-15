import { isComplete, toTraverseFilter } from './build';
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
  expect(toTraverseFilter({ field: 'created_at', op: 'after', value: '2026-11-01T10:30' }, ts)).toEqual({ column: 'created_at', operator: 'gt', value: '2026-11-01T10:30:00' });
  expect(toTraverseFilter({ field: 'seen', op: 'before', value: '2026-11-01T10:30:15' }, dt)).toEqual({ column: 'seen', operator: 'lt', value: '2026-11-01T10:30:15' });
  expect(toTraverseFilter({ field: 'created_at', op: 'between', value: { from: '2026-11-01T08:00', to: '2026-11-01T09:15' } }, ts))
    .toEqual({ column: 'created_at', operator: 'between', value: { from: '2026-11-01T08:00:00', to: '2026-11-01T09:15:00' } });
});

test('between on a timestamp with date-only values includes the whole end day', () => {
  expect(toTraverseFilter({ field: 'created_at', op: 'between', value: { from: '2026-11-01', to: '2026-11-03' } }, ts))
    .toEqual({ column: 'created_at', operator: 'between', value: { from: '2026-11-01T00:00:00', to: '2026-11-03T23:59:59' } });
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
