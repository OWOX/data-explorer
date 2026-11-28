import { useEffect, useMemo, useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { filteredKey, rememberFiltered } from '../api/filtered-counts';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { CardRules } from '../filters/card-rules';
import type { Mart, Model } from '../model/types';
import type { TraverseFilter } from '../sdk/types';
import { AppServices, StoreProvider, useServices } from '../state/store';
import { useFilteredCounts } from './useFilteredCounts';

const mart = (id: string): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null });
const modelOf = (ids: string[]): Model => ({ marts: new Map(ids.map((id) => [id, mart(id)])), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] });
const rule = (value: number): TraverseFilter => ({ column: 'id', operator: 'gt', value } as TraverseFilter);
const rulesOf = (martId: string, value = 1, partial = false): CardRules => ({ martId, rules: [rule(value)], partial });

function setup(traverseData: (...a: unknown[]) => Promise<ReturnType<typeof traversalOf>>) {
  const ctx = stubCtx({
    dataMarts: { list: vi.fn(), traverseData },
    getJson: async () => ({ id: 'x', schema: { fields: [{ name: 'id', type: 'INT64', isPrimaryKey: false }] } }),
    postJson: async () => ({ items: [] }),
  });
  return ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
}

test('two paths of one mart with equal rules share one read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
  const byPath = new Map([['orders', rulesOf('m-orders')], ['x', rulesOf('m-orders')]]);
  const { result } = renderHook(() => useFilteredCounts(modelOf(['m-orders']), byPath), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('x')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  expect(result.current.filtered.get('orders')?.state).toEqual({ state: 'ok', value: 7, unique: false });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a missing total is an error, and retry reads again', async () => {
  let total = undefined as number | undefined;
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, total));
  const byPath = new Map([['', rulesOf('a')]]);
  const model = modelOf(['a']);
  const { result } = renderHook(() => useFilteredCounts(model, byPath), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('')?.state?.state).toBe('error'));
  total = 3;
  act(() => result.current.retry(''));
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 3, unique: false }));
  expect(traverseData).toHaveBeenCalledTimes(2);
});

test('changed rules keep the old value, stale, until the new one lands', async () => {
  let release: () => void = () => {};
  const traverseData = vi.fn(async (_id: unknown, o: unknown) => {
    const v = ((o as { filter: TraverseFilter[] }).filter[0] as { value: number }).value;
    if (v === 2) await new Promise<void>((r) => { release = r; });
    return traversalOf([{ id: 1 }], 2, v * 10);
  });
  const model = modelOf(['a']);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setup(traverseData), initialProps: { byPath: new Map([['', rulesOf('a', 1)]]) } });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 10, unique: false }));
  rerender({ byPath: new Map([['', rulesOf('a', 2)]]) });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 10, stale: true, unique: false }));
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  act(() => release());
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 20, unique: false }));
});

test('a partial path without rules has no state and sends no read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
  const byPath = new Map([['', { martId: 'a', rules: [], partial: true }]]);
  const { result } = renderHook(() => useFilteredCounts(modelOf(['a']), byPath), { wrapper: setup(traverseData) });
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.filtered.get('')).toEqual({ partial: true });
  expect(result.current.filtered.get('')?.state).toBeUndefined();
  expect(traverseData).not.toHaveBeenCalled();
});

test('a partial path with rules has no state and sends no read: a number from only some of its rules would be wrong', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
  const byPath = new Map([['', rulesOf('a', 1, true)]]);
  const { result } = renderHook(() => useFilteredCounts(modelOf(['a']), byPath), { wrapper: setup(traverseData) });
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.filtered.get('')).toEqual({ partial: true });
  expect(traverseData).not.toHaveBeenCalled();
});

test('at most 4 reads run at once', async () => {
  let running = 0;
  let peak = 0;
  const traverseData = vi.fn(async () => {
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return traversalOf([{ id: 1 }], 2, 7);
  });
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const byPath = new Map(ids.map((id) => [id, rulesOf(id)]));
  const { result } = renderHook(() => useFilteredCounts(modelOf(ids), byPath), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('f')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  expect(traverseData).toHaveBeenCalledTimes(6);
  expect(peak).toBe(4);
});

test('a seeded count turns a queued path ok and its read is never sent', async () => {
  const traverseData = vi.fn(async () => { await new Promise((r) => setTimeout(r, 20)); return traversalOf([{ id: 1 }], 2, 7); });
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const byPath = new Map(ids.map((id) => [id, rulesOf(id)]));
  const { result } = renderHook(() => useFilteredCounts(modelOf(ids), byPath), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('e')?.state).toEqual({ state: 'queued' }));
  act(() => result.current.seed(filteredKey('e', [rule(1)], null), 99, false));
  expect(result.current.filtered.get('e')?.state).toEqual({ state: 'ok', value: 99, unique: false });
  await waitFor(() => expect(result.current.filtered.get('d')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).toHaveBeenCalledTimes(4);
  expect(result.current.filtered.get('e')?.state).toEqual({ state: 'ok', value: 99, unique: false });
});

test('forget reads a mart again, keeping the old value dimmed meanwhile', async () => {
  let value = 7;
  let release: () => void = () => {};
  const traverseData = vi.fn(async () => {
    if (value === 9) await new Promise<void>((r) => { release = r; });
    return traversalOf([{ id: 1 }], 2, value);
  });
  const byPath = new Map([['', rulesOf('a')]]);
  const model = modelOf(['a']);
  const { result } = renderHook(() => useFilteredCounts(model, byPath), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  value = 9;
  act(() => result.current.forget('a'));
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, stale: true, unique: false });
  act(() => release());
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 9, unique: false }));
  expect(traverseData).toHaveBeenCalledTimes(2);
});

describe('past midnight', () => {
  afterEach(() => { vi.useRealTimers(); });
  const relative = (martId: string): CardRules => ({ martId, rules: [{ column: 'day', operator: 'relative_date', value: 'last_7_days' } as unknown as TraverseFilter], partial: false });

  test('a relative date path reads again on the next day, a plain one does not', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(new Date(2026, 10, 27, 23, 59));
    const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
    const byPath = new Map([['rel', relative('a')], ['plain', rulesOf('b')]]);
    const model = modelOf(['a', 'b']);
    renderHook(() => useFilteredCounts(model, byPath), { wrapper: setup(traverseData) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(traverseData).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(2 * 60_000); });
    expect(traverseData).toHaveBeenCalledTimes(3);
    expect(traverseData).toHaveBeenLastCalledWith('a', expect.anything());
  });
});

test('a path the grid will answer sends no read, and one the grid stops answering is read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
  const model = modelOf(['a']);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setup(traverseData), initialProps: { byPath: new Map([['', { ...rulesOf('a'), awaitGrid: true }]]) } });
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).not.toHaveBeenCalled();
  expect(result.current.filtered.get('')?.state).toEqual({ state: 'queued' });
  rerender({ byPath: new Map([['', { ...rulesOf('a'), awaitGrid: false }]]) });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('forget with the grid answering reads nothing until the path stops awaiting it', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }], 2, 7));
  const model = modelOf(['a']);
  const first = new Map([['', rulesOf('a')]]);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setup(traverseData), initialProps: { byPath: first } });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  act(() => result.current.forget('a', true));
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).toHaveBeenCalledTimes(1);
  rerender({ byPath: new Map([['', { ...rulesOf('a'), awaitGrid: true }]]) });
  await new Promise((r) => setTimeout(r, 30));
  expect(traverseData).toHaveBeenCalledTimes(1);
  rerender({ byPath: new Map([['', rulesOf('a')]]) });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
});

test('going back to a key whose read failed while the path wanted a cached one reads it again', async () => {
  let fail = true;
  let release: () => void = () => {};
  const traverseData = vi.fn(async () => {
    if (fail) { await new Promise<void>((r) => { release = r; }); throw new Error('boom'); }
    return traversalOf([{ id: 1 }], 2, 7);
  });
  const model = modelOf(['a']);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setup(traverseData), initialProps: { byPath: new Map([['', rulesOf('a', 1)]]) } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  act(() => result.current.seed(filteredKey('a', [rule(2)], null), 5, false));
  rerender({ byPath: new Map([['', rulesOf('a', 2)]]) });
  expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 5, unique: false });
  fail = true;
  await act(async () => { release(); await new Promise((r) => setTimeout(r, 10)); });
  fail = false;
  rerender({ byPath: new Map([['', rulesOf('a', 1)]]) });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  expect(traverseData).toHaveBeenCalledTimes(2);
});

test('going back to a key that was queued when the path wanted a cached one reads it', async () => {
  const releases: (() => void)[] = [];
  const traverseData = vi.fn(async (id: unknown) => {
    if (id !== 'a') await new Promise<void>((r) => { releases.push(r); });
    return traversalOf([{ id: 1 }], 2, 7);
  });
  const ids = ['b', 'c', 'd', 'e'];
  const model = modelOf(['a', ...ids]);
  const others = ids.map((id) => [id, rulesOf(id)] as const);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setup(traverseData), initialProps: { byPath: new Map([...others, ['', rulesOf('a', 1)] as const]) } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
  expect(result.current.filtered.get('')?.state).toEqual({ state: 'queued' });
  act(() => result.current.seed(filteredKey('a', [rule(2)], null), 5, false));
  rerender({ byPath: new Map([...others, ['', rulesOf('a', 2)] as const]) });
  rerender({ byPath: new Map([...others, ['', rulesOf('a', 1)] as const]) });
  await act(async () => { releases.forEach((r) => r()); });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: false }));
  expect(traverseData).toHaveBeenCalledWith('a', expect.anything());
});

function setupKeyed(traverseData: (...a: unknown[]) => Promise<ReturnType<typeof traversalOf>>) {
  const ctx = stubCtx({
    dataMarts: { list: vi.fn(), traverseData },
    getJson: async () => ({ id: 'x', schema: { fields: [{ name: 'id', type: 'INT64', isPrimaryKey: true }] } }),
    postJson: async () => ({ items: [] }),
  });
  return ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
}

test('a mart with a key is counted by unique records under its rules, with no total', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const byPath = new Map([['', rulesOf('a')]]);
  const { result } = renderHook(() => useFilteredCounts(modelOf(['a']), byPath), { wrapper: setupKeyed(traverseData) });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: true }));
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(traverseData).toHaveBeenCalledWith('a', { uniqueCount: [''], filter: [rule(1)] });
});

test('a seeded total for a mart with a key is shown as unique records, with no read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const model = modelOf(['a']);
  const { result, rerender } = renderHook(({ byPath }) => useFilteredCounts(model, byPath), { wrapper: setupKeyed(traverseData), initialProps: { byPath: new Map([['', rulesOf('a')]]) } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  act(() => result.current.seed(filteredKey('a', [rule(2)], null), 5, true));
  rerender({ byPath: new Map([['', rulesOf('a', 2)]]) });
  expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 5, unique: true });
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a cached entry of the other kind than the loaded schema is read again once, and ends ok', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 7 }]));
  const model = modelOf(['a']);
  const wrapper = setupKeyed(traverseData);
  const key = filteredKey('a', [rule(1)], null);
  const { result } = renderHook(() => {
    const { ctx, schemas } = useServices();
    // The schema is loaded, and the stale entry cached, before the path asks.
    const [ready, setReady] = useState(false);
    useEffect(() => { rememberFiltered(ctx, key, 42, false); void schemas.get('a').then(() => setReady(true)); }, [ctx, schemas]);
    const byPath = useMemo(() => (ready ? new Map([['', rulesOf('a')]]) : null), [ready]);
    return useFilteredCounts(model, byPath);
  }, { wrapper });
  await waitFor(() => expect(result.current.filtered.get('')?.state).toEqual({ state: 'ok', value: 7, unique: true }));
  expect(traverseData).toHaveBeenCalledTimes(1);
  expect(traverseData).toHaveBeenCalledWith('a', { uniqueCount: [''], filter: [rule(1)] });
});
