import { vi } from 'vitest';
import { countField, countMart, countRows, createRowCounter } from './row-counts';
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

const uniqueOf = (n: unknown) => vi.fn(async () => traversalOf([{ 'Unique Count': n }]));

test('a mart with a key is counted by Unique Count only, with no row read and no total', async () => {
  const traverseData = uniqueOf(9);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect(await createRowCounter(ctx).count('a', withPk, null)).toEqual({ value: 9, unique: true });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(traverseData).toHaveBeenCalledWith('a', { uniqueCount: [''] });
  expect((await ctx.collections('row-counts').get('a'))?.document).toMatchObject({ count: 9, unique: true });
});

test('a mart with a hidden composite key is counted by Unique Count too', async () => {
  const traverseData = uniqueOf(3);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const composite = Object.assign([field('day', 'date')], { primaryKey: ['a', 'b'] }) as Schema;
  expect(await countMart(ctx, 'a', composite)).toEqual({ value: 3, unique: true });
});

test('countMart sends the filter with the unique count', async () => {
  const traverseData = uniqueOf(4);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const filter: TraverseFilter[] = [{ column: 'status', operator: 'eq', value: 'x', placement: 'pre-join' }];
  expect(await countMart(ctx, 'a', withPk, filter)).toEqual({ value: 4, unique: true });
  expect(traverseData).toHaveBeenCalledWith('a', { uniqueCount: [''], filter });
});

test('a Unique Count a reader returns as a numeric string is a number', async () => {
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData: uniqueOf('5') } });
  expect(await countMart(ctx, 'a', withPk)).toEqual({ value: 5, unique: true });
});

test('a Unique Count that is not a number is an error, never 0, and stores nothing', async () => {
  for (const bad of ['abc', '', '  ', null, undefined, Number.NaN]) {
    const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData: uniqueOf(bad) } });
    await expect(countMart(ctx, 'a', withPk)).rejects.toThrow();
    await expect(createRowCounter(ctx).count('a', withPk, null)).rejects.toThrow();
    expect(await ctx.collections('row-counts').get('a')).toBeNull();
  }
  const empty = stubCtx({ dataMarts: { list: vi.fn(), traverseData: vi.fn(async () => traversalOf([])) } });
  await expect(countMart(empty, 'a', withPk)).rejects.toThrow();
});

test('a mart with no key is counted by rows, two queries in one read', async () => {
  const traverseData = counting(9);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect(await createRowCounter(ctx).count('a', noPk, null)).toEqual({ value: 9, unique: false });
  expect(traverseData).toHaveBeenCalledWith('a', { column: ['day'], limit: 1, includeTotalRowCount: true });
  expect((await ctx.collections('row-counts').get('a'))?.document).toMatchObject({ count: 9, unique: false });
});

test('a cached count with another unique flag, or none, is read again', async () => {
  const hit = (doc: object) => async () => {
    const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData: uniqueOf(8) } });
    await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(1000), ...doc });
    return { ctx, got: await createRowCounter(ctx).count('a', withPk, null) };
  };
  for (const doc of [{ unique: false }, {}]) {
    const { ctx, got } = await hit(doc)();
    expect(got).toEqual({ value: 8, unique: true });
    expect(ctx.owox.dataMarts.traverseData).toHaveBeenCalledTimes(1);
  }
  const trusted = await hit({ unique: true })();
  expect(trusted.got).toEqual({ value: 10, unique: true });
  expect(trusted.ctx.owox.dataMarts.traverseData).not.toHaveBeenCalled();
  // a mart that lost its key: a unique count is not its count
  const traverseData = counting(6);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(1000), unique: true });
  expect(await createRowCounter(ctx).count('a', noPk, null)).toEqual({ value: 6, unique: false });
});

test('a count taken after the last update is trusted at any age', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(72 * HOUR), unique: false });
  expect(await createRowCounter(ctx).count('a', noPk, ago(80 * HOUR))).toEqual({ value: 10, unique: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('a count older than the last update by over an hour is read again and stored', async () => {
  const traverseData = counting(50);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(2 * HOUR), unique: false });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', noPk, ago(HOUR))).toEqual({ value: 50, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(await counter.count('a', noPk, ago(HOUR))).toEqual({ value: 50, unique: false }); // the new count is after the update
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a count under an hour old is kept even when the data updated since', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(HOUR / 2), unique: false });
  expect(await createRowCounter(ctx).count('a', noPk, ago(HOUR / 4))).toEqual({ value: 10, unique: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('with no update time a count older than 24 hours is recounted on read', async () => {
  const traverseData = counting(50);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(25 * HOUR), unique: false });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', noPk, null)).toEqual({ value: 50, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(await counter.count('a', noPk, null)).toEqual({ value: 50, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('with no update time a count under 24 hours old is trusted', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(23 * HOUR), unique: false });
  expect(await createRowCounter(ctx).count('a', noPk, null)).toEqual({ value: 10, unique: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('recount always reads', async () => {
  const traverseData = counting(43);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  await ctx.collections('row-counts').put('a', { dataMartId: 'a', count: 10, at: ago(1000), unique: false });
  expect(await createRowCounter(ctx).recount('a', noPk)).toEqual({ value: 43, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a mart with no readable field counts as null', async () => {
  expect(await createRowCounter(stubCtx()).count('a', [], null)).toEqual({ value: null, unique: false });
});

test('store keeps a count that count() then serves with no read', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  await counter.store('a', 77, false);
  expect(await counter.count('a', noPk, null)).toEqual({ value: 77, unique: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('store keeps the flag with the count, and a count of the other kind is not served', async () => {
  const traverseData = counting(6);
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  await counter.store('a', 5, true);
  expect(await counter.count('a', withPk, null)).toEqual({ value: 5, unique: true });
  expect(traverseData).not.toHaveBeenCalled();
  expect(await counter.count('a', noPk, null)).toEqual({ value: 6, unique: false });
});
