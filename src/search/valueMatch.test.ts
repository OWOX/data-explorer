// src/search/valueMatch.test.ts
import { describe, expect, it, vi } from 'vitest';
import { SUGGEST_LIMIT } from '../filters/valueSuggest';
import { VALUES_CACHE_LIMIT, forgetAllValues, forgetValues, matchTiers, normalize, readValues, suggestFromSearch } from './valueMatch';
import { stubCtx, traversalOf } from '../api/test-ctx';

describe('normalize', () => {
  it('normalizes', () => expect(normalize('Côte d’Ivoire!')).toBe('cotedivoire'));
});

it('reads the top values of a field, and nothing on failure', async () => {
  const ctx = stubCtx({ dataMarts: { traverseData: async () => traversalOf([{ country: 'DE' }, { country: 'FR' }, { country: null }]) } });
  const field = { name: 'country', alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false };
  expect(await readValues(ctx, 'm', field, new AbortController().signal)).toEqual(['DE', 'FR']);
  const broken = stubCtx({ dataMarts: { traverseData: async () => { throw new Error('x'); } } });
  expect(await readValues(broken, 'm', field, new AbortController().signal)).toEqual([]);
});

it('matchTiers splits the matches by tier', () => {
  expect(matchTiers('us', ['US', 'Usa', 'bus'])).toEqual([['US'], ['US'], ['US', 'Usa']]);
});

describe('kept value reads', () => {
  const field = { name: 'country', alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false };
  const rowsOf = (n: number, blank = 0) => Array.from({ length: n }, (_, i) => ({ country: i < blank ? '  ' : `c${i}` }));
  const ctxOf = (rows: Record<string, unknown>[]) => {
    const read = vi.fn(async () => traversalOf(rows));
    return { read, ctx: stubCtx({ dataMarts: { traverseData: read } }) };
  };
  const signal = () => new AbortController().signal;

  it('reads a column once per mart, and again after forgetValues or forgetAllValues', async () => {
    const { read, ctx } = ctxOf(rowsOf(3));
    await readValues(ctx, 'm', field, signal());
    expect(await readValues(ctx, 'm', field, signal())).toEqual(['c0', 'c1', 'c2']);
    expect(read).toHaveBeenCalledTimes(1);
    await readValues(ctx, 'other', field, signal());
    expect(read).toHaveBeenCalledTimes(2);
    forgetValues(ctx, 'm');
    await readValues(ctx, 'm', field, signal());
    expect(read).toHaveBeenCalledTimes(3);
    await readValues(ctx, 'other', field, signal());
    expect(read).toHaveBeenCalledTimes(3);
    forgetAllValues(ctx);
    await readValues(ctx, 'other', field, signal());
    expect(read).toHaveBeenCalledTimes(4);
  });

  it('keeps nothing from a failed or aborted read', async () => {
    let fail = true;
    const read = vi.fn(async () => { if (fail) throw new Error('x'); return traversalOf(rowsOf(2)); });
    const ctx = stubCtx({ dataMarts: { traverseData: read } });
    expect(await readValues(ctx, 'm', field, signal())).toEqual([]);
    fail = false;
    const ac = new AbortController();
    const p = readValues(ctx, 'm', field, ac.signal);
    ac.abort();
    await p;
    expect(read).toHaveBeenCalledTimes(2);
    expect(await readValues(ctx, 'm', field, signal())).toEqual(['c0', 'c1']);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it('keeps the last 64 columns', async () => {
    const { read, ctx } = ctxOf(rowsOf(1));
    for (let i = 0; i <= VALUES_CACHE_LIMIT; i++) await readValues(ctx, `m${i}`, field, signal());
    await readValues(ctx, 'm1', field, signal());
    expect(read).toHaveBeenCalledTimes(VALUES_CACHE_LIMIT + 1);
    await readValues(ctx, 'm0', field, signal());
    expect(read).toHaveBeenCalledTimes(VALUES_CACHE_LIMIT + 2);
  });

  it('suggests the non-blank values of a complete read, and of a full one that holds 50', async () => {
    const small = ctxOf(rowsOf(12, 2));
    expect(suggestFromSearch(small.ctx, 'm', field)).toBeNull();
    await readValues(small.ctx, 'm', field, signal());
    expect(suggestFromSearch(small.ctx, 'm', field)).toEqual(Array.from({ length: 10 }, (_, i) => `c${i + 2}`));
    const full = ctxOf(rowsOf(200, 5));
    await readValues(full.ctx, 'm', field, signal());
    const got = suggestFromSearch(full.ctx, 'm', field);
    expect(got).toEqual(Array.from({ length: SUGGEST_LIMIT }, (_, i) => `c${i + 5}`));
    expect(got).toHaveLength(SUGGEST_LIMIT);
    expect(got![SUGGEST_LIMIT - 1]).toBe(`c${SUGGEST_LIMIT + 4}`);
  });

  it('suggests nothing from a full read with fewer than 50 non-blank values', async () => {
    const { ctx } = ctxOf(rowsOf(200, 160));
    await readValues(ctx, 'm', field, signal());
    expect(suggestFromSearch(ctx, 'm', field)).toBeNull();
  });

  it('stores nothing from a read that was in flight when the mart or every mart was forgotten', async () => {
    for (const forget of [(c: ReturnType<typeof stubCtx>) => forgetValues(c, 'm'), (c: ReturnType<typeof stubCtx>) => forgetAllValues(c)]) {
      let release!: () => void;
      const read = vi.fn(async () => { await new Promise<void>((r) => { release = r; }); return traversalOf(rowsOf(3)); });
      const ctx = stubCtx({ dataMarts: { traverseData: read } });
      const pending = readValues(ctx, 'm', field, signal());
      await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(1));
      forget(ctx);
      release();
      expect(await pending).toEqual(['c0', 'c1', 'c2']);
      expect(suggestFromSearch(ctx, 'm', field)).toBeNull();
      release = () => {};
      read.mockImplementation(async () => traversalOf(rowsOf(3)));
      await readValues(ctx, 'm', field, signal());
      expect(read).toHaveBeenCalledTimes(2);
    }
  });
});
