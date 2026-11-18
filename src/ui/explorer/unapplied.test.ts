import type { Field } from '../../model/types';
import { unappliedAggregation, unappliedFilter } from './unapplied';

const status: Field = { name: 'customers__status', alias: 'User Status', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'c', label: 'Customers', aliasPath: 'customers', originalName: 'status' }, postJoinAggregations: ['COUNT'] };

test('a function the column does not allow is named, with the column', () => {
  const next = { aggregations: [{ column: 'customers__status', function: 'STRING_AGG' as const }], dateTrunc: [] };
  expect(unappliedAggregation('customers__status', next, [status])).toBe("Combined isn't allowed on Customers · User Status; it was not applied.");
});

test('an allowed function says nothing', () => {
  const next = { aggregations: [{ column: 'customers__status', function: 'COUNT' as const }], dateTrunc: [] };
  expect(unappliedAggregation('customers__status', next, [status])).toBeNull();
});

test('a filter the column cannot take is named; a complete one says nothing', () => {
  expect(unappliedFilter({ field: 'customers__status', op: 'eq', value: '' }, status)).toMatch(/filter on .*User Status.* not applied/);
  expect(unappliedFilter({ field: 'customers__status', op: 'eq', value: 'x' }, status)).toBeNull();
});
