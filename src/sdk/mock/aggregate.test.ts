import { aggregateRows, truncDate } from './aggregate';

const rows = [
  { status: 'paid', amount: 10, at: '2026-11-03T10:00:00Z', city: 'Kyiv' },
  { status: 'paid', amount: 30, at: '2026-11-20T10:00:00Z', city: 'Lviv' },
  { status: 'open', amount: 5, at: '2026-12-01T10:00:00Z', city: 'Kyiv' },
  { status: 'open', amount: null, at: '2026-12-02T10:00:00Z', city: null },
];

test('other columns are group keys; each function is its own output with the API\'s key', () => {
  const out = aggregateRows(rows, ['status', 'amount'], [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'COUNT' }], [], []);
  expect(out).toEqual([{ status: 'paid', 'amount | SUM': 40, 'amount | COUNT': 2 }, { status: 'open', 'amount | SUM': 5, 'amount | COUNT': 1 }]);
});

test('every function', () => {
  const out = aggregateRows(rows, ['amount', 'city'], [...(['SUM', 'AVG', 'MIN', 'MAX', 'COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE', 'P50'] as const).map((f) => ({ column: 'amount', function: f })), { column: 'city', function: 'COUNT_DISTINCT' as const }], [], []);
  expect(out).toEqual([{ 'amount | SUM': 45, 'amount | AVG': 15, 'amount | MIN': 5, 'amount | MAX': 30, 'amount | COUNT': 3, 'amount | COUNTUNIQUE': 3, 'amount | STRINGAGG': '10, 30, 5', 'amount | ANYVALUE': 10, 'amount | MEDIAN': 10, 'city | COUNTUNIQUE': 2 }]);
});

test('a bucketed date groups by the bucket start', () => {
  const out = aggregateRows(rows, ['at', 'amount'], [{ column: 'amount', function: 'SUM' }], [{ column: 'at', unit: 'MONTH' }], []);
  expect(out).toEqual([{ at: '2026-11-01', 'amount | SUM': 40 }, { at: '2026-12-01', 'amount | SUM': 5 }]);
  expect(truncDate('2026-11-12T00:00:00Z', 'WEEK')).toBe('2026-11-09');
  expect(truncDate('2026-11-12', 'QUARTER')).toBe('2026-10-01');
  expect(truncDate('2026-11-12', 'YEAR')).toBe('2026-01-01');
  expect(truncDate('nope', 'DAY')).toBeNull();
});

test('sort names a group key, or an aggregated column by its first function', () => {
  const sums = aggregateRows(rows, ['status', 'amount'], [{ column: 'amount', function: 'SUM' }], [], [{ column: 'amount', direction: 'asc' }]);
  expect(sums.map((r) => r.status)).toEqual(['open', 'paid']);
  const keys = aggregateRows(rows, ['status', 'amount'], [{ column: 'amount', function: 'SUM' }], [], [{ column: 'status', direction: 'asc' }]);
  expect(keys.map((r) => r.status)).toEqual(['open', 'paid']);
});

test('a unique count per group counts distinct key tuples and skips all-null keys', () => {
  const r = [{ g: 'a', id: 1 }, { g: 'a', id: 1 }, { g: 'a', id: 2 }, { g: 'b', id: null }];
  const out = aggregateRows(r, ['g'], [], [], [{ column: 'Unique Count', direction: 'desc' }], [{ key: 'Unique Count', pk: ['id'] }]);
  expect(out).toEqual([{ g: 'a', 'Unique Count': 2 }, { g: 'b', 'Unique Count': 0 }]);
});
