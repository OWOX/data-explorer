import type { TraverseOptions } from '../sdk/types';
import { answersQuery } from './answers';

const read: TraverseOptions = {
  column: ['day', 'a', 'b'],
  aggregation: [{ column: 'a', function: 'SUM' }, { column: 'b', function: 'AVG' }],
  dateTrunc: [{ column: 'day', unit: 'MONTH' }],
  uniqueCount: ['', 'x'],
  filter: [{ column: 'c', operator: 'is_blank' }],
};

test('a query for a subset of the aggregations and counts is answered', () => {
  expect(answersQuery(read, { ...read, column: ['day', 'a'], aggregation: [{ column: 'a', function: 'SUM' }], uniqueCount: [''] })).toBe(true);
  expect(answersQuery(read, read)).toBe(true);
  expect(answersQuery(read, { ...read, column: ['day'], aggregation: undefined, uniqueCount: undefined })).toBe(true);
});
test('a different filter, group key, limit or bucket is not answered', () => {
  expect(answersQuery(read, { ...read, filter: [] })).toBe(false);
  expect(answersQuery(read, { ...read, column: ['other', 'a', 'b'] })).toBe(false);
  expect(answersQuery(read, { ...read, column: ['a', 'b'], aggregation: read.aggregation })).toBe(false);
  expect(answersQuery(read, { ...read, limit: 5 })).toBe(false);
  expect(answersQuery(read, { ...read, dateTrunc: [{ column: 'day', unit: 'DAY' }] })).toBe(false);
});
test('an added column, another function or another count path is not answered', () => {
  expect(answersQuery(read, { ...read, column: ['day', 'a', 'b', 'c'], aggregation: [...read.aggregation!, { column: 'c', function: 'SUM' }] })).toBe(false);
  expect(answersQuery(read, { ...read, aggregation: [{ column: 'a', function: 'MAX' }, { column: 'b', function: 'AVG' }] })).toBe(false);
  expect(answersQuery(read, { ...read, uniqueCount: ['', 'y'] })).toBe(false);
});
