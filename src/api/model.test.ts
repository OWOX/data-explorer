import { vi } from 'vitest';
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
  expect(model.marts.get('a')).toEqual({ id: 'a', title: 'Orders', description: 'd', icon: 'orders', storageId: 's1', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-01T00:00:00Z', accessible: true });
  expect(model.marts.get('b')!.accessible).toBe(false); // not in the member's list
  expect(model.edges).toEqual([{ id: 'e1', source: 'a', target: 'b', joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]);
  expect(model.contexts).toEqual([{ id: 'c1', name: 'Sales', icon: 'revenue' }]);
});

test('loadModel drops edges whose ends are unknown', async () => {
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    models: { getEdges: async () => [{ id: 'e1', sourceDataMartId: 'a', targetDataMartId: 'zzz', joinConditions: [] }] },
    getJson: async (path: string) => (path === '/api/contexts' ? [] : { items: [{ id: 'a', title: 'A', description: null, fieldCount: 0 }], total: 1, nextOffset: null }),
  });
  expect((await loadModel(ctx)).edges).toEqual([]);
});

test('a mart is accessible only when listed, PUBLISHED and available for reporting', async () => {
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
    getJson: async (path: string) => (path === '/api/contexts' ? [] : canvas),
  });
  const { marts } = await loadModel(ctx);
  expect(['pub', 'draft', 'off', 'hidden'].map((id) => marts.get(id)!.accessible)).toEqual([true, false, false, false]);
});
