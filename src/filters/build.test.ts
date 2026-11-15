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
