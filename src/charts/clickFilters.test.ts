import { bucketEnd, bucketFilter, dimensionFilter, isBucketDate } from './clickFilters';
import { toTraverseFilter, isComplete } from '../filters/build';
import { bucketZone } from './queries';
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

test('bucketFilter on a zoned column sends UTC instants from the zone\'s local midnight to one second before the next', () => {
  const date = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as Field;
  const ny = (start: string, b: 'DAY' | 'MONTH' | 'WEEK') => (bucketFilter(date, start, b, 'America/New_York').value as { from: string; to: string });
  expect(ny('2024-01-15', 'DAY')).toEqual({ from: '2024-01-15 05:00:00', to: '2024-01-16 04:59:59' });
  expect(ny('2024-07-15', 'DAY')).toEqual({ from: '2024-07-15 04:00:00', to: '2024-07-16 03:59:59' });
  // March 2024: starts on EST (-5), ends on EDT (-4); DST began on the 10th.
  expect(ny('2024-03-01', 'MONTH')).toEqual({ from: '2024-03-01 05:00:00', to: '2024-04-01 03:59:59' });
  // The spring-forward day is 23 hours long.
  expect(ny('2024-03-10', 'DAY')).toEqual({ from: '2024-03-10 05:00:00', to: '2024-03-11 03:59:59' });
  // East of UTC the bucket starts the evening before in UTC.
  expect(bucketFilter(date, '2024-01-15', 'DAY', 'Asia/Tokyo').value).toEqual({ from: '2024-01-14 15:00:00', to: '2024-01-15 14:59:59' });
  expect(bucketFilter(date, '2024-01-15', 'DAY', 'Asia/Kolkata').value).toEqual({ from: '2024-01-14 18:30:00', to: '2024-01-15 18:29:59' });
});

test('a zoned bucket filter passes through the traverse filter unchanged and counts as complete', () => {
  const date = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as Field;
  const f = bucketFilter(date, '2024-01-15', 'DAY', 'America/New_York');
  expect(isComplete(f, date)).toBe(true);
  expect(toTraverseFilter(f, date)).toEqual({ column: 'created_at', operator: 'between', value: { from: '2024-01-15 05:00:00', to: '2024-01-16 04:59:59' } });
});

test('bucketZone: only a zoneable date column gets the zone; an invalid zone gives none', () => {
  expect(bucketZone({ name: 'a', category: 'date', type: 'TIMESTAMP' } as Field, 'Europe/Kyiv')).toBe('Europe/Kyiv');
  expect(bucketZone({ name: 'a', category: 'date', type: 'DATE' } as Field, 'Europe/Kyiv')).toBeUndefined();
  expect(bucketZone({ name: 'a', category: 'date', type: 'TIMESTAMP' } as Field, 'not a zone')).toBeUndefined();
});

test('isBucketDate: a blank bucket (the label "null") is not a date', () => {
  expect(isBucketDate('2024-03-01 00:00:00')).toBe(true);
  expect(isBucketDate('null')).toBe(false);
});
