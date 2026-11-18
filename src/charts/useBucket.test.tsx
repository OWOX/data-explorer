import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Field } from '../model/types';
import { AppServices, StoreProvider } from '../state/store';
import { useBucket } from './useBucket';

const date = (extra: Partial<Field> = {}): Field => ({ name: 'created_at', alias: null, type: 'TIMESTAMP', category: 'date', description: null, isPrimaryKey: false, ...extra });

function wrap(traverseData: ReturnType<typeof vi.fn>) {
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  return ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
}

test('Auto reads the range and picks a bucket from it', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'created_at | MIN': '2022-01-01', 'created_at | MAX': '2026-01-01' }]));
  const { result } = renderHook(() => useBucket('m', date(), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  await waitFor(() => expect(result.current.bucket).toBe('MONTH'));
  expect(traverseData).toHaveBeenCalledTimes(1);
});

test('a date whose governance forbids MIN or MAX is not ranged: Auto uses months and sends nothing', async () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const { result } = renderHook(() => useBucket('m', date({ allowedAggregations: ['COUNT'] }), 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  expect(result.current.bucket).toBe('MONTH');
  expect(result.current.error).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(traverseData).not.toHaveBeenCalled();
});

test('a joined date without MIN after the join is not ranged either', () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const joined = date({ postJoinAggregations: ['MAX'], joined: { martId: 'c', label: 'C', aliasPath: 'c' } });
  const { result } = renderHook(() => useBucket('m', joined, 'AUTO', [], 0, false), { wrapper: wrap(traverseData) });
  expect(result.current.bucket).toBe('MONTH');
  expect(traverseData).not.toHaveBeenCalled();
});
