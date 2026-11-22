import type { TraverseOptions } from '../sdk/types';
import type { JoinedSource } from '../api/blendable';
import { answersQuery, joinGrainOf } from './answers';

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

test('a grouped read does not answer an ungrouped one', () => {
  expect(answersQuery({ column: ['a'], aggregation: [{ column: 'a', function: 'SUM' }] }, { column: ['a'] })).toBe(false);
  expect(answersQuery({ column: ['a', 'b'] }, { column: ['a'] })).toBe(false);
});

const src = (aliasPath: string, field: string, mainGrainCollapse: 'none' | 'collapses', mainGrainMultiplication: 'none' | 'multiplies'): JoinedSource =>
  ({ aliasPath, martId: aliasPath, label: aliasPath, depth: 1, uniqueCount: true, fields: [{ name: field }], mainGrainCollapse, mainGrainMultiplication }) as unknown as JoinedSource;
const joins = joinGrainOf([src('c', 'c__x', 'none', 'none'), src('o', 'o__y', 'collapses', 'multiplies')]);
const withJoin = (col: string, path: string): TraverseOptions => ({ column: ['m', col], aggregation: [{ column: 'm', function: 'SUM' }, { column: col, function: 'SUM' }], uniqueCount: ['', path] });
const without: TraverseOptions = { column: ['m'], aggregation: [{ column: 'm', function: 'SUM' }], uniqueCount: [''] };

test('dropping a grain-preserving join is answered; dropping one that changes the main grain reads again', () => {
  expect(answersQuery(withJoin('c__x', 'c'), without, joins)).toBe(true);
  expect(answersQuery(withJoin('o__y', 'o'), without, joins)).toBe(false);
  // Keeping the join is fine whatever it does.
  expect(answersQuery(withJoin('o__y', 'o'), withJoin('o__y', 'o'), joins)).toBe(true);
  // A count path alone counts as a join.
  expect(answersQuery({ ...without, uniqueCount: ['', 'o'] }, without, joins)).toBe(false);
});
