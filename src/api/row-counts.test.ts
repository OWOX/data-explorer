import { vi } from 'vitest';
import { countOptions, createRowCounter } from './row-counts';
import { stubCtx, traversalOf } from './test-ctx';
import type { Schema } from '../model/types';

const withPk: Schema = [{ name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true }];
const noPk: Schema = [{ name: 'day', alias: null, type: 'DATE', category: 'date', description: null, isPrimaryKey: false }];

test('countOptions uses uniqueCount with a primary key and COUNT otherwise', () => {
  expect(countOptions(withPk)).toEqual({ options: { uniqueCount: [''] }, key: 'Unique Count' });
  expect(countOptions(noPk)).toEqual({ options: { column: ['day'], aggregation: [{ column: 'day', function: 'COUNT' }] }, key: 'day | COUNT' });
  expect(countOptions([])).toBeNull();
});

test('count() reads the cache first and recount() bypasses it', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 42 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', withPk)).toBe(42);
  expect(await counter.count('a', withPk)).toBe(42);
  expect(traverseData).toHaveBeenCalledTimes(1);
  traverseData.mockResolvedValueOnce(traversalOf([{ 'Unique Count': '43' }]));
  expect(await counter.recount('a', withPk)).toBe(43);
});

test('a mart with no readable fields counts as null', async () => {
  expect(await createRowCounter(stubCtx()).count('a', [])).toBeNull();
});
