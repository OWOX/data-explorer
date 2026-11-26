import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Field } from '../model/types';
import { AppServices, StoreProvider } from '../state/store';
import { CarriedRanges, rangeable, useBucket } from './useBucket';
import type { ChartResult } from './useChartQuery';

const date = (extra: Partial<Field> = {}): Field => ({ name: 'created_at', alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false, ...extra });

function wrap(traverseData: ReturnType<typeof vi.fn>) {
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  return ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
}

test('Auto reads the range and picks a bucket from it', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'created_at | MIN': '2026-01-01', 'created_at | MAX': '2026-01-30' }]));
  const { result } = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.bucket).toBe('DAY')); // a ~30-day span; the fallback would be MONTH
  expect(traverseData).toHaveBeenCalledTimes(1);
});

const ungoverned = () => date({ allowedAggregations: ['COUNT'] });
const sentOf = (fn: ReturnType<typeof vi.fn>) => (fn.mock.calls as unknown as [string, Record<string, unknown>][]).map((c) => c[1]);

test('a date whose governance forbids MIN or MAX reads its months and picks from the first and last', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ created_at: '2026-01-01' }, { created_at: '2026-02-01' }]));
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  expect(result.current.bucket).toBeNull();
  await waitFor(() => expect(result.current.bucket).toBe('DAY'));
  expect(traverseData).toHaveBeenCalledTimes(1);
  const sent = sentOf(traverseData)[0]!;
  expect(sent.aggregation).toBeUndefined();
  expect(sent.dateTrunc).toMatchObject([{ column: 'created_at', unit: 'MONTH' }]);
});

test('a long run of months gives a coarser bucket', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ created_at: '2015-01-01' }, { created_at: '2020-06-01' }, { created_at: '2026-01-01' }]));
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.bucket).toBe('QUARTER'));
});

test('a date with no months falls back to MONTH', async () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(traverseData).toHaveBeenCalled());
  await waitFor(() => expect(result.current.bucket).toBe('MONTH'));
});

test('a failed months read surfaces its error and retry', async () => {
  const traverseData = vi.fn(async () => { throw new Error('boom'); });
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.error).toBeTruthy());
  expect(result.current.bucket).toBeNull();
});

test('a chosen bucket or a paused band sends nothing', async () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const a = renderHook(() => useBucket('m', ungoverned(), 'WEEK', [], 0, false), { wrapper: wrap(traverseData) });
  expect(a.result.current.bucket).toBe('WEEK');
  const b = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, true), { wrapper: wrap(traverseData) });
  expect(b.result.current.bucket).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(traverseData).not.toHaveBeenCalled();
});

test('a joined date without MIN after the join reads its months too', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ created_at: '2026-01-01' }, { created_at: '2026-02-01' }]));
  const joined = date({ postJoinAggregations: ['MAX'], joined: { martId: 'c', label: 'C', aliasPath: 'c' } });
  const { result } = renderHook(() => useBucket('m', joined, 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.bucket).toBe('DAY'));
});

test('the last month counts to its end: Jan to Mar picks WEEK, not DAY', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ created_at: '2026-01-01' }, { created_at: '2026-02-01' }, { created_at: '2026-03-01' }]));
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.bucket).toBe('WEEK'));
});

const carry = (result: Partial<ChartResult> | null) => {
  const ask = vi.fn(() => (result ? { rows: null, error: null, loading: false, held: false, retry: () => {}, ...result } : null));
  const traverseData = vi.fn(async () => traversalOf([{ 'created_at | MIN': '2026-01-01', 'created_at | MAX': '2026-01-30' }]));
  const base = wrap(traverseData);
  const wrapper = ({ children }: { children: ReactNode }) => base({ children: <CarriedRanges value={ask}>{children}</CarriedRanges> });
  return { ask, traverseData, wrapper };
};
const rangeRow = { 'created_at | MIN': '2026-01-01', 'created_at | MAX': '2026-01-30' };

test('rangeable is false for a date that forbids MIN or MAX', () => {
  expect(rangeable(date())).toBe(true);
  expect(rangeable(ungoverned())).toBe(false);
  expect(rangeable(null)).toBe(false);
});

test('a carried range gives the bucket with no read of its own', async () => {
  const c = carry({ rows: [rangeRow] });
  const { result } = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: c.wrapper });
  expect(result.current.bucket).toBe('DAY');
  await new Promise((r) => setTimeout(r, 0));
  expect(c.traverseData).not.toHaveBeenCalled();
});

test('while the carrying read loads the bucket is pending and nothing is sent; its error and retry are the bucket\'s', async () => {
  const retry = vi.fn();
  const loading = carry({ loading: true });
  const a = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: loading.wrapper });
  expect(a.result.current).toMatchObject({ bucket: null, pending: true });
  const failed = carry({ error: new Error('boom'), retry });
  const b = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: failed.wrapper });
  expect(b.result.current.bucket).toBeNull();
  expect(b.result.current.pending).toBe(false);
  expect((b.result.current.error as Error).message).toBe('boom');
  b.result.current.retry();
  expect(retry).toHaveBeenCalled();
  await new Promise((r) => setTimeout(r, 0));
  expect(loading.traverseData).not.toHaveBeenCalled();
  expect(failed.traverseData).not.toHaveBeenCalled();
});

test('a date that is not carried reads its range itself', async () => {
  const c = carry(null);
  const { result } = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: c.wrapper });
  await waitFor(() => expect(result.current.bucket).toBe('DAY'));
  expect(c.traverseData).toHaveBeenCalledTimes(1);
});

test('a date that forbids MIN reads its months even when the context could answer', async () => {
  const c = carry({ rows: [rangeRow] });
  const traverseData = c.traverseData;
  traverseData.mockImplementation(async () => traversalOf([{ created_at: '2026-01-01' }, { created_at: '2026-02-01' }]));
  const { result } = renderHook(() => useBucket('m', ungoverned(), 'AUTO', [], 0, false), { wrapper: c.wrapper });
  await waitFor(() => expect(result.current.bucket).toBe('DAY'));
  expect(c.ask).not.toHaveBeenCalled();
  expect(traverseData).toHaveBeenCalledTimes(1);
});
