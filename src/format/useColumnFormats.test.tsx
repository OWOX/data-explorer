import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, test, vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Field, Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import { resetAiPickSession } from './ai-pick';
import { useColumnFormats } from './useColumnFormats';

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
