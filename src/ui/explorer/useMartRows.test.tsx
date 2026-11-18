import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { stubCtx, traversalOf } from '../../api/test-ctx';
import type { TraverseOptions } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { buildRowQuery, defaultColumns, useMartRows } from './useMartRows';
import type { Schema } from '../../model/types';

const f = (name: string, isPrimaryKey = false, type = 'STRING'): Schema[number] => ({ name, alias: null, type, category: type === 'STRING' ? 'string' : 'number', description: null, isPrimaryKey });
const schema: Schema = [f('id', true, 'INT64'), f('a'), f('b'), f('c'), f('customer_id', false, 'INT64'), f('e'), f('g')];

test('defaultColumns is the first 5 fields', () => {
  expect(defaultColumns(schema)).toEqual(['id', 'a', 'b', 'c', 'customer_id']);
});

test('defaultColumns skips calculated fields', () => {
  const s: Schema = [f('id', true, 'INT64'), { ...f('margin'), isCalculated: true }, f('a')];
  expect(defaultColumns(s)).toEqual(['id', 'a']);
});

test('buildRowQuery adds primary keys, keeps schema order, applies complete filters only', () => {
  const q = buildRowQuery(schema, ['b', 'a', 'customer_id'], [
    { field: 'a', op: 'contains', value: 'x' },
    { field: 'b', op: 'contains', value: '' },
  ], 200);
  expect(q).toEqual({
    column: ['id', 'a', 'b', 'customer_id'],
    filter: [{ column: 'a', operator: 'contains', value: 'x' }],
    sort: [{ column: 'id', direction: 'asc' }],
    limit: 201,
  });
});

test('no primary key means no sort', () => {
  const noPk: Schema = [f('x'), f('cur'), f('day')];
  expect(buildRowQuery(noPk, ['x', 'cur'], [], 200)).toEqual({ column: ['x', 'cur'], limit: 201 });
});

function hookCtx() {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1, a: 'x', b: 'y' }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  return { traverseData, wrapper };
}
const opts = (column: string[], limit = 201): TraverseOptions => ({ column, limit });

test('hiding a column does not query again; showing a never-loaded one does', async () => {
  const { traverseData, wrapper } = hookCtx();
  const { result, rerender } = renderHook(({ o }) => useMartRows('m', o, 0), { wrapper, initialProps: { o: opts(['id', 'a', 'b']) } });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ o: opts(['id', 'a']) });
  expect(result.current.loading).toBe(false);
  expect(result.current.rows).toHaveLength(1);
  rerender({ o: opts(['id', 'a', 'b']) }); // shown again: it was loaded
  expect(result.current.loading).toBe(false);
  expect(traverseData).toHaveBeenCalledTimes(1);
  rerender({ o: opts(['id', 'a', 'b', 'c']) });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
});

test('a changed limit, filter or version re-queries even with fewer columns', async () => {
  const { traverseData, wrapper } = hookCtx();
  const { result, rerender } = renderHook(({ o, v }) => useMartRows('m', o, v), { wrapper, initialProps: { o: opts(['id', 'a']), v: 0 } });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ o: opts(['id'], 401), v: 0 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  rerender({ o: { ...opts(['id'], 401), filter: [{ column: 'id', operator: 'eq' as const, value: 1 }] }, v: 0 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(3));
  rerender({ o: { ...opts(['id'], 401), filter: [{ column: 'id', operator: 'eq' as const, value: 1 }] }, v: 1 });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
});

test('buildRowQuery sends the reader sorts first, then the primary keys not already sorted; no sorts leaves the query as it was', () => {
  const plain = buildRowQuery(schema, ['a'], [], 200);
  expect(plain.sort).toEqual([{ column: 'id', direction: 'asc' }]);
  expect(buildRowQuery(schema, ['a'], [], 200, [])).toEqual(plain);
  const sorted = buildRowQuery(schema, ['a', 'b'], [], 200, [{ field: 'b', direction: 'desc' }, { field: 'a', direction: 'asc' }]);
  expect(sorted.sort).toEqual([{ column: 'b', direction: 'desc' }, { column: 'a', direction: 'asc' }, { column: 'id', direction: 'asc' }]);
  const onPk = buildRowQuery(schema, ['id', 'a'], [], 200, [{ field: 'id', direction: 'desc' }]);
  expect(onPk.sort).toEqual([{ column: 'id', direction: 'desc' }]);
  const noPk: Schema = [f('x'), f('y')];
  expect(buildRowQuery(noPk, ['x'], [], 200)).toEqual({ column: ['x'], limit: 201 });
  expect(buildRowQuery(noPk, ['x'], [], 200, [{ field: 'x', direction: 'asc' }]).sort).toEqual([{ column: 'x', direction: 'asc' }]);
});

test('a grid with a function or a bucket is grouped: exactly the visible columns, no primary key, no key tie-breaker, the rules sent', () => {
  const agg = { aggregations: [{ column: 'customer_id', function: 'SUM' as const }, { column: 'customer_id', function: 'MAX' as const }], dateTrunc: [{ column: 'g', unit: 'MONTH' as const, timeZone: 'UTC' }] };
  const q = buildRowQuery(schema, ['g', 'a', 'customer_id'], [{ field: 'a', op: 'eq', value: 'x' }], 200, [{ field: 'customer_id', direction: 'desc' }, { field: 'gone', direction: 'asc' }], agg);
  expect(q).toEqual({
    column: ['g', 'a', 'customer_id'],
    filter: [{ column: 'a', operator: 'eq', value: 'x' }],
    aggregation: [{ column: 'customer_id', function: 'SUM' }, { column: 'customer_id', function: 'MAX' }],
    dateTrunc: [{ column: 'g', unit: 'MONTH', timeZone: 'UTC' }],
    sort: [{ column: 'customer_id', direction: 'desc' }],
    limit: 201,
  });
});

test('rules of a column that is not asked for are not sent, and no rules means the ungrouped query as before', () => {
  const agg = { aggregations: [{ column: 'e', function: 'COUNT' as const }], dateTrunc: [] };
  expect(buildRowQuery(schema, ['a'], [], 200, [], agg)).toEqual({ column: ['a'], limit: 201 });
  expect(buildRowQuery(schema, ['a'], [], 200, [], { aggregations: [], dateTrunc: [] }).column).toEqual(['id', 'a']);
});

test('grouped: a shrinking column list re-queries, because fewer group keys are different rows', async () => {
  const { traverseData, wrapper } = hookCtx();
  const grouped = (column: string[]): TraverseOptions => ({ column, aggregation: [{ column: 'b', function: 'SUM' }], limit: 201 });
  const { result, rerender } = renderHook(({ o }) => useMartRows('m', o, 0), { wrapper, initialProps: { o: grouped(['a', 'c', 'b']) } });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ o: grouped(['a', 'b']) });
  expect(result.current.loading).toBe(true);
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(result.current.loading).toBe(false));
  // a date bucket groups too
  rerender({ o: { column: ['a', 'd'], dateTrunc: [{ column: 'd', unit: 'DAY' }], limit: 201 } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(3));
  rerender({ o: { column: ['d'], dateTrunc: [{ column: 'd', unit: 'DAY' }], limit: 201 } });
  await waitFor(() => expect(traverseData).toHaveBeenCalledTimes(4));
});

test('rows of another shape are not shown while the new query is in flight; the same shape keeps its rows', async () => {
  const { wrapper } = hookCtx();
  const { result, rerender } = renderHook(({ o }) => useMartRows('m', o, 0), { wrapper, initialProps: { o: opts(['id', 'a']) } });
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ o: { ...opts(['id', 'a']), limit: 401 } });
  expect(result.current.loading).toBe(true);
  expect(result.current.rows).toHaveLength(1); // a bigger page of the same rows
  rerender({ o: { column: ['a'], aggregation: [{ column: 'a', function: 'COUNT' }], limit: 401 } });
  expect(result.current.loading).toBe(true);
  expect(result.current.rows).toBeNull();
  expect(result.current.hasMore).toBe(false);
  await waitFor(() => expect(result.current.rows).toHaveLength(1));
  rerender({ o: opts(['id', 'a']) });
  expect(result.current.rows).toBeNull(); // and back
});

test('the run of the last query: none, running, done with its run id, failed', async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const traverseData = vi.fn(async () => { await gate; return { ...traversalOf([{ id: 1 }]), runId: 'r-7' }; });
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  const options: TraverseOptions = { column: ['id'], limit: 3 };

  const none = renderHook(() => useMartRows('orders', null, 0), { wrapper });
  expect(none.result.current.run).toEqual({ state: 'none' });

  const { result } = renderHook(() => useMartRows('orders', options, 0), { wrapper });
  expect(result.current.run).toEqual({ state: 'running' });
  open();
  await waitFor(() => expect(result.current.run).toEqual({ state: 'done', runId: 'r-7' }));

  const failing = stubCtx({ dataMarts: { list: vi.fn(), traverseData: vi.fn(async () => { throw new Error('boom'); }) } });
  const failWrap = ({ children }: { children: ReactNode }) => <AppServices ctx={failing}><StoreProvider>{children}</StoreProvider></AppServices>;
  const failed = renderHook(() => useMartRows('orders', options, 0), { wrapper: failWrap });
  await waitFor(() => expect(failed.result.current.run).toEqual({ state: 'failed' }));
});

test('a host that sends no run id gives done with a null run id', async () => {
  const { wrapper } = hookCtx();
  const { result } = renderHook(() => useMartRows('orders', { column: ['id'], limit: 3 }, 0), { wrapper });
  await waitFor(() => expect(result.current.run).toEqual({ state: 'done', runId: null }));
});

test('a paused grid (Charts) reports its unread query as paused, not running, and reads nothing', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  const q: TraverseOptions = { column: ['id'], limit: 201 };
  const { result } = renderHook(() => useMartRows('m', q, 0, true), { wrapper });
  expect(result.current.run).toEqual({ state: 'paused' });
  await new Promise((r) => setTimeout(r, 0));
  expect(traverseData).not.toHaveBeenCalled();
});
