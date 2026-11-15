import type { Mart, Model } from '../model/types';
import { storageOptions, tickedStorages } from './storages';

const mart = (id: string, storageId: string): Mart => ({ id, title: id, description: null, icon: null, storageId, contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const model = (storages: string[], marts: [string, string][]): Model => ({
  marts: new Map(marts.map(([id, s]) => [id, mart(id, s)])),
  sources: [], edges: [], contexts: [],
  storages: storages.map((id) => ({ id, title: id.toUpperCase(), type: 'X' })),
  failedStorages: [],
});

test('storageOptions lists storages that hold marts, with counts', () => {
  const m = model(['s1', 's2', 's3'], [['a', 's1'], ['b', 's1'], ['c', 's3']]);
  expect(storageOptions(m)).toEqual([{ id: 's1', title: 'S1', type: 'X', count: 2 }, { id: 's3', title: 'S3', type: 'X', count: 1 }]);
});

test('tickedStorages is null with fewer than two storages holding marts', () => {
  expect(tickedStorages(model(['s1', 's2'], [['a', 's1']]), ['s1'])).toBeNull();
});

test('tickedStorages drops a storage a refresh removed', () => {
  const m = model(['s1', 's2'], [['a', 's1'], ['b', 's2']]);
  expect(tickedStorages(m, ['s1', 'gone'])).toEqual(['s1']);
  expect(tickedStorages(m, null)).toBeNull();
});
