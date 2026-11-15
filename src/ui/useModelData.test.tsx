import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Mart, Model } from '../model/types';
import { AppServices, StoreProvider } from '../state/store';
import { useCardStatus } from './useModelData';

const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true });

test('counts at most 12 cards, 4 at a time; the rest show no badge', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
  const model: Model = { marts: new Map(ids.map((id) => [id, mart(id)])), edges: [], contexts: [], failedStorages: [] };
  let running = 0;
  let peak = 0;
  const traverseData = vi.fn(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return traversalOf([{ 'Unique Count': 7 }]);
  });
  const ctx = stubCtx({
    dataMarts: { list: vi.fn(), traverseData },
    getJson: async () => ({ id: 'x', schema: { fields: [{ name: 'id', type: 'INT64', isPrimaryKey: true }] } }),
    postJson: async () => ({ items: [] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  const { result } = renderHook(() => useCardStatus(model, ids, 0), { wrapper });

  await waitFor(() => expect(result.current.counts.get('m11')).toEqual({ state: 'ok', value: 7 }));
  expect(traverseData).toHaveBeenCalledTimes(12);
  expect(peak).toBeLessThanOrEqual(4);
  expect(result.current.counts.get('m12')).toEqual({ state: 'ok', value: null });
  expect(result.current.counts.get('m19')).toEqual({ state: 'ok', value: null });
});
