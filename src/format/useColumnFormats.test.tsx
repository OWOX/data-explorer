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

function setup(answer: () => Promise<unknown>, opts: { failReads?: number; delayMs?: number } = {}) {
  const docs = new Map<string, unknown>();
  const gets = { n: 0 };
  const doGenerate = vi.fn(async () => ({ content: [{ type: 'text', text: JSON.stringify(await answer()) }] }));
  ctx = {
    ...stubCtx(),
    credentials: { ai: { fast: { doGenerate } } },
    collections: <T,>(name: string) => ({ get: async (id: string) => { if (opts.delayMs) await new Promise((r) => setTimeout(r, opts.delayMs)); if (gets.n++ < (opts.failReads ?? 0)) throw new Error('down'); return docs.has(`${name}/${id}`) ? { document: docs.get(`${name}/${id}`) as T } : null; }, put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); } }),
  } as unknown as Ctx;
  return { doGenerate, docs, gets };
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
  const signal = (s.doGenerate.mock.calls[0] as unknown as [{ abortSignal: AbortSignal }])[0].abortSignal;
  expect(signal.aborted).toBe(false);
  unmount();
  await waitFor(() => expect(signal.aborted).toBe(true));
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

test('a schema change while an ask is pending neither cancels nor repeats it; the new column is asked after', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  let n = 0;
  const s = setup(async () => { if (n++ === 0) await gate; return {}; });
  const joined: Field = { ...f('c.a', 'number', 'NUMERIC'), joined: { martId: 'c', label: 'Customers', aliasPath: 'c' } };
  const { rerender } = renderHook(({ sch, title }: { sch: Schema; title: string }) => useColumnFormats('m1', sch, title), { initialProps: { sch: schema, title: 'Orders' } });
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(1));
  const first = (s.doGenerate.mock.calls[0] as unknown as [{ abortSignal: AbortSignal }])[0].abortSignal;
  rerender({ sch: [...schema, joined], title: 'Orders 2' });
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).toHaveBeenCalledTimes(1);
  expect(first.aborted).toBe(false);
  release();
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(2), { timeout: PICK_SETTLE_MS * 8 });
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).toHaveBeenCalledTimes(2);
  const user = ((s.doGenerate.mock.calls[1] as unknown as [{ prompt: [unknown, { content: { text: string }[] }] }])[0].prompt[1]).content[0]!.text;
  expect(JSON.parse(user).columns.map((c: { id: string }) => c.id)).toEqual(['c.a']);
});

test('hook instances on one mart share the load, the ask and member choices', async () => {
  const s = setup(async () => ({ rate: { kind: 'percent' } }));
  const grid = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  const row = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(row.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'percent' }));
  expect(grid.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'percent' });
  act(() => grid.result.current.setMember('rate', { kind: 'plain' }));
  expect(row.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'plain' });
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).toHaveBeenCalledTimes(1);
});

test('two instances on one mart read the stored documents once', async () => {
  const s = setup(async () => ({}));
  s.docs.set('column-formats-member/m1', { rate: { kind: 'plain' } });
  const a = renderHook(() => useColumnFormats('m1'));
  const b = renderHook(() => useColumnFormats('m1'));
  await waitFor(() => expect(b.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'plain' }));
  expect(a.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'plain' });
  expect(s.gets.n).toBe(2);
});

const sig = (s: ReturnType<typeof setup>, i: number) => (s.doGenerate.mock.calls[i] as unknown as [{ abortSignal: AbortSignal }])[0].abortSignal;
const cols = (s: ReturnType<typeof setup>, i: number) => JSON.parse(((s.doGenerate.mock.calls[i] as unknown as [{ prompt: [unknown, { content: { text: string }[] }] }])[0].prompt[1]).content[0]!.text).columns.map((c: { id: string }) => c.id) as string[];

test('a view that remounts in the same commit keeps the ask in flight: one call, not aborted', async () => {
  const s = setup(() => new Promise(() => {}));
  const first = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(1));
  first.unmount();
  renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).toHaveBeenCalledTimes(1);
  expect(sig(s, 0).aborted).toBe(false);
});

test('the AI is asked about the union of what every live instance offers', async () => {
  const s = setup(async () => ({}));
  const extra: Field = { ...f('only_b', 'number', 'NUMERIC'), joined: { martId: 'c', label: 'C', aliasPath: 'c' } };
  renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  renderHook(() => useColumnFormats('m1', [...schema, extra], 'Orders'));
  await waitFor(() => expect(s.doGenerate).toHaveBeenCalledTimes(1));
  expect(cols(s, 0)).toEqual(['rate', 'amount', 'only_b']);
});

test('an unreadable document is not cached as empty: nothing is asked, and the next subscribe after a full teardown reads again', async () => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const s = setup(async () => ({}), { failReads: 2 });
  s.docs.set('column-formats-member/m1', { rate: { kind: 'plain' } });
  const a = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(s.gets.n).toBe(2));
  await new Promise((r) => setTimeout(r, PICK_SETTLE_MS * 2));
  expect(s.doGenerate).not.toHaveBeenCalled();
  expect(a.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'auto' });
  a.unmount();
  await new Promise((r) => setTimeout(r, 10));
  const b = renderHook(() => useColumnFormats('m1', schema, 'Orders'));
  await waitFor(() => expect(b.result.current.formatOf('rate', 'FLOAT64')).toEqual({ kind: 'plain' }));
});

test('a read that fails after everyone has left is retried on the next subscribe', async () => {
  const s = setup(async () => ({}), { failReads: 1, delayMs: 30 });
  const first = renderHook(() => useColumnFormats('m-retry', schema, 'Orders'));
  first.unmount();
  // the teardown has run; the read then fails
  await new Promise((r) => setTimeout(r, 120));
  const before = s.gets.n;
  const second = renderHook(() => useColumnFormats('m-retry', schema, 'Orders'));
  await waitFor(() => expect(s.gets.n).toBeGreaterThan(before));
  second.unmount();
});
