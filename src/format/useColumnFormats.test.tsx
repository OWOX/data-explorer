import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Field, Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import { resetAiPickSession } from './ai-pick';
import { PICK_SETTLE_MS, useColumnFormats } from './useColumnFormats';

let ctx: Ctx;
vi.mock('../state/store', () => ({ useServices: () => ({ ctx }) }));

const f = (name: string, category: Field['category'], type: string): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false });
const schema: Schema = [f('rate', 'number', 'FLOAT64'), f('amount', 'number', 'NUMERIC')];

function setup(answer: () => Promise<unknown>) {
  const docs = new Map<string, unknown>();
  const doGenerate = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(await answer()) }] }));
  ctx = {
    ...stubCtx(),
    credentials: { ai: { fast: { doGenerate } } },
    collections: <T,>(name: string) => ({ get: async (id: string) => (docs.has(`${name}/${id}`) ? { document: docs.get(`${name}/${id}`) as T } : null), put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); } }),
  } as unknown as Ctx;
  return { doGenerate, docs };
}
beforeEach(() => resetAiPickSession());

test('the AI pick repaints through formatOf, and a member choice wins over it', async () => {
  const s = setup(async () => ({ rate: { kind: 'percent' }, amount: { kind: 'plain' } }));
  const { result } = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'percent' }));
  act(() => result.current.setMember('rate', { kind: 'money', currency: 'USD' }));
  expect(result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'money', currency: 'USD' });
  expect(result.current.formatOf('amount', 'NUMERIC')).toEqual({ kind: 'plain' });
  expect(s.doGenerate).toHaveBeenCalledTimes(1);
});

test('a member choice made while the model thinks still wins when the pick arrives', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  setup(async () => { await gate; return { rate: { kind: 'percent' } }; });
  const { result } = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  act(() => result.current.setMember('rate', { kind: 'plain' }));
  release();
  await waitFor(() => expect(result.current.formatOf('amount', 'NUMERIC')).toEqual({ kind: 'auto' }));
  await new Promise((r) => setTimeout(r, 20));
  expect(result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'plain' });
});

test('unmounting aborts the ask; nothing is stored', async () => {
  const s = setup(() => new Promise(() => {}));
  const { unmount } = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalled());
  unmount();
  expect(s.docs.has('column-formats-project/m1')).toBe(false);
});

test('a member choice removed before the load resolves stays removed', async () => {
  const s = setup(async () => ({}));
  s.docs.set('column-formats-member/m1', { rate: { kind: 'plain' }, amount: { kind: 'plain' } });
  const { result } = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  act(() => result.current.setMember('rate', null));
  await waitFor(() => expect(result.current.formatOf('amount', 'NUMERIC')).toEqual({ kind: 'plain' }));
  expect(result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'auto' });
});

test('columns that join after the first pick are asked about once, together, and only them', async () => {
  const s = setup(async () => ({}));
  const joined = (n: string): Field => ({ ...f(n, 'number', 'NUMERIC'), joined: { martId: 'c', label: 'Customers', aliasPath: 'c' } });
  const { rerender } = renderHook(({ sch }: { sch: Schema }) => useColumnFormats('m1', sch, 'Orders'), { initialProps: { sch: schema } });
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(1));
  const next = [...schema, joined('c.a')];
  rerender({ sch: next });
  rerender({ sch: [...next, joined('c.b')] });
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(2), { timeout: PICK_SETTLE_MS * 8 });
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).toHaveBeenCalledTimes(2);
  const user = ((s.doGenerate.mock.calls[1] as unknown as [{ prompt: [unknown, { content: { text: string }[] }] }])[0].prompt[1]).content[0]!.text;
  expect(JSON.parse(user).columns.map((c: { id: string }) => c.id)).toEqual(['c.a', 'c.b']);
});
