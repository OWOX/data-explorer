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
const rels = new Map([['customer_id', { field: 'customer_id', edgeId: 'e', relatedMartId: 'customers', relatedField: 'id', composite: false, joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]]);

test('defaultColumns is the first 5 fields', () => {
  expect(defaultColumns(schema)).toEqual(['id', 'a', 'b', 'c', 'customer_id']);
});

test('defaultColumns skips calculated fields', () => {
  const s: Schema = [f('id', true, 'INT64'), { ...f('margin'), isCalculated: true }, f('a')];
  expect(defaultColumns(s)).toEqual(['id', 'a']);
});

test('buildRowQuery adds primary keys and the join fields of visible relationship columns, keeps schema order, applies complete filters only', () => {
  const q = buildRowQuery(schema, ['b', 'a', 'customer_id'], [
    { field: 'a', op: 'contains', value: 'x' },
    { field: 'b', op: 'contains', value: '' },
  ], 200, rels);
  expect(q).toEqual({
    column: ['id', 'a', 'b', 'customer_id'],
    filter: [{ column: 'a', operator: 'contains', value: 'x' }],
    sort: [{ column: 'id', direction: 'asc' }],
    limit: 201,
  });
});

test('no primary key → no sort, and composite join fields are fetched too', () => {
  const noPk: Schema = [f('x'), f('cur'), f('day')];
  const comp = new Map([['cur', { field: 'cur', edgeId: 'e', relatedMartId: 'fx', relatedField: 'code', composite: true, joins: [{ sourceField: 'cur', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] }]]);
  expect(buildRowQuery(noPk, ['x', 'cur'], [], 200, comp)).toEqual({ column: ['x', 'cur', 'day'], limit: 201 });
});

test('join source fields of a relationship column that is not visible are not fetched', () => {
  expect(buildRowQuery(schema, ['a'], [], 200, rels).column).toEqual(['id', 'a']);
  const noPk: Schema = [f('x'), f('cur'), f('day')];
  const comp = new Map([['cur', { field: 'cur', edgeId: 'e', relatedMartId: 'fx', relatedField: 'code', composite: true, joins: [{ sourceField: 'cur', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] }]]);
  expect(buildRowQuery(noPk, ['x'], [], 200, comp).column).toEqual(['x']);
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
