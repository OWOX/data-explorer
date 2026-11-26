import { vi } from 'vitest';
import { countOptions, createRowCounter } from './row-counts';
import { stubCtx, traversalOf } from './test-ctx';
import type { Schema } from '../model/types';

const withPk: Schema = [{ name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true }];
const field = (name: string, category: Schema[number]['category'], type = 'X'): Schema[number] => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const noPk: Schema = [field('day', 'date', 'DATE'), field('amount', 'number', 'INT64'), field('status', 'string', 'STRING')];

test('countOptions uses uniqueCount with a primary key and COUNT otherwise', () => {
  expect(countOptions(withPk)).toEqual({ options: { uniqueCount: [''] }, key: 'Unique Count' });
  // COUNT is allowed on string, boolean and other fields only, so the date and number fields are skipped.
  expect(countOptions(noPk)).toEqual({ options: { column: ['status'], aggregation: [{ column: 'status', function: 'COUNT' }] }, key: 'status | COUNT' });
  expect(countOptions([field('ok', 'boolean')])?.key).toBe('ok | COUNT');
  expect(countOptions([field('j', 'other')])?.key).toBe('j | COUNT');
  expect(countOptions([])).toBeNull();
});

test('a hidden primary key still counts by Unique Count, which the backend computes from the key as declared', () => {
  const hidden: Schema = Object.assign([field('status', 'string', 'STRING')], { primaryKey: ['id'] });
  expect(countOptions(hidden)).toEqual({ options: { uniqueCount: [''] }, key: 'Unique Count' });
});

test('a composite key with a disconnected component is no key: the visible component alone does not send a Unique Count', () => {
  const part: Schema = Object.assign([{ ...withPk[0]! }], { primaryKey: [] as string[] });
  expect(countOptions(part)).toBeNull();
});

test('a mart with only number, date and time fields and no key has no count', async () => {
  const only = [field('day', 'date', 'DATE'), field('amount', 'number'), field('t', 'time')];
  expect(countOptions(only)).toBeNull();
  const traverseData = vi.fn();
  expect(await createRowCounter(stubCtx({ dataMarts: { list: vi.fn(), traverseData } })).count('a', only)).toBeNull();
  expect(traverseData).not.toHaveBeenCalled();
});

test('a cached count older than 24 hours is recounted on read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 50 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const old = new Date(Date.now() - 25 * 3600_000).toISOString();
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: old });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', withPk)).toBe(50);
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(await counter.count('a', withPk)).toBe(50); // the fresh write is trusted
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a cached count under 24 hours old is trusted', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: new Date(Date.now() - 23 * 3600_000).toISOString() });
  expect(await createRowCounter(ctx).count('a', withPk)).toBe(10);
  expect(traverseData).not.toHaveBeenCalled();
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

test('store keeps a count that count() then serves with no read', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  await counter.store('a', 77);
  expect(await counter.count('a', withPk)).toBe(77);
  expect(traverseData).not.toHaveBeenCalled();
});
