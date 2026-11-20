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
    // the box takes one character (a title match); the endpoint is only asked from two
    expect(queryProblem('   ')).not.toBeNull();
    expect(queryProblem('a')).toBeNull();
    expect(queryProblem('ab')).toBeNull();
    expect(queryProblem('x'.repeat(256))).toBeNull();
    expect(queryProblem('x'.repeat(257))).not.toBeNull();
  });
});

const rhit = (entityId: string, finalScore: number, martId = 'a', title: string | undefined = entityId) => ({
  entityType: 'REPORT', entityId, ...(title === undefined ? {} : { title }), description: null, finalScore, report: { dataMart: { id: martId, title: martId } },
});
const EMPTY = { reports: [], marts: [] };

describe('searchEndpoint', () => {
  test('asks the search engine for data marts and reports, twenty at most, with the trimmed query', async () => {
    const { ctx, getJson } = ctxReturning([]);
    await searchEndpoint(ctx, '  orders by month ', model());
    expect(getJson).toHaveBeenCalledWith('/api/search', { q: 'orders by month', entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: '20' });
  });

  test('splits marts and reports, ranks each by score, drops repeats and marts the member cannot open, and caps each at five', async () => {
    const ids = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    const { ctx } = ctxReturning([
      hit('a', 10), hit('gone', 99), hit('b', 40), hit('locked', 80), hit('c', 40), hit('b', 90), rhit('r1', 5), rhit('r2', 50), rhit('r3', 50),
      rhit('r4', 4), rhit('r5', 3), rhit('r6', 2), rhit('r7', 1), rhit('r2', 60, 'b'), rhit('rl', 99, 'locked'), rhit('rg', 99, 'gone'),
      hit('d', 30), hit('e', 20), hit('f', 15), hit('g', 1),
    ]);
    const found = await searchEndpoint(ctx, 'q1', model(...ids.map((i) => mart(i)), mart('locked', false)));
    // b scores 90 on its second line: the best score of an id counts; ties keep the engine's order
    expect(found.marts).toEqual(['b', 'c', 'd', 'e', 'f']);
    expect(found.marts).toHaveLength(MAX_FOUND);
    expect(found.reports).toEqual([
      { id: 'r2', title: 'r2', martId: 'b' }, { id: 'r3', title: 'r3', martId: 'a' }, { id: 'r1', title: 'r1', martId: 'a' },
      { id: 'r4', title: 'r4', martId: 'a' }, { id: 'r5', title: 'r5', martId: 'a' },
    ]);
  });

  test('a report needs a string id and a mart; a missing title falls back to the id', async () => {
    const { ctx } = ctxReturning([
      { entityType: 'REPORT', finalScore: 9, report: { dataMart: { id: 'a' } } },
      { entityType: 'REPORT', entityId: 'nomart', finalScore: 9 },
      { entityType: 'REPORT', entityId: 'badmart', finalScore: 9, report: { dataMart: { id: 7 } } },
      rhit('untitled', 5, 'a', undefined),
      { entityType: 'REPORT', entityId: 'num', title: 3, finalScore: 4, report: { dataMart: { id: 'a' } } },
    ]);
    expect((await searchEndpoint(ctx, 'ab', model(mart('a')))).reports).toEqual([
      { id: 'untitled', title: 'untitled', martId: 'a' }, { id: 'num', title: 'num', martId: 'a' },
    ]);
  });

  test('other entity types are ignored and an item with no type counts as a mart', async () => {
    const { ctx } = ctxReturning([hit('s', 9, 'DATA_STORAGE'), { entityId: 'a', finalScore: 3 }, hit('b', 5)]);
    expect(await searchEndpoint(ctx, 'ab', model(mart('a'), mart('b'), mart('s')))).toEqual({ reports: [], marts: ['b', 'a'] });
  });

  test('items with no usable id or score are skipped, not fatal', async () => {
    const { ctx } = ctxReturning([{ entityType: 'DATA_MART' }, null, 'x', { entityType: 'DATA_MART', entityId: 'a' }, hit('b', 5)]);
    expect((await searchEndpoint(ctx, 'ab', model(mart('a'), mart('b')))).marts).toEqual(['b', 'a']);
  });

  test('an answer that is not a list, a failure, and a query the backend would refuse all find nothing', async () => {
    expect(await searchEndpoint(ctxReturning({ message: 'no' }).ctx, 'ab', model(mart('a')))).toEqual(EMPTY);
    const failing = { owox: { getJson: vi.fn(async () => { throw new Error('500'); }) } } as unknown as Ctx;
    expect(await searchEndpoint(failing, 'ab', model(mart('a')))).toEqual(EMPTY);
    const { ctx, getJson } = ctxReturning([hit('a', 1)]);
    expect(await searchEndpoint(ctx, ' a ', model(mart('a')))).toEqual(EMPTY);
    expect(getJson).not.toHaveBeenCalled();
  });

  test('a query cancelled while the request is out finds nothing', async () => {
    const ctl = new AbortController();
    const ctx = { owox: { getJson: vi.fn(async () => { ctl.abort(); return [hit('a', 1)]; }) } } as unknown as Ctx;
    expect(await searchEndpoint(ctx, 'ab', model(mart('a')), ctl.signal)).toEqual(EMPTY);
  });
});
