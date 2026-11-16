import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useServices } from '../../state/store';
import { App } from '../App';
import { SAVED_COLUMNS_WAIT_MS } from './MartGrid';

type Mock = ReturnType<typeof createMockCtx>;
const SAVED = 'grid-columns';

function setup(saved: string[] | null, tweak: (ctx: Mock) => Ctx = (c) => c) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const calls: { id: string; column?: string[] }[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const spied: Mock = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { calls.push({ id, column: o.column }); return real(id, o); } } } };
  const inner = tweak(spied);
  const put = vi.fn();
  const ctx: Ctx = { ...inner, collections: <T,>(name: string) => {
    const c = inner.collections<T>(name);
    return name === SAVED ? { get: c.get, put: (id: string, d: T) => { put(id, d); return c.put(id, d); } } : c;
  } };
  const col = inner.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION);
  const seeded = saved ? col.put('orders', { columns: saved, at: 'then' }) : Promise.resolve();
  const services: { current: ReturnType<typeof useServices> | null } = { current: null };
  const Probe = () => { services.current = useServices(); return null; };
  const view = (strict = false) => {
    const tree = <AppServices ctx={ctx}><Probe /><StoreProvider><App /></StoreProvider></AppServices>;
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  };
  return { ctx, calls, put, view, services, seeded, col };
}
const headers = () => within(document.getElementById('band-data')!).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const ordersCalls = (calls: { id: string; column?: string[] }[]) => calls.filter((c) => c.id === 'orders' && c.column && c.column.length > 1);

test('saved columns seed the grid and the first rows query already uses them', async () => {
  const t = setup(['id', 'status', 'amount']);
  await t.seeded;
  t.view(true);
  await waitFor(() => expect(headers()).toHaveLength(3));
  expect(headers().join()).toMatch(/id.*status.*Amount/);
  await waitFor(() => expect(within(document.getElementById('band-data')!).getAllByRole('row').length).toBeGreaterThan(1));
  const q = ordersCalls(t.calls);
  // StrictMode runs the rows effect twice in development, so two identical reads are the one query; none uses the defaults.
  expect(q).toHaveLength(2);
  for (const c of q) expect(c.column).toEqual(['id', 'status', 'amount']);
  expect(t.put).not.toHaveBeenCalled();
});

test('outside StrictMode the first rows query runs exactly once, with the saved columns', async () => {
  const t = setup(['id', 'status', 'amount']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(3));
  await waitFor(() => expect(within(document.getElementById('band-data')!).getAllByRole('row').length).toBeGreaterThan(1));
  const q = ordersCalls(t.calls);
  expect(q).toHaveLength(1);
  expect(q[0]!.column).toEqual(['id', 'status', 'amount']);
});

test('with nothing saved the defaults show and nothing is written', async () => {
  const t = setup(null);
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(5));
  await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 100));
  expect(t.put).not.toHaveBeenCalled();
});

test('unavailable saved columns are dropped and the cleaned list is saved', async () => {
  const t = setup(['id', 'gone', 'status']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(2));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'status'], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  expect(ordersCalls(t.calls).every((c) => !c.column!.includes('gone'))).toBe(true);
});

test('when every saved column is gone the defaults show', async () => {
  const t = setup(['gone', 'also_gone']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(5));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: [], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
});

test('a member change in the picker is saved; seeding is not', async () => {
  const t = setup(['id', 'status']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(2));
  expect(t.put).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Columns of Orders' }));
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(headers()).toHaveLength(3));
  await waitFor(() => expect(t.put).toHaveBeenCalledTimes(1), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'status', 'amount'], at: expect.any(String) });
});

test('this session\'s columns win over the saved ones', async () => {
  const t = setup(['id', 'status']);
  await t.seeded;
  const { unmount } = t.view();
  await waitFor(() => expect(headers()).toHaveLength(2));
  await userEvent.click(screen.getByRole('button', { name: 'Columns of Orders' }));
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(headers()).toHaveLength(3));
  // Going to another mart and back keeps the session's grid without asking the member store again.
  const load = vi.spyOn(t.services.current!.columnStore, 'load');
  await userEvent.click(within(document.getElementById('band-marts')!).getByText('Order Items').closest('article')!);
  await within(document.getElementById('band-data')!).findByRole('heading', { name: 'Order Items' });
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await within(document.getElementById('band-data')!).findByRole('heading', { name: 'Orders' });
  await waitFor(() => expect(headers()).toHaveLength(3));
  expect(load).not.toHaveBeenCalledWith('orders');
  unmount();
});

test('a load slower than 3 s falls back to the defaults and the late result is ignored', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => { release = r; });
    const t = setup(['id', 'status'], (ctx) => ({
      ...ctx,
      collections: <T,>(name: string) => {
        const inner = ctx.collections<T>(name);
        return name === SAVED ? { get: async (id: string) => { await gate; return inner.get(id); }, put: inner.put } : inner;
      },
    }));
    await t.seeded;
    t.view();
    await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
    await vi.advanceTimersByTimeAsync(SAVED_COLUMNS_WAIT_MS + 50);
    await waitFor(() => expect(headers()).toHaveLength(5));
    release();
    await vi.advanceTimersByTimeAsync(200);
    expect(headers()).toHaveLength(5);
  } finally { vi.useRealTimers(); }
});
