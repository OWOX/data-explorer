import { describe, expect, test, vi } from 'vitest';
import type { Mart, Model } from '../model/types';
import type { Ctx } from '../sdk/types';
import { MAX_QUERY, MIN_QUERY, MAX_FOUND, queryProblem, searchEndpoint } from './endpoint';

const mart = (id: string, accessible = true): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible, sourceKey: null });
const model = (...marts: Mart[]): Model => ({ marts: new Map(marts.map((m) => [m.id, m])), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] });
const hit = (entityId: string, finalScore: number, entityType = 'DATA_MART') => ({ entityType, entityId, title: entityId, description: null, finalScore });
const ctxReturning = (value: unknown) => {
  const getJson = vi.fn(async () => value);
  return { ctx: { owox: { getJson } } as unknown as Ctx, getJson };
};

describe('queryProblem', () => {
  test('the backend takes 2 to 256 characters of the trimmed query', () => {
    expect([MIN_QUERY, MAX_QUERY]).toEqual([2, 256]);
    expect(queryProblem('a')).not.toBeNull();
    expect(queryProblem('  a  ')).not.toBeNull();
    expect(queryProblem('ab')).toBeNull();
    expect(queryProblem('x'.repeat(256))).toBeNull();
    expect(queryProblem('x'.repeat(257))).not.toBeNull();
  });
});

describe('searchEndpoint', () => {
  test('asks the search engine for published data marts, five at most, with the trimmed query', async () => {
    const { ctx, getJson } = ctxReturning([]);
    await searchEndpoint(ctx, '  orders by month ', model());
    expect(getJson).toHaveBeenCalledWith('/api/search', { q: 'orders by month', entityTypes: 'DATA_MART', excludeDrafts: 'true', limit: '5' });
  });

  test('ranks by score, keeps only marts the member can open in the model, drops repeats and other entity types, and caps at five', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { ctx } = ctxReturning([
      hit('a', 10), hit('gone', 99), hit('b', 40), hit('locked', 80), hit('c', 40), hit('b', 90, 'DATA_MART'), hit('rep', 70, 'REPORT'),
      hit('d', 30), hit('e', 20), hit('f', 15), hit('g', 1),
    ]);
    const found = await searchEndpoint(ctx, 'q1', model(...ids.map((i) => mart(i)), mart('locked', false)));
    // b scores 90 on its second line: the best score of an id counts; ties keep the engine's order
    expect(found).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(found).toHaveLength(MAX_FOUND);
  });

  test('items with no usable id or score are skipped, not fatal', async () => {
    const { ctx } = ctxReturning([{ entityType: 'DATA_MART' }, null, 'x', { entityType: 'DATA_MART', entityId: 'a' }, hit('b', 5)]);
    expect(await searchEndpoint(ctx, 'ab', model(mart('a'), mart('b')))).toEqual(['b', 'a']);
  });

  test('an answer that is not a list, a failure, and a query the backend would refuse all find nothing', async () => {
    expect(await searchEndpoint(ctxReturning({ message: 'no' }).ctx, 'ab', model(mart('a')))).toEqual([]);
    const failing = { owox: { getJson: vi.fn(async () => { throw new Error('500'); }) } } as unknown as Ctx;
    expect(await searchEndpoint(failing, 'ab', model(mart('a')))).toEqual([]);
    const { ctx, getJson } = ctxReturning([hit('a', 1)]);
    expect(await searchEndpoint(ctx, 'a', model(mart('a')))).toEqual([]);
    expect(getJson).not.toHaveBeenCalled();
  });

  test('a query cancelled while the request is out finds nothing', async () => {
    const ctl = new AbortController();
    const ctx = { owox: { getJson: vi.fn(async () => { ctl.abort(); return [hit('a', 1)]; }) } } as unknown as Ctx;
    expect(await searchEndpoint(ctx, 'ab', model(mart('a')), ctl.signal)).toEqual([]);
  });
});
