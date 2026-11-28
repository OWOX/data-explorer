import { vi } from 'vitest';
import { FILTERED_COUNT_LIMIT } from '../config';
import type { Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { cachedFiltered, countFiltered, filteredKey, forgetFiltered, rememberFiltered } from './filtered-counts';
import { stubCtx, traversalOf } from './test-ctx';

const schema = [{ name: 'id', category: 'number' }] as unknown as Schema;
const rules: TraverseFilter[] = [{ column: 'id', operator: 'gt', value: 1 } as TraverseFilter];
const relative: TraverseFilter[] = [{ column: 'day', operator: 'relative_date', value: 'last_7_days' } as unknown as TraverseFilter];

function setup(total?: number | null) {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, total === null ? undefined : (total ?? 5)));
  return { ctx: stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), traverseData };
}

test('reads once with the rules as filter and serves the second call from the cache', async () => {
  const { ctx, traverseData } = setup();
  const key = filteredKey('a', rules, null);
  expect(await countFiltered(ctx, key, 'a', schema, rules)).toEqual({ value: 5, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(traverseData).toHaveBeenCalledWith('a', expect.objectContaining({ filter: rules, limit: 1, includeTotalRowCount: true }));
  expect(await countFiltered(ctx, key, 'a', schema, rules)).toEqual({ value: 5, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('two concurrent calls with the same key send one read', async () => {
  const { ctx, traverseData } = setup();
  const key = filteredKey('a', rules, null);
  const [x, y] = await Promise.all([countFiltered(ctx, key, 'a', schema, rules), countFiltered(ctx, key, 'a', schema, rules)]);
  expect([x, y]).toEqual([{ value: 5, unique: false }, { value: 5, unique: false }]);
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a read that throws is not cached', async () => {
  const { ctx, traverseData } = setup(null);
  const key = filteredKey('a', rules, null);
  await expect(countFiltered(ctx, key, 'a', schema, rules)).rejects.toThrow();
  await expect(countFiltered(ctx, key, 'a', schema, rules)).rejects.toThrow();
  expect(traverseData).toHaveBeenCalledTimes(2);
});

test('the key follows the update time, the rule order, and the day only for relative dates', () => {
  expect(filteredKey('a', rules, 't1')).not.toBe(filteredKey('a', rules, 't2'));
  expect(filteredKey('a', rules, 't1')).toBe(filteredKey('a', [...rules], 't1'));
  const before = new Date(2026, 10, 27, 23, 59);
  const after = new Date(2026, 10, 28, 0, 1);
  expect(filteredKey('a', relative, null, before)).not.toBe(filteredKey('a', relative, null, after));
  expect(filteredKey('a', rules, null, before)).toBe(filteredKey('a', rules, null, after));
});

test('a remembered count is served without a read', async () => {
  const { ctx, traverseData } = setup();
  const key = filteredKey('a', rules, null);
  rememberFiltered(ctx, key, 42, false);
  expect(await countFiltered(ctx, key, 'a', schema, rules)).toEqual({ value: 42, unique: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('forgetting a mart drops its entries and keeps the others', () => {
  const { ctx } = setup();
  const ka = filteredKey('a', rules, null);
  const kb = filteredKey('b', rules, null);
  rememberFiltered(ctx, ka, 1, false);
  rememberFiltered(ctx, kb, 2, true);
  forgetFiltered(ctx, 'a');
  expect(cachedFiltered(ctx, ka)).toBeUndefined();
  expect(cachedFiltered(ctx, kb)).toEqual({ n: 2, unique: true });
});

test('the least recently used entry goes out first', () => {
  const { ctx } = setup();
  const keys = Array.from({ length: FILTERED_COUNT_LIMIT + 1 }, (_, i) => filteredKey(`m${i}`, rules, null));
  keys.slice(0, FILTERED_COUNT_LIMIT).forEach((k, i) => rememberFiltered(ctx, k, i, false));
  expect(cachedFiltered(ctx, keys[0]!)).toEqual({ n: 0, unique: false }); // touched, so m1 is now the oldest
  rememberFiltered(ctx, keys[FILTERED_COUNT_LIMIT]!, 99, false);
  expect(cachedFiltered(ctx, keys[1]!)).toBeUndefined();
  expect(cachedFiltered(ctx, keys[0]!)).toEqual({ n: 0, unique: false });
  expect(cachedFiltered(ctx, keys[FILTERED_COUNT_LIMIT]!)).toEqual({ n: 99, unique: false });
});

test('a read under way when its mart is forgotten is neither cached nor joined', async () => {
  let release: () => void = () => {};
  const traverseData = vi.fn(async () => { await new Promise<void>((r) => { release = r; }); return traversalOf([{ id: 1 }], 2, 5); });
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const key = filteredKey('a', rules, null);
  const first = countFiltered(ctx, key, 'a', schema, rules);
  await vi.waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  forgetFiltered(ctx, 'a');
  release();
  await first;
  expect(cachedFiltered(ctx, key)).toBeUndefined();
  const second = countFiltered(ctx, key, 'a', schema, rules);
  await vi.waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  release();
  expect(await second).toEqual({ value: 5, unique: false });
});

const keyed = [{ name: 'id', category: 'number', isPrimaryKey: true }] as unknown as Schema;

test('a mart with a key is counted by unique records, with the rules as filter and no total row count', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const key = filteredKey('a', rules, null);
  expect(await countFiltered(ctx, key, 'a', keyed, rules)).toEqual({ value: 7, unique: true });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(traverseData).toHaveBeenCalledWith('a', { uniqueCount: [''], filter: rules });
  expect(cachedFiltered(ctx, key)).toEqual({ n: 7, unique: true });
  expect(await countFiltered(ctx, key, 'a', keyed, rules)).toEqual({ value: 7, unique: true });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a unique count that is not a number is an error and is not cached', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 'abc' }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const key = filteredKey('a', rules, null);
  await expect(countFiltered(ctx, key, 'a', keyed, rules)).rejects.toThrow();
  expect(cachedFiltered(ctx, key)).toBeUndefined();
});

test('a cached entry made the other way is not served: it is read again and replaced', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const key = filteredKey('a', rules, null);
  rememberFiltered(ctx, key, 42, false);
  expect(await countFiltered(ctx, key, 'a', keyed, rules)).toEqual({ value: 7, unique: true });
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(cachedFiltered(ctx, key)).toEqual({ n: 7, unique: true });
});

test('a unique count that arrives as a numeric string is a number', async () => {
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData: vi.fn(async () => traversalOf([{ 'Unique Count': '7' }])) } });
  expect(await countFiltered(ctx, filteredKey('a', rules, null), 'a', keyed, rules)).toEqual({ value: 7, unique: true });
});
