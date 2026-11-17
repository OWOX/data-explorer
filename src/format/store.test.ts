import { vi } from 'vitest';
import { stubCtx } from '../api/test-ctx';
import type { Ctx } from '../sdk/types';
import { formatStore } from './store';

test('load is empty for a fresh mart', async () => {
  expect(await formatStore(stubCtx()).load('m1')).toEqual({ member: {}, project: {} });
});

test('setMember and setProject round-trip, merge, and null removes a choice', async () => {
  const ctx = { ...stubCtx() };
  const docs = new Map<string, unknown>();
  ctx.collections = <T,>(name: string) => ({ get: async (id: string) => (docs.has(`${name}/${id}`) ? { document: docs.get(`${name}/${id}`) as T } : null), put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); } });
  const s = formatStore(ctx);
  await s.setMember('m1', 'a', { kind: 'plain' });
  await s.setMember('m1', 'b', { kind: 'money', currency: 'USD' });
  await s.setProject('m1', { a: { kind: 'percent' } });
  await s.setProject('m1', { c: { kind: 'date' } });
  expect(await s.load('m1')).toEqual({ member: { a: { kind: 'plain' }, b: { kind: 'money', currency: 'USD' } }, project: { a: { kind: 'percent' }, c: { kind: 'date' } } });
  await s.setMember('m1', 'a', null);
  expect((await s.load('m1')).member).toEqual({ b: { kind: 'money', currency: 'USD' } });
  expect(await s.load('m2')).toEqual({ member: {}, project: {} });
  expect([...docs.keys()].sort()).toEqual(['column-formats-member/m1', 'column-formats-project/m1']);
});

test('malformed entries are dropped on load', async () => {
  const ctx = { ...stubCtx(), collections: () => ({ get: async () => ({ document: { a: { kind: 'plain' }, b: { kind: 'x' }, c: 5 } }), put: async () => {} }) } as unknown as Ctx;
  expect((await formatStore(ctx).load('m')).member).toEqual({ a: { kind: 'plain' } });
});

test('a failed read or write warns and never throws; an unreadable document is not overwritten', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const put = vi.fn();
  const ctx = { ...stubCtx(), collections: () => ({ get: async () => { throw new Error('down'); }, put }) } as unknown as Ctx;
  const s = formatStore(ctx);
  expect(await s.load('m')).toEqual({ member: {}, project: {} });
  await s.setMember('m', 'a', { kind: 'plain' });
  await s.setProject('m', { a: { kind: 'plain' } });
  expect(put).not.toHaveBeenCalled();
  expect(warn).toHaveBeenCalled();
  warn.mockRestore();
});
