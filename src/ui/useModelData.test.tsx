import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Mart, Model } from '../model/types';
import { AppServices, StoreProvider } from '../state/store';
import { useCardStatus } from './useModelData';

const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const modelOf = (ids: string[]): Model => ({ marts: new Map(ids.map((id) => [id, mart(id)])), sources: [], edges: [], contexts: [], failedStorages: [] });

function setup(traverseData: () => Promise<ReturnType<typeof traversalOf>>) {
  const ctx = stubCtx({
    dataMarts: { list: vi.fn(), traverseData },
    getJson: async () => ({ id: 'x', schema: { fields: [{ name: 'id', type: 'INT64', isPrimaryKey: true }] } }),
    postJson: async () => ({ items: [] }),
  });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  return wrapper;
}

test('a card is counted only once it asks, 4 at a time', async () => {
  const ids = Array.from({ length: 20 }, (_, i) => `m${i}`);
  let running = 0;
  let peak = 0;
  const traverseData = vi.fn(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return traversalOf([{ 'Unique Count': 7 }]);
  });
  const { result } = renderHook(() => useCardStatus(modelOf(ids), ids, 0), { wrapper: setup(traverseData) });

  await new Promise((r) => setTimeout(r, 20));
  expect(traverseData).not.toHaveBeenCalled();
  expect(result.current.counts.get('m0')).toEqual({ state: 'idle' });

  act(() => ids.forEach((id) => result.current.request(id)));
  act(() => result.current.request('m3')); // a second ask for the same card is ignored
  await waitFor(() => expect(result.current.counts.get('m19')).toEqual({ state: 'ok', value: 7 }));
  expect(traverseData).toHaveBeenCalledTimes(20);
  expect(peak).toBeLessThanOrEqual(4);
});

test('a refresh that fails leaves counts and data quality as they were, and shows no spinner', async () => {
  const ids = ['a', 'b'];
  const model = modelOf(ids);
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const wrapper = setup(traverseData);
  const { result, rerender } = renderHook(({ version }) => useCardStatus(model, ids, version), { wrapper, initialProps: { version: 0 } });
  act(() => ids.forEach((id) => result.current.request(id)));
  await waitFor(() => expect(result.current.counts.get('b')).toEqual({ state: 'ok', value: 7 }));
  const dqBefore = result.current.dq;

  // The version moves but the reload fails: the model object never changes.
  rerender({ version: 1 });
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 7 });
  expect(result.current.counts.get('b')).toEqual({ state: 'ok', value: 7 });
  expect(result.current.dq).toBe(dqBefore);
  expect(traverseData).toHaveBeenCalledTimes(2);
});

test('a successful refresh recounts what was shown, keeping the old number until the new one lands', async () => {
  const ids = ['a'];
  let value = 7;
  let release: () => void = () => {};
  const traverseData = vi.fn(async () => {
    if (value === 9) await new Promise<void>((r) => { release = r; });
    return traversalOf([{ 'Unique Count': value }]);
  });
  const wrapper = setup(traverseData);
  const { result, rerender } = renderHook(({ model, version }) => useCardStatus(model, ids, version), { wrapper, initialProps: { model: modelOf(ids), version: 0 } });
  act(() => result.current.request('a'));
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 7 }));

  value = 9;
  rerender({ model: modelOf(ids), version: 1 });
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'loading' }));
  act(() => release());
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 9 }));
});

test('after a failed reload, a changed visible set neither recounts nor reloads; a later new model refreshes once', async () => {
  const ids = ['a', 'b'];
  const model = modelOf(ids);
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const { result, rerender } = renderHook(({ m, v, vis }) => useCardStatus(m, vis, v), { wrapper: setup(traverseData), initialProps: { m: model, v: 0, vis: ids } });
  act(() => ids.forEach((id) => result.current.request(id)));
  await waitFor(() => expect(result.current.counts.get('b')).toEqual({ state: 'ok', value: 7 }));

  rerender({ m: model, v: 1, vis: ['a'] }); // the reload failed: same model, new visible set
  await new Promise((r) => setTimeout(r, 20));
  expect(traverseData).toHaveBeenCalledTimes(2);
  expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 7 });

  rerender({ m: modelOf(ids), v: 1, vis: ['a', 'b'] }); // Retry succeeds
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
  await new Promise((r) => setTimeout(r, 20));
  expect(traverseData).toHaveBeenCalledTimes(4);
});

test('a card first seen after a refresh still goes through the count cache', async () => {
  const ids = ['a', 'b'];
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const base = stubCtx({
    dataMarts: { list: vi.fn(), traverseData },
    getJson: async () => ({ id: 'x', schema: { fields: [{ name: 'id', type: 'INT64', isPrimaryKey: true }] } }),
    postJson: async () => ({ items: [] }),
  });
  const cached = { ...base, collections: () => ({ get: async () => ({ document: { dataMartId: 'x', count: 5, at: new Date().toISOString() } }), put: async () => undefined }) } as unknown as typeof base;
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={cached}><StoreProvider>{children}</StoreProvider></AppServices>;
  const { result, rerender } = renderHook(({ m, v }) => useCardStatus(m, ids, v), { wrapper, initialProps: { m: modelOf(ids), v: 0 } });
  act(() => result.current.request('a'));
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 5 }));
  rerender({ m: modelOf(ids), v: 1 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1)); // a is recounted
  act(() => result.current.request('b')); // first seen after the refresh: the cache answers
  await waitFor(() => expect(result.current.counts.get('b')).toEqual({ state: 'ok', value: 5 }));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a refresh while counts are queued or in flight counts each card once per generation, newest value wins', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
  let value = 1;
  const releases: (() => void)[] = [];
  const perId = new Map<string, number>();
  const traverseData = vi.fn(async (id: string) => {
    perId.set(id, (perId.get(id) ?? 0) + 1);
    const v = value;
    await new Promise<void>((r) => releases.push(r));
    return traversalOf([{ 'Unique Count': v }]);
  });
  const { result, rerender } = renderHook(({ m, v }) => useCardStatus(m, ids, v), {
    wrapper: setup(traverseData as never), initialProps: { m: modelOf(ids), v: 0 },
  });
  act(() => ids.forEach((id) => result.current.request(id))); // 4 in flight, 4 queued
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
  value = 2;
  rerender({ m: modelOf(ids), v: 1 }); // refresh: queued ones are upgraded, in-flight ones asked again
  const drain = async () => { for (let i = 0; i < 40; i++) { act(() => releases.splice(0).forEach((r) => r())); await new Promise((r) => setTimeout(r, 5)); } };
  await drain();
  await waitFor(() => expect(ids.every((id) => result.current.counts.get(id)?.state === 'ok')).toBe(true));
  expect(ids.map((id) => result.current.counts.get(id))).toEqual(ids.map(() => ({ state: 'ok', value: 2 })));
  expect(Math.max(...perId.values())).toBeLessThanOrEqual(2);
  expect(traverseData).toHaveBeenCalledTimes(12); // 8 first-generation (4 in flight + 4 queued, upgraded) + 4 re-asked in flight
});
