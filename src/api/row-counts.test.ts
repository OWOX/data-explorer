import { vi } from 'vitest';
import { countField, countRows, createRowCounter } from './row-counts';
import { stubCtx, traversalOf } from './test-ctx';
import type { Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';

const withPk: Schema = [{ name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true }];
const field = (name: string, category: Schema[number]['category'], type = 'X'): Schema[number] => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const noPk: Schema = [field('day', 'date', 'DATE'), field('amount', 'number', 'INT64'), field('status', 'string', 'STRING')];
const HOUR = 3600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const counting = (n = 1234) => vi.fn(async () => traversalOf([{ day: '2026-01-01' }], 2, n));

test('countField picks the narrowest field by category and skips calculated ones', () => {
  expect(countField([field('j', 'other'), field('status', 'string'), field('amount', 'number'), field('day', 'date'), field('ok', 'boolean')])).toBe('ok');
  expect(countField([field('j', 'other'), field('status', 'string'), field('amount', 'number'), field('day', 'date')])).toBe('day');
  expect(countField([field('j', 'other'), field('status', 'string'), field('amount', 'number')])).toBe('amount');
  expect(countField([field('j', 'other'), field('status', 'string')])).toBe('status');
  expect(countField([field('j', 'other')])).toBe('j');
  expect(countField([{ ...field('ok', 'boolean'), isCalculated: true }, field('day', 'date')])).toBe('day');
  expect(countField([])).toBeNull();
  expect(countField([{ ...field('ok', 'boolean'), isCalculated: true }])).toBeNull();
});

test('countRows reads one row and returns the total, whatever the row holds', async () => {
  const traverseData = counting(1234);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect(await countRows(ctx, 'a', noPk)).toBe(1234);
  expect(traverseData).toHaveBeenCalledWith('a', { column: ['day'], limit: 1, includeTotalRowCount: true });
});

test('countRows sends a filter unchanged', async () => {
  const traverseData = counting(5);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const filter: TraverseFilter[] = [{ column: 'status', operator: 'eq', value: 'x', placement: 'pre-join' }];
  expect(await countRows(ctx, 'a', noPk, filter)).toBe(5);
  expect(traverseData).toHaveBeenCalledWith('a', { column: ['day'], limit: 1, includeTotalRowCount: true, filter });
});

test('countRows is null with no readable field and reads nothing', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect(await countRows(ctx, 'a', [])).toBeNull();
  expect(traverseData).not.toHaveBeenCalled();
});

test('a read with no total is an error and stores nothing', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ day: 'x' }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await expect(countRows(ctx, 'a', noPk)).rejects.toThrow('The row count did not arrive');
  await expect(createRowCounter(ctx).count('a', noPk, null)).rejects.toThrow('The row count did not arrive');
  expect(await ctx.collections('row-counts').get('a')).toBeNull();
});

test('a mart with a key is counted the same way, with no uniqueCount', async () => {
  const traverseData = counting(9);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect(await createRowCounter(ctx).count('a', withPk, null)).toBe(9);
  expect(traverseData).toHaveBeenCalledWith('a', { column: ['id'], limit: 1, includeTotalRowCount: true });
});

test('a count taken after the last update is trusted at any age', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(72 * HOUR) });
  expect(await createRowCounter(ctx).count('a', withPk, ago(80 * HOUR))).toBe(10);
  expect(traverseData).not.toHaveBeenCalled();
});

test('a count older than the last update by over an hour is read again and stored', async () => {
  const traverseData = counting(50);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(2 * HOUR) });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', withPk, ago(HOUR))).toBe(50);
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(await counter.count('a', withPk, ago(HOUR))).toBe(50); // the new count is after the update
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a count under an hour old is kept even when the data updated since', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(HOUR / 2) });
  expect(await createRowCounter(ctx).count('a', withPk, ago(HOUR / 4))).toBe(10);
  expect(traverseData).not.toHaveBeenCalled();
});

test('with no update time a count older than 24 hours is recounted on read', async () => {
  const traverseData = counting(50);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(25 * HOUR) });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', withPk, null)).toBe(50);
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(await counter.count('a', withPk, null)).toBe(50);
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('with no update time a count under 24 hours old is trusted', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(23 * HOUR) });
  expect(await createRowCounter(ctx).count('a', withPk, null)).toBe(10);
  expect(traverseData).not.toHaveBeenCalled();
});

test('recount always reads', async () => {
  const traverseData = counting(43);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(1000) });
  expect(await createRowCounter(ctx).recount('a', withPk)).toBe(43);
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a mart with no readable field counts as null', async () => {
  expect(await createRowCounter(stubCtx()).count('a', [], null)).toBeNull();
});

test('store keeps a count that count() then serves with no read', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  await counter.store('a', 77);
  expect(await counter.count('a', withPk, null)).toBe(77);
  expect(traverseData).not.toHaveBeenCalled();
});
