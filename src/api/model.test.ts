import { describe, vi } from 'vitest';
import { loadModel } from './model';
import { stubCtx } from './test-ctx';

test('loadModel merges storages, canvas nodes, list contexts, edges and contexts', async () => {
  const getJson = vi.fn(async (path: string, query?: Record<string, string>) => {
    if (path === '/api/contexts') return [{ id: 'c1', name: 'Sales', description: null, icon: 'revenue' }];
    if (path === '/api/model-canvas/data-marts' && query?.storageId === 's1') {
      if (!query.offset) return { items: [{ id: 'a', title: 'Orders', description: 'd', icon: 'orders', fieldCount: 3, status: 'PUBLISHED', dataLastUpdated: { dataLastUpdatedAt: '2026-11-01T00:00:00Z', computedAt: 'x' } }], total: 2, nextOffset: 1 };
      return { items: [{ id: 'b', title: 'Customers', description: null, fieldCount: 2 }], total: 2, nextOffset: null };
    }
    throw new Error(`unexpected ${path}`);
  });
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'GOOGLE_BIGQUERY' }] },
    models: { getEdges: async () => [{ id: 'e1', sourceDataMartId: 'a', targetDataMartId: 'b', joinConditions: [{ sourceFieldName: 'customer_id', targetFieldName: 'id' }] }] },
    dataMarts: {
      list: async () => [{ id: 'a', title: 'Orders', description: 'd', contexts: [{ id: 'c1', name: 'Sales' }], availableForReporting: true }],
      traverseData: vi.fn(),
    },
    getJson,
  });

  const model = await loadModel(ctx);

  expect([...model.marts.keys()]).toEqual(['a', 'b']);
  expect(model.marts.get('a')).toEqual({ id: 'a', title: 'Orders', description: 'd', icon: 'orders', storageId: 's1', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-01T00:00:00Z', accessible: true, sourceKey: null });
  expect(model.marts.get('b')!.accessible).toBe(false); // not in the member's list
  expect(model.edges).toEqual([{ id: 'e1', source: 'a', target: 'b', joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]);
  expect(model.contexts).toEqual([{ id: 'c1', name: 'Sales', icon: 'revenue' }]);
  expect(model.storages).toEqual([{ id: 's1', title: 'BQ', type: 'GOOGLE_BIGQUERY' }]);
});

test('loadModel drops edges whose ends are unknown', async () => {
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    models: { getEdges: async () => [{ id: 'e1', sourceDataMartId: 'a', targetDataMartId: 'zzz', joinConditions: [] }] },
    getJson: async (path: string) => ((path === '/api/contexts' || path === '/api/connectors') ? [] : { items: [{ id: 'a', title: 'A', description: null, fieldCount: 0 }], total: 1, nextOffset: null }),
  });
  expect((await loadModel(ctx)).edges).toEqual([]);
});

test('a mart is accessible when listed and PUBLISHED, whatever its sharing flag says', async () => {
  const canvas = { items: [
    { id: 'pub', title: 'P', description: null, fieldCount: 1, status: 'PUBLISHED' },
    { id: 'draft', title: 'D', description: null, fieldCount: 1, status: 'DRAFT' },
    { id: 'off', title: 'O', description: null, fieldCount: 1, status: 'PUBLISHED' },
    { id: 'hidden', title: 'H', description: null, fieldCount: 1, status: 'PUBLISHED' },
  ], total: 4, nextOffset: null };
  const entry = (id: string, availableForReporting: boolean) => ({ id, title: id, description: null, contexts: [], availableForReporting });
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    dataMarts: { list: async () => [entry('pub', true), entry('draft', true), entry('off', false)], traverseData: vi.fn() },
    getJson: async (path: string) => ((path === '/api/contexts' || path === '/api/connectors') ? [] : canvas),
  });
  const { marts } = await loadModel(ctx);
  expect(['pub', 'draft', 'off', 'hidden'].map((id) => marts.get(id)!.accessible)).toEqual([true, false, true, false]);
});

const canvasOf = (id: string) => ({ items: [{ id, title: id, description: null, fieldCount: 1, status: 'PUBLISHED' }], total: 1, nextOffset: null });
const twoStorageCtx = (failing: string[]) => stubCtx({
  storages: { list: async () => [{ id: 's1', title: 'One', type: 'X' }, { id: 's2', title: 'Two', type: 'X' }] },
  models: { getEdges: async (sid: string) => { if (failing.includes(sid)) throw new Error(`${sid} down`); return []; } },
  dataMarts: { list: async () => [], traverseData: vi.fn() },
  getJson: async (path: string, query?: Record<string, string>) => ((path === '/api/contexts' || path === '/api/connectors') ? [] : canvasOf(query!.storageId === 's1' ? 'a' : 'b')),
});

test('a failing storage is reported while the others still load', async () => {
  const model = await loadModel(twoStorageCtx(['s2']));
  expect([...model.marts.keys()]).toEqual(['a']);
  expect(model.failedStorages).toEqual([{ id: 's2', title: 'Two', message: 's2 down' }]);
});

test('the load fails only when every storage fails', async () => {
  await expect(loadModel(twoStorageCtx(['s1', 's2']))).rejects.toThrow(/down/);
});

test('storages load through a pool of at most 6', async () => {
  let running = 0;
  let peak = 0;
  const ids = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const ctx = stubCtx({
    storages: { list: async () => ids.map((id) => ({ id, title: id, type: 'X' })) },
    models: { getEdges: async () => { running++; peak = Math.max(peak, running); await new Promise((r) => setTimeout(r, 5)); running--; return []; } },
    dataMarts: { list: async () => [], traverseData: vi.fn() },
    getJson: async (path: string, query?: Record<string, string>) => ((path === '/api/contexts' || path === '/api/connectors') ? [] : canvasOf(query!.storageId!)),
  });
  const model = await loadModel(ctx);
  expect(model.marts.size).toBe(10);
  expect(peak).toBeLessThanOrEqual(6);
});

test('sources come from connector marts; a failing /api/connectors falls back to raw keys', async () => {
  const entry = (id: string, definitionType: string, connectorSourceName: string | null) => ({ id, title: id, description: null, contexts: [], availableForReporting: true, definitionType, connectorSourceName });
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    dataMarts: { list: async () => [entry('a', 'CONNECTOR', 'Shopify'), entry('b', 'SQL', null)], traverseData: vi.fn() },
    getJson: async (path: string) => {
      if (path === '/api/connectors') throw new Error('boom');
      if (path === '/api/contexts') return [];
      return { items: [{ id: 'a', title: 'a', description: null, fieldCount: 1, status: 'PUBLISHED' }, { id: 'b', title: 'b', description: null, fieldCount: 1, status: 'PUBLISHED' }], total: 2, nextOffset: null };
    },
  });
  const model = await loadModel(ctx);
  expect(model.marts.get('a')!.sourceKey).toBe('Shopify');
  expect(model.marts.get('b')!.sourceKey).toBeNull();
  expect(model.sources).toEqual([{ key: 'Shopify', name: 'Shopify', logo: null, martIds: ['a'] }]);
});

test('a connector title from /api/connectors reaches model.sources', async () => {
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    dataMarts: { list: async () => [{ id: 'a', title: 'a', description: null, contexts: [], availableForReporting: true, definitionType: 'CONNECTOR', connectorSourceName: 'GoogleAnalytics4' }], traverseData: vi.fn() },
    getJson: async (path: string) => {
      if (path === '/api/connectors') return [{ name: 'GoogleAnalytics4', title: 'Google Analytics 4' }];
      if (path === '/api/contexts') return [];
      return canvasOf('a');
    },
  });
  expect((await loadModel(ctx)).sources).toEqual([{ key: 'GoogleAnalytics4', name: 'Google Analytics 4', logo: null, martIds: ['a'] }]);
});

test('a failed storage stays in model.storages beside failedStorages', async () => {
  const model = await loadModel(twoStorageCtx(['s2']));
  expect(model.storages.map((s) => s.id)).toEqual(['s1', 's2']);
});

test('loadModel reports each step it finishes, the total growing by two per storage once they are known', async () => {
  const canvas = { items: [{ id: 'a', title: 'A', description: null, fieldCount: 0, status: 'PUBLISHED' }], total: 1, nextOffset: null };
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'One', type: 'X' }, { id: 's2', title: 'Two', type: 'X' }] },
    models: { getEdges: async () => [] },
    getJson: async (path: string) => ((path === '/api/contexts' || path === '/api/connectors') ? [] : canvas),
  });
  const seen: { done: number; total: number }[] = [];
  await loadModel(ctx, (p) => seen.push(p));
  const last = seen.at(-1)!;
  expect(last).toEqual({ done: 8, total: 8 }); // storages, marts, contexts, connectors, then a canvas read and an edge read per storage
  expect(seen.every((p, i) => i === 0 || p.done === seen[i - 1]!.done + 1)).toBe(true);
  expect(seen.every((p) => p.done <= p.total)).toBe(true);
});

describe('custom connectors', () => {
  const entry = (id: string, name: string | null) => ({ id, title: id, description: null, contexts: [], availableForReporting: true, definitionType: name ? 'CONNECTOR' : 'SQL', connectorSourceName: name });
  const canvas = (ids: string[]) => ({ items: ids.map((id) => ({ id, title: id, description: null, fieldCount: 1, status: 'PUBLISHED' })), total: ids.length, nextOffset: null });
  const run = (names: [string, string | null][], handlers: { bundled?: () => unknown; summaries?: (q?: Record<string, string>) => unknown }) => {
    const summaries = vi.fn(async (q?: Record<string, string>) => handlers.summaries!(q));
    const ctx = stubCtx({
      storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
      dataMarts: { list: async () => names.map(([id, n]) => entry(id, n)), traverseData: vi.fn() },
      getJson: async (path: string, query?: Record<string, string>) => {
        if (path === '/api/connectors') return handlers.bundled ? handlers.bundled() : [{ name: 'Shopify', title: 'Shopify' }];
        if (path === '/api/connectors/custom/summaries') return summaries(query);
        if (path === '/api/contexts') return [];
        return canvas(names.map(([id]) => id));
      },
    });
    return { ctx, summaries };
  };
  const rows = [
    { id: '1', name: 'FiberyTasks', title: 'Fibery Tasks', logo: null, hosts: ['owox.fibery.io'] },
    { id: '2', name: 'FiberyPeople', title: 'Fibery People', logo: 'data:image/png;base64,QQ', hosts: ['owox.fibery.io'] },
  ];

  test('custom connectors of one service become one source, and every mart keeps the shared key', async () => {
    const { ctx, summaries } = run([['a', 'FiberyTasks'], ['b', 'fiberypeople'], ['c', 'Shopify'], ['d', null]], { summaries: () => rows });
    const model = await loadModel(ctx);
    expect(summaries).toHaveBeenCalledWith({ names: 'FiberyTasks,fiberypeople' });
    expect(model.marts.get('a')!.sourceKey).toBe('service:fibery.io');
    expect(model.marts.get('b')!.sourceKey).toBe('service:fibery.io');
    expect(model.sources).toEqual([
      { key: 'service:fibery.io', name: 'Fibery', logo: 'data:image/png;base64,QQ', martIds: ['a', 'b'] },
      { key: 'Shopify', name: 'Shopify', logo: null, martIds: ['c'] },
    ]);
  });

  test('no summaries request when every name is bundled', async () => {
    const { ctx, summaries } = run([['a', 'Shopify']], { summaries: () => rows });
    await loadModel(ctx);
    expect(summaries).not.toHaveBeenCalled();
  });

  test('a refused bundled list makes no summaries request and keeps raw keys', async () => {
    const { ctx, summaries } = run([['a', 'FiberyTasks']], { bundled: () => { throw new Error('no'); }, summaries: () => rows });
    expect((await loadModel(ctx)).sources).toEqual([{ key: 'FiberyTasks', name: 'FiberyTasks', logo: null, martIds: ['a'] }]);
    expect(summaries).not.toHaveBeenCalled();
  });

  test('a refused summaries call costs only the custom detail', async () => {
    const { ctx } = run([['a', 'FiberyTasks'], ['b', 'Shopify']], { summaries: () => { throw new Error('403'); } });
    const model = await loadModel(ctx);
    expect(model.sources.map((s) => s.key).sort()).toEqual(['FiberyTasks', 'Shopify']);
  });

  test('malformed summary rows are skipped', async () => {
    const { ctx } = run([['a', 'FiberyTasks']], { summaries: () => [null, 7, { id: 1 }, rows[0]] });
    expect((await loadModel(ctx)).sources[0]).toMatchObject({ key: 'service:fibery.io', name: 'Fibery Tasks' });
  });
});
