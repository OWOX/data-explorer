import { vi } from 'vitest';
import { isTimeZone, sanitizeAggregation, ungroupableColumn, aggregatedKey, allowedFunctions, applyDraft, canBucket, canZone, draftOf, formatBucket, isGrouped, keepVisible, NO_AGGREGATION, outputsOf, type Aggregation } from './aggregation';
import type { Field } from './types';

const f = (category: Field['category'], extra: Partial<Field> = {}): Field => ({ name: 'x', alias: null, type: category === 'date' ? 'TIMESTAMP' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });

test('a field offers its category\'s defaults, narrowed by its own governance, or its join\'s post-join set', () => {
  expect(allowedFunctions(f('number'))).toEqual(['SUM', 'AVG', 'MIN', 'MAX']);
  expect(allowedFunctions(f('string'))).toEqual(['COUNT', 'COUNT_DISTINCT', 'STRING_AGG', 'ANY_VALUE']);
  expect(allowedFunctions(f('date'))).toEqual(['MIN', 'MAX']);
  expect(allowedFunctions(f('boolean'))).toEqual(['COUNT', 'COUNT_DISTINCT']);
  // an array, JSON or struct field takes no function (the backend refuses it); neither does a calculated field
  expect(allowedFunctions(f('other'))).toEqual([]);
  expect(allowedFunctions(f('number', { isCalculated: true }))).toEqual([]);
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

test('a bucket start is shown by its bucket', () => {
  expect(formatBucket('2026-11-01', 'MONTH')).toBe('Nov 2026');
  expect(formatBucket('2026-10-01T00:00:00.000Z', 'QUARTER')).toBe('Q4 2026');
  expect(formatBucket('2026-01-01', 'YEAR')).toBe('2026');
  expect(formatBucket('2026-11-09', 'DAY', 'en-US')).toBe('Nov 9, 2026');
  expect(formatBucket('2026-11-09', 'WEEK', 'en-US')).toBe('Nov 9, 2026');
  expect(formatBucket(null, 'DAY')).toBeNull();
  expect(formatBucket('soon', 'MONTH')).toBe('soon');
});

test('a calculated field cannot be bucketed or zoned', () => {
  expect(canBucket(f('date', { isCalculated: true }))).toBe(false);
  expect(canZone(f('date', { isCalculated: true }))).toBe(false);
});

test('sanitizeAggregation drops what the field cannot take and keeps the rest; same object when nothing changes', () => {
  const fields = [f('number', { name: 'n' }), f('number', { name: 'calc', isCalculated: true }), f('other', { name: 'arr' }), f('date', { name: 'ts' }), f('date', { name: 'd', type: 'DATE' }), f('string', { name: 's' })];
  const ok: Aggregation = { aggregations: [{ column: 'n', function: 'SUM' }, { column: 'unknown', function: 'SUM' }], dateTrunc: [{ column: 'ts', unit: 'MONTH', timeZone: 'UTC' }] };
  expect(sanitizeAggregation(ok, fields)).toBe(ok);
  const bad: Aggregation = {
    aggregations: [{ column: 'n', function: 'STRING_AGG' }, { column: 'n', function: 'SUM' }, { column: 'calc', function: 'SUM' }, { column: 'arr', function: 'COUNT' }, { column: 's', function: 'COUNT' }],
    dateTrunc: [{ column: 's', unit: 'DAY' }, { column: 'd', unit: 'DAY', timeZone: 'UTC' }, { column: 'calc', unit: 'DAY' }, { column: 's', unit: 'DAY' }],
  };
  expect(sanitizeAggregation(bad, fields)).toEqual({ aggregations: [{ column: 'n', function: 'SUM' }, { column: 's', function: 'COUNT' }], dateTrunc: [{ column: 'd', unit: 'DAY' }] });
  // a column with a function and a bucket keeps the function
  expect(sanitizeAggregation({ aggregations: [{ column: 'ts', function: 'MIN' }], dateTrunc: [{ column: 'ts', unit: 'DAY' }] }, fields).dateTrunc).toEqual([]);
});

test('ungroupableColumn finds a shown array or calculated column with no rule, only once the grid is grouped', () => {
  const fields = [f('string', { name: 's' }), f('other', { name: 'arr' }), f('number', { name: 'calc', isCalculated: true })];
  expect(ungroupableColumn(fields, NO_AGGREGATION)).toBeNull();
  const g: Aggregation = { aggregations: [{ column: 's', function: 'COUNT' }], dateTrunc: [] };
  expect(ungroupableColumn(fields, g)?.name).toBe('arr');
  expect(ungroupableColumn([fields[0]!], g)).toBeNull();
});

test('the backend IANA pattern and length cap', () => {
  for (const z of ['UTC', 'America/New_York', 'Etc/GMT+5', 'America/Argentina/Buenos_Aires']) expect(isTimeZone(z)).toBe(true);
  for (const z of ['', '1UTC', 'UTC/', "UTC'; DROP", 'a b', '/UTC', 'A'.repeat(65), 'Europe//Kyiv', 7]) expect(isTimeZone(z)).toBe(false);
});

test('formatBucket builds one date formatter per locale', async () => {
  vi.resetModules();
  const fresh = await import('./aggregation');
  const spy = vi.spyOn(Intl, 'DateTimeFormat');
  try {
    fresh.formatBucket('2026-11-02', 'DAY', 'fr-FR');
    fresh.formatBucket('2026-11-09', 'WEEK', 'fr-FR');
    fresh.formatBucket('2026-11-16', 'DAY', 'fr-FR');
    expect(spy.mock.calls.length).toBe(1);
    fresh.formatBucket('2026-11-16', 'DAY', 'de-DE');
    expect(spy.mock.calls.length).toBe(2);
  } finally {
    spy.mockRestore();
  }
});
