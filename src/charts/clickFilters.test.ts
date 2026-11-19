import { bucketEnd, bucketFilter, dimensionFilter } from './clickFilters';
import type { Field } from '../model/types';

test('bucketEnd: the last day of each bucket', () => {
  expect(bucketEnd('2024-03-15', 'DAY')).toBe('2024-03-15');
  expect(bucketEnd('2024-03-25', 'WEEK')).toBe('2024-03-31');
  expect(bucketEnd('2024-12-30', 'WEEK')).toBe('2025-01-05');
  expect(bucketEnd('2024-03-01', 'MONTH')).toBe('2024-03-31');
  expect(bucketEnd('2024-04-01', 'MONTH')).toBe('2024-04-30');
  expect(bucketEnd('2024-02-01', 'MONTH')).toBe('2024-02-29');
  expect(bucketEnd('2023-02-01', 'MONTH')).toBe('2023-02-28');
  expect(bucketEnd('2024-01-01', 'QUARTER')).toBe('2024-03-31');
  expect(bucketEnd('2024-10-01', 'QUARTER')).toBe('2024-12-31');
  expect(bucketEnd('2024-01-01', 'YEAR')).toBe('2024-12-31');
  expect(bucketEnd('2024-03-01T00:00:00', 'MONTH')).toBe('2024-03-31');
});

test('bucketFilter is a between over the date part; dimensionFilter picks eq or is_true / is_false', () => {
  const date = { name: 'created_at' } as Field;
  expect(bucketFilter(date, '2024-03-01 00:00:00', 'MONTH')).toEqual({ field: 'created_at', op: 'between', value: { from: '2024-03-01', to: '2024-03-31' } });
  expect(dimensionFilter({ name: 'status', category: 'string' } as Field, 'paid')).toEqual({ field: 'status', op: 'eq', value: 'paid' });
  expect(dimensionFilter({ name: 'vip', category: 'boolean' } as Field, 'true').op).toBe('is_true');
  expect(dimensionFilter({ name: 'vip', category: 'boolean' } as Field, 'false').op).toBe('is_false');
});
