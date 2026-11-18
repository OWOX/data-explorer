import type { Field } from '../../model/types';
import { sanitizeAggregation } from '../../model/aggregation';
import { removedAggregation, unappliedFilter } from './unapplied';

const status: Field = { name: 'customers__status', alias: 'User Status', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'c', label: 'Customers', aliasPath: 'customers', originalName: 'status' }, postJoinAggregations: ['COUNT'] };

test('a rule the schema no longer allows is named, with the column', () => {
  const kept = { aggregations: [{ column: 'customers__status', function: 'STRING_AGG' as const }, { column: 'customers__status', function: 'COUNT' as const }], dateTrunc: [] };
  const applied = sanitizeAggregation(kept, [status]);
  const r = removedAggregation(kept, applied, [status]);
  expect(r?.text).toBe('Combined is no longer allowed on Customers · User Status; it was removed.');
});

test('nothing dropped says nothing', () => {
  const kept = { aggregations: [{ column: 'customers__status', function: 'COUNT' as const }], dateTrunc: [] };
  expect(removedAggregation(kept, sanitizeAggregation(kept, [status]), [status])).toBeNull();
});

test('a filter the column cannot take is named; a complete one says nothing', () => {
  expect(unappliedFilter({ field: 'customers__status', op: 'eq', value: '' }, status)).toMatch(/filter on .*User Status.* not applied/);
  expect(unappliedFilter({ field: 'customers__status', op: 'eq', value: 'x' }, status)).toBeNull();
});
