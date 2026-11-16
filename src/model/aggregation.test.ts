import { aggregatedKey, allowedFunctions, applyDraft, canBucket, canZone, describeColumn, draftOf, formatBucket, isGrouped, keepVisible, NO_AGGREGATION, outputsOf, type Aggregation } from './aggregation';
import type { Field } from './types';

const f = (category: Field['category'], extra: Partial<Field> = {}): Field => ({ name: 'x', alias: null, type: category === 'date' ? 'TIMESTAMP' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });

test('a field offers its category\'s defaults, narrowed by its own governance, or its join\'s post-join set', () => {
  expect(allowedFunctions(f('number'))).toEqual(['SUM', 'AVG', 'MIN', 'MAX']);
  expect(allowedFunctions(f('string'))).toEqual(['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE']);
  expect(allowedFunctions(f('date'))).toEqual(['MIN', 'MAX']);
  expect(allowedFunctions(f('boolean'))).toEqual(['COUNT', 'COUNT_DISTINCT']);
  expect(allowedFunctions(f('other'))).toEqual(['COUNT']);
  // an override may only narrow within what the type supports, and keeps the canonical order
  expect(allowedFunctions(f('number', { allowedAggregations: ['P50', 'SUM', 'STRING_AGG'] }))).toEqual(['SUM', 'P50']);
  expect(allowedFunctions(f('number', { allowedAggregations: [] }))).toEqual([]);
  // a joined field: the analyst's post-join set governs, [] means none; without one the defaults
  const joined = { joined: { martId: 'm', label: 'M', aliasPath: 'm' } };
  expect(allowedFunctions(f('number', { ...joined, postJoinAggregations: ['MAX'] }))).toEqual(['MAX']);
  expect(allowedFunctions(f('number', { ...joined, postJoinAggregations: [] }))).toEqual([]);
  expect(allowedFunctions(f('number', joined))).toEqual(['SUM', 'AVG', 'MIN', 'MAX']);
  // postJoinAggregations is ignored on a native field
  expect(allowedFunctions(f('number', { postJoinAggregations: ['MAX'] }))).toEqual(['SUM', 'AVG', 'MIN', 'MAX']);
});

test('dates bucket, only a type with a time of day takes a time zone', () => {
  expect(canBucket(f('date'))).toBe(true);
  expect(canBucket(f('time'))).toBe(false);
  expect(canBucket(f('string'))).toBe(false);
  expect(canZone(f('date', { type: 'DATE' }))).toBe(false);
  expect(canZone(f('date', { type: 'TIMESTAMP' }))).toBe(true);
  expect(canZone(f('date', { type: 'DATETIME' }))).toBe(true);
});

test('row keys are "<column> | <TOKEN>", with the backend\'s odd tokens and dots made underscores', () => {
  expect(aggregatedKey('Amount', 'SUM')).toBe('Amount | SUM');
  expect(aggregatedKey('a', 'COUNT_DISTINCT')).toBe('a | COUNTUNIQUE');
  expect(aggregatedKey('a', 'P50')).toBe('a | MEDIAN');
  expect(aggregatedKey('a', 'STRING_AGG')).toBe('a | STRINGAGG');
  expect(aggregatedKey('a', 'ANY_VALUE')).toBe('a | ANYVALUE');
  expect(aggregatedKey('m.rev', 'AVG')).toBe('m_rev | AVG');
});

test('applying a draft rewrites that column\'s rules and keeps the others in place; a bucket and functions never coexist', () => {
  const a: Aggregation = { aggregations: [{ column: 'a', function: 'SUM' }, { column: 'b', function: 'MIN' }], dateTrunc: [{ column: 'd', unit: 'DAY' }] };
  const next = applyDraft('a', { functions: ['AVG', 'MAX'], bucket: null, timeZone: null }, a);
  expect(next.aggregations).toEqual([{ column: 'b', function: 'MIN' }, { column: 'a', function: 'AVG' }, { column: 'a', function: 'MAX' }]);
  expect(next.dateTrunc).toEqual([{ column: 'd', unit: 'DAY' }]);
  const bucketed = applyDraft('d', { functions: [], bucket: 'MONTH', timeZone: 'Europe/Kyiv' }, a);
  expect(bucketed.dateTrunc).toEqual([{ column: 'd', unit: 'MONTH', timeZone: 'Europe/Kyiv' }]);
  expect(applyDraft('d', { functions: [], bucket: 'MONTH', timeZone: null }, a).dateTrunc).toEqual([{ column: 'd', unit: 'MONTH' }]);
  expect(applyDraft('a', { functions: [], bucket: null, timeZone: null }, a).aggregations).toEqual([{ column: 'b', function: 'MIN' }]);
  expect(draftOf('d', bucketed)).toEqual({ functions: [], bucket: 'MONTH', timeZone: 'Europe/Kyiv' });
  expect(draftOf('b', a)).toEqual({ functions: ['MIN'], bucket: null, timeZone: null });
});

test('a grid is grouped as soon as one column has a function or a bucket; rules of hidden columns are dropped', () => {
  expect(isGrouped(NO_AGGREGATION)).toBe(false);
  expect(isGrouped(undefined)).toBe(false);
  expect(isGrouped({ aggregations: [], dateTrunc: [{ column: 'd', unit: 'DAY' }] })).toBe(true);
  const a: Aggregation = { aggregations: [{ column: 'a', function: 'SUM' }, { column: 'b', function: 'MIN' }], dateTrunc: [{ column: 'd', unit: 'DAY' }] };
  expect(keepVisible(a, ['a', 'd'])).toEqual({ aggregations: [{ column: 'a', function: 'SUM' }], dateTrunc: [{ column: 'd', unit: 'DAY' }] });
  expect(keepVisible(a, ['a', 'b', 'd'])).toBe(a);
});

test('every function is its own output column; only the first function of a column is sortable', () => {
  const a: Aggregation = { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'AVG' }], dateTrunc: [{ column: 'created', unit: 'MONTH' }] };
  expect(outputsOf(['status', 'amount', 'created'], a)).toEqual([
    { key: 'status', column: 'status', sortable: true },
    { key: 'amount | SUM', column: 'amount', fn: 'SUM', sortable: true },
    { key: 'amount | AVG', column: 'amount', fn: 'AVG', sortable: false },
    { key: 'created', column: 'created', bucket: 'MONTH', sortable: true },
  ]);
  expect(outputsOf(['a', 'b'], NO_AGGREGATION).map((o) => o.key)).toEqual(['a', 'b']);
});

test('the AI-prompt wording: functions in words, a bucket with its zone', () => {
  const a: Aggregation = { aggregations: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'AVG' }], dateTrunc: [{ column: 'created', unit: 'MONTH', timeZone: 'UTC' }] };
  expect(describeColumn('amount', a)).toBe('sum, average');
  expect(describeColumn('created', a)).toBe('by month (UTC)');
  expect(describeColumn('status', a)).toBeNull();
});

test('a bucket start is shown by its bucket', () => {
  expect(formatBucket('2026-11-01', 'MONTH')).toBe('Nov 2026');
  expect(formatBucket('2026-10-01T00:00:00.000Z', 'QUARTER')).toBe('Q4 2026');
  expect(formatBucket('2026-01-01', 'YEAR')).toBe('2026');
  expect(formatBucket('2026-11-09', 'DAY', 'en-US')).toBe('Nov 9, 2026');
  expect(formatBucket('2026-11-09', 'WEEK', 'en-US')).toBe('Nov 9, 2026');
  expect(formatBucket(null, 'DAY')).toBeNull();
  expect(formatBucket('soon', 'MONTH')).toBe('soon');
});
