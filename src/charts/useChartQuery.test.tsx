import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Row, TraverseOptions, Traversal } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { CHART_CACHE_LIMIT, useChartQuery } from './useChartQuery';

const opts = (limit = 10): TraverseOptions => ({ column: ['a'], limit });

function setup(traverseData: ReturnType<typeof vi.fn>) {
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  return wrapper;
}

test('returns rows; an equal options object in a second hook is served from cache', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ a: 1 }]));
  const wrapper = setup(traverseData);
  const one = renderHook(() => useChartQuery('m', opts(), 0), { wrapper });
  await waitFor(() => expect(one.result.current.rows).toEqual([{ a: 1 }]));
  const two = renderHook(() => useChartQuery('m', opts(), 0), { wrapper });
  await waitFor(() => expect(two.result.current.rows).toEqual([{ a: 1 }]));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a version bump reads again', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ a: 1 }]));
  const wrapper = setup(traverseData);
  const { result, rerender } = renderHook(({ v }) => useChartQuery('m', opts(), v), { wrapper, initialProps: { v: 0 } });
  await waitFor(() => expect(result.current.rows).not.toBeNull());
  rerender({ v: 1 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.rows).not.toBeNull());
});

test('changing options while loading cancels the first read and shows only the second', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const cancel = vi.fn(async () => {});
  const slow: Traversal = { async *rowChunks() { await gate; yield [{ a: 'slow' }] as Row[]; }, cancel };
  const traverseData = vi.fn(async (_id: string, o: TraverseOptions) => (o.limit === 10 ? slow : traversalOf([{ a: 'fast' }])));
  const wrapper = setup(traverseData);
  const { result, rerender } = renderHook(({ l }) => useChartQuery('m', opts(l), 0), { wrapper, initialProps: { l: 10 } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  rerender({ l: 20 });
  await waitFor(() => expect(result.current.rows).toEqual([{ a: 'fast' }]));
  await act(async () => { release(); await Promise.resolve(); });
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  expect(result.current.rows).toEqual([{ a: 'fast' }]);
});

test('an error is shown and retry reads again (failures are not cached)', async () => {
  const traverseData = vi.fn()
    .mockRejectedValueOnce(new Error('boom'))
    .mockResolvedValue(traversalOf([{ a: 1 }]));
  const wrapper = setup(traverseData);
  const { result } = renderHook(() => useChartQuery('m', opts(), 0), { wrapper });
  await waitFor(() => expect((result.current.error as Error).message).toBe('boom'));
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.rows).toEqual([{ a: 1 }]));
  expect(result.current.error).toBeNull();
  expect(traverseData).toHaveBeenCalledTimes(2);
});

test('null options run nothing', () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const { result } = renderHook(() => useChartQuery('m', null, 0), { wrapper: setup(traverseData) });
  expect(result.current).toMatchObject({ rows: null, error: null, loading: false });
  expect(traverseData).not.toHaveBeenCalled();
});

test('two hooks mounted together with the same key share one read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ a: 1 }]));
  const wrapper = setup(traverseData);
  const both = renderHook(() => [useChartQuery('m', opts(), 0), useChartQuery('m', opts(), 0)] as const, { wrapper });
  await waitFor(() => expect(both.result.current[0].rows).toEqual([{ a: 1 }]));
  await waitFor(() => expect(both.result.current[1].rows).toEqual([{ a: 1 }]));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('option objects with the same content in another key order share one read', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ a: 1 }]));
  const a: TraverseOptions = { column: ['a'], limit: 5, aggregation: [{ column: 'a', function: 'SUM' }, { column: 'b', function: 'MIN' }] };
  const b: TraverseOptions = { aggregation: [{ function: 'SUM', column: 'a' }, { function: 'MIN', column: 'b' }], limit: 5, column: ['a'] };
  const both = renderHook(() => [useChartQuery('m', a, 0), useChartQuery('m', b, 0)] as const, { wrapper: setup(traverseData) });
  await waitFor(() => expect(both.result.current[1].rows).toEqual([{ a: 1 }]));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a shared read is cancelled only when its last reader leaves', async () => {
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => { release = r; });
  const cancel = vi.fn(async () => {});
  const slow: Traversal = { async *rowChunks() { await gate; yield [{ a: 1 }] as Row[]; }, cancel };
  const traverseData = vi.fn(async () => slow);
  const wrapper = setup(traverseData);
  const one = renderHook(() => useChartQuery('m', opts(), 0), { wrapper });
  const two = renderHook(() => useChartQuery('m', opts(), 0), { wrapper });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
  one.unmount();
  await act(async () => { await Promise.resolve(); });
  expect(cancel).not.toHaveBeenCalled();
  two.unmount();
  await act(async () => { release(); await Promise.resolve(); });
  await waitFor(() => expect(cancel).toHaveBeenCalled());
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a rejection with no reason still ends loading with an error', async () => {
  const traverseData = vi.fn(async () => { throw undefined; });
  const { result } = renderHook(() => useChartQuery('m', opts(), 0), { wrapper: setup(traverseData) });
  await waitFor(() => expect(result.current.loading).toBe(false));
  expect((result.current.error as Error).message).toBe('Query failed');
});

test('the row cache keeps at most CHART_CACHE_LIMIT reads and drops the oldest', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ a: 1 }]));
  const wrapper = setup(traverseData);
  const { rerender, result } = renderHook(({ l }) => useChartQuery('m', opts(l), 0), { wrapper, initialProps: { l: 1 } });
  for (let l = 1; l <= CHART_CACHE_LIMIT + 1; l++) {
    rerender({ l });
    await waitFor(() => expect(result.current.rows).not.toBeNull());
    await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(l));
  }
  // The newest view is still cached; the oldest was evicted and reads again.
  traverseData.mockClear();
  rerender({ l: CHART_CACHE_LIMIT + 1 });
  await act(async () => { await Promise.resolve(); });
  expect(traverseData).not.toHaveBeenCalled();
  rerender({ l: 1 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(1));
});
