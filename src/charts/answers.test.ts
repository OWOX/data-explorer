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

test('a join kept through a dotted path keeps its ancestors', () => {
  const nested = joinGrainOf([src('customers', 'cu__x', 'none', 'multiplies'), src('customers.countries', 'co__y', 'none', 'none')]);
  const sum = (column: string) => ({ column, function: 'SUM' as const });
  const both: TraverseOptions = { column: ['m', 'cu__x', 'co__y'], aggregation: [sum('m'), sum('cu__x'), sum('co__y')], uniqueCount: [''] };
  const deep: TraverseOptions = { column: ['m', 'co__y'], aggregation: [sum('m'), sum('co__y')], uniqueCount: [''] };
  expect(answersQuery(both, deep, nested)).toBe(true);
  expect(answersQuery(both, without, nested)).toBe(false);
});

test('a read without a calculated metric does not answer an ask with it, nor the reverse; both sides with it answer a dropped ordinary metric', () => {
  const net = { ...without, column: ['m', 'net'] };
  expect(answersQuery(without, net)).toBe(false);
  expect(answersQuery(net, without)).toBe(false);
  const both: TraverseOptions = { column: ['m', 'n2', 'net'], aggregation: [{ column: 'm', function: 'SUM' }, { column: 'n2', function: 'SUM' }], uniqueCount: [''] };
  expect(answersQuery(both, net)).toBe(true);
});

describe('a calculated metric column (no function) is not a group key', () => {
  const metrics = joinGrainOf([], new Set(['margin']));
  const full: TraverseOptions = { column: ['amount', 'margin'], aggregation: [{ column: 'amount', function: 'SUM' }], uniqueCount: ['', 'x'], filter: [{ column: 'c', operator: 'is_blank' }] };
  const counts: TraverseOptions = { uniqueCount: ['', 'x'], filter: full.filter };
  test('a read with the metric answers an ask without it, or with another count of the same rules; not the other way round', () => {
    expect(answersQuery(full, counts, metrics)).toBe(true);
    expect(answersQuery(full, { ...full, column: ['amount'] }, metrics)).toBe(true);
    expect(answersQuery(counts, full, metrics)).toBe(false);
    expect(answersQuery({ ...full, column: ['amount'] }, full, metrics)).toBe(false);
  });
  test('with no metric told, the column is a key as before', () => {
    expect(answersQuery(full, counts, joinGrainOf([]))).toBe(false);
  });
  test('a dimension column stays a real group key, also when metrics are known', () => {
    const grouped: TraverseOptions = { column: ['status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }], uniqueCount: [''] };
    expect(answersQuery(grouped, { uniqueCount: [''] }, metrics)).toBe(false);
    expect(answersQuery({ uniqueCount: [''] }, grouped, metrics)).toBe(false);
    expect(answersQuery(grouped, { ...grouped, column: ['region', 'amount'] }, metrics)).toBe(false);
  });
});
