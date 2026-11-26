import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Mart, Model } from '../model/types';
import { buildJoinTree, statusIds } from '../state/join-tree';
import { AppServices, StoreProvider } from '../state/store';
import { useCardStatus } from './useModelData';

const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const modelOf = (ids: string[]): Model => ({ marts: new Map(ids.map((id) => [id, mart(id)])), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] });

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
  // The old count stays, flagged stale so the card dims it; it is not replaced by a spinner.
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 7, stale: true }));
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

test('a queued card shows queued, and a request for a card that left the band is dropped so the visible one counts first', async () => {
  const ids = Array.from({ length: 12 }, (_, i) => `m${i}`);
  const gates: (() => void)[] = [];
  const traverseData = vi.fn(() => new Promise<ReturnType<typeof traversalOf>>((r) => { gates.push(() => r(traversalOf([{ 'Unique Count': 7 }]))); }));
  const model = modelOf(ids);
  const { result, rerender } = renderHook(({ vis }) => useCardStatus(model, vis, 0), { wrapper: setup(traverseData), initialProps: { vis: ids } });
  act(() => ids.forEach((id) => result.current.request(id)));
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
  expect(result.current.counts.get('m0')).toEqual({ state: 'loading' });
  expect(result.current.counts.get('m11')).toEqual({ state: 'queued' });

  // The band narrows to a card that was queued last: the others are dropped, not waited behind.
  rerender({ vis: ['m11'] });
  act(() => gates.shift()!());
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(5));
  expect(result.current.counts.get('m11')).toEqual({ state: 'loading' });
  gates.forEach((g) => g());
  await new Promise((r) => setTimeout(r, 20));
  expect(traverseData).toHaveBeenCalledTimes(5);

  // Shown again, a dropped card asks again.
  rerender({ vis: ['m11', 'm5'] });
  act(() => result.current.request('m5'));
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(6));
});

test('a bare node of the join tree is counted once it is in the ids, and stays idle without', async () => {
  const tree = buildJoinTree('main', ['id', 'a__c__name'], [
    { aliasPath: 'a', martId: 'a', label: 'a', depth: 1, fields: [], uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' },
    { aliasPath: 'a.c', martId: 'c', label: 'c', depth: 2, fields: [{ name: 'a__c__name', alias: 'name', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: 'c', label: 'c', aliasPath: 'a.c', originalName: 'name' } }], uniqueCount: true, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' },
  ]);
  const model = modelOf(['main', 'a', 'c']);
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 5 }]));
  const wrapper = setup(traverseData);
  const without = renderHook(() => useCardStatus(model, ['main', 'c'], 0), { wrapper });
  act(() => without.result.current.request('a'));
  await new Promise((r) => setTimeout(r, 20));
  expect(traverseData).not.toHaveBeenCalled();
  expect(without.result.current.counts.get('a')?.state ?? 'idle').toBe('idle');

  const ids = statusIds(['main', 'c'], tree);
  const { result } = renderHook(() => useCardStatus(model, ids, 0), { wrapper });
  act(() => result.current.request('a'));
  await waitFor(() => expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 5 }));
});

test('a refresh dims every recounted card at once, also the ones still waiting in the queue behind the first 4', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
  let gate: Promise<void> | null = null;
  const traverseData = vi.fn(async () => { await gate; return traversalOf([{ 'Unique Count': 7 }]); });
  const { result, rerender } = renderHook(({ model, version }) => useCardStatus(model, ids, version), { wrapper: setup(traverseData), initialProps: { model: modelOf(ids), version: 0 } });
  act(() => ids.forEach((id) => result.current.request(id)));
  await waitFor(() => expect(result.current.counts.get('m7')).toEqual({ state: 'ok', value: 7 }));
  let open!: () => void;
  gate = new Promise<void>((r) => { open = r; });
  rerender({ model: modelOf(ids), version: 1 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(8 + 4));
  for (const id of ids) expect(result.current.counts.get(id)).toEqual({ state: 'ok', value: 7, stale: true });
  gate = null;
  act(() => open());
  await waitFor(() => expect(result.current.counts.get('m7')).toEqual({ state: 'ok', value: 7 }));
  expect(traverseData).toHaveBeenCalledTimes(16);
});

test('a recount dropped from the queue because its card left view is no longer dimmed', async () => {
  const ids = Array.from({ length: 8 }, (_, i) => `m${i}`);
  let gate: Promise<void> | null = null;
  const traverseData = vi.fn(async () => { await gate; return traversalOf([{ 'Unique Count': 7 }]); });
  const { result, rerender } = renderHook(({ model, version, vis }) => useCardStatus(model, vis, version), { wrapper: setup(traverseData), initialProps: { model: modelOf(ids), version: 0, vis: ids } });
  act(() => ids.forEach((id) => result.current.request(id)));
  await waitFor(() => expect(result.current.counts.get('m7')).toEqual({ state: 'ok', value: 7 }));
  gate = new Promise<void>(() => {});
  rerender({ model: modelOf(ids), version: 1, vis: ids });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(8 + 4));
  expect(result.current.counts.get('m7')).toEqual({ state: 'ok', value: 7, stale: true });
  rerender({ model: modelOf(ids), version: 1, vis: ids.slice(0, 4) });
  // Brought back into view without asking again: its old count shows, not dimmed.
  rerender({ model: modelOf(ids), version: 1, vis: ids });
  await waitFor(() => expect(result.current.counts.get('m7')).toEqual({ state: 'ok', value: 7 }));
  // The ones still counting stay dimmed.
  expect(result.current.counts.get('m0')).toEqual({ state: 'ok', value: 7, stale: true });
  expect(traverseData).toHaveBeenCalledTimes(12);
});

test('an offered count replaces a queued read: it never runs, and the card shows the value', async () => {
  const ids = Array.from({ length: 6 }, (_, i) => `m${i}`);
  const releases: (() => void)[] = [];
  const called: string[] = [];
  const traverseData = vi.fn(async (id: string) => { called.push(id); await new Promise<void>((r) => releases.push(r)); return traversalOf([{ 'Unique Count': 7 }]); });
  const { result } = renderHook(() => useCardStatus(modelOf(ids), ids, 0), { wrapper: setup(traverseData as never) });
  act(() => ids.forEach((id) => result.current.request(id))); // 4 in flight, m4 and m5 queued
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
  act(() => result.current.offer('m5', 99));
  expect(result.current.counts.get('m5')).toEqual({ state: 'ok', value: 99 });
  for (let i = 0; i < 20; i++) { act(() => releases.splice(0).forEach((r) => r())); await new Promise((r) => setTimeout(r, 5)); }
  await waitFor(() => expect(result.current.counts.get('m4')).toEqual({ state: 'ok', value: 7 }));
  expect(called).not.toContain('m5');
  expect(result.current.counts.get('m5')).toEqual({ state: 'ok', value: 99 });
});

test('an offered count is not overwritten by a read already running, and a later request reads nothing', async () => {
  const releases: (() => void)[] = [];
  const traverseData = vi.fn(async () => { await new Promise<void>((r) => releases.push(r)); return traversalOf([{ 'Unique Count': 7 }]); });
  const { result } = renderHook(() => useCardStatus(modelOf(['a']), ['a'], 0), { wrapper: setup(traverseData as never) });
  act(() => result.current.request('a'));
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  act(() => result.current.offer('a', 99));
  act(() => releases.splice(0).forEach((r) => r()));
  await new Promise((r) => setTimeout(r, 30));
  expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 99 });
  act(() => result.current.request('a'));
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('after an offer, request reads nothing', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const { result } = renderHook(() => useCardStatus(modelOf(['a']), ['a'], 0), { wrapper: setup(traverseData) });
  act(() => result.current.offer('a', 5));
  act(() => result.current.request('a'));
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).not.toHaveBeenCalled();
  expect(result.current.counts.get('a')).toEqual({ state: 'ok', value: 5 });
});
