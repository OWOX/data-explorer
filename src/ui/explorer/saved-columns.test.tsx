import { StrictMode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useServices, useStore, type State } from '../../state/store';
import { App } from '../App';
import { SAVED_COLUMNS_WAIT_MS, VIEW_HOLD_MAX_MS } from './MartGrid';
import { openColumnMenu, closeConfigMenu, openFields } from './menu-test-utils';

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
  // A remembered main mart keeps the first visit's open search box out of these tests.
  void inner.collections('preferences').put('main-mart', { martId: 'orders', sourceKey: null });
  const seeded = saved ? col.put('orders', { columns: saved, at: 'then' }) : Promise.resolve();
  const services: { current: ReturnType<typeof useServices> | null } = { current: null };
  const Probe = () => { services.current = useServices(); return null; };
  const store: { current: State | null } = { current: null };
  const StateProbe = () => { [store.current] = useStore(); return null; };
  const view = (strict = false) => {
    const tree = <AppServices ctx={ctx}><Probe /><StoreProvider><App /><StateProbe /></StoreProvider></AppServices>;
    return render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  };
  return { ctx, calls, put, view, services, seeded, col, store };
}
const headers = () => within(document.getElementById('band-data')!).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const ordersCalls = (calls: { id: string; column?: string[] }[]) => calls.filter((c) => c.id === 'orders' && c.column && c.column.length > 1);

test('saved columns seed the grid and the first rows query already uses them', async () => {
  const t = setup(['id', 'status', 'amount']);
  await t.seeded;
  t.view(true);
  await waitFor(() => expect(headers()).toHaveLength(3));
  expect(headers().join()).toMatch(/id.*status.*Amount/);
  await waitFor(() => expect(within(document.getElementById('band-data')!).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
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
  await waitFor(() => expect(within(document.getElementById('band-data')!).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
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
  await openFields('Orders');
  await userEvent.click(screen.getByRole('option', { name: /amount/i }));
  await waitFor(() => expect(headers()).toHaveLength(3));
  await waitFor(() => expect(t.put).toHaveBeenCalledTimes(1), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'status', 'amount'], at: expect.any(String) });
});

test('this session\'s columns win over the saved ones', async () => {
  const t = setup(['id', 'status']);
  await t.seeded;
  const { unmount } = t.view();
  await waitFor(() => expect(headers()).toHaveLength(2));
  await openFields('Orders');
  await userEvent.click(screen.getByRole('option', { name: /amount/i }));
  await waitFor(() => expect(headers()).toHaveLength(3));
  // A press outside the open Fields picker only closes it.
  await closeConfigMenu();
  // Going to another mart and back keeps the session's grid without asking the member store again.
  const load = vi.spyOn(t.services.current!.columnStore, 'load');
  // The main mart cannot join Order Items, so a click on its card does nothing; the search selects it as the main one.
  await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
  await userEvent.type(screen.getByRole('combobox', { name: 'Search data marts' }), 'Order Items{Enter}');
  await within(document.getElementById('band-data')!).findByText('Order Items');
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await within(document.getElementById('band-data')!).findByText('Orders');
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

test('after the 3 s fallback, an edit does not save the view until the late saved view has been read', async () => {
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
    const saveView = vi.spyOn(t.services.current!.columnStore, 'saveView');
    await userEvent.click(within(document.getElementById('band-data')!).getByRole('button', { name: /^Sort by Amount/ }));
    await vi.advanceTimersByTimeAsync(100);
    expect(saveView).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(1));
  } finally { vi.useRealTimers(); }
});

// The saved list and view sit behind a read that `gate` holds; the grid falls back to defaults after 3 s.
async function lateSetup(gated: boolean, opts: { gridView?: object; blendFails?: boolean } = {}) {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  let release: () => void = () => undefined;
  const gate = gated ? new Promise<void>((r) => { release = r; }) : Promise.resolve();
  const t = setup(['id', 'status'], (ctx) => ({
    ...ctx,
    owox: opts.blendFails ? { ...ctx.owox, getJson: ((path: string, q?: Record<string, string>) => (path.endsWith('/blendable-schema') ? Promise.reject(new Error('blendable boom')) : ctx.owox.getJson(path, q))) as Ctx['owox']['getJson'] } : ctx.owox,
    collections: <T,>(name: string) => {
      const inner = ctx.collections<T>(name);
      return name === SAVED ? { get: async (id: string) => { await gate; return inner.get(id); }, put: inner.put } : inner;
    },
  }));
  await t.col.put('orders', { columns: ['id', 'status'], at: 'then', gridView: opts.gridView ?? { fl: [['status', 'eq', 'paid', null, 1]], s: [['amount', -1]], l: 400 } } as never);
  const mounted = t.view();
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  await vi.advanceTimersByTimeAsync(SAVED_COLUMNS_WAIT_MS + 50);
  await waitFor(() => expect(headers()).toHaveLength(5));
  const saveView = vi.spyOn(t.services.current!.columnStore, 'saveView');
  return { t, release, saveView, mounted, store: t.store };
}
const sortAmount = () => userEvent.click(within(document.getElementById('band-data')!).getByRole('button', { name: /^Sort by Amount/ }));

test('an edit made after the fallback keeps the saved filters and limit the late read brings', async () => {
  try {
    const { release, saveView } = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    expect(saveView).not.toHaveBeenCalled();
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(1));
    const saved = saveView.mock.calls[0]![1];
    expect(Object.keys(saved.filters)).toEqual(['status']);
    expect(saved.limit).toBe(400);
    expect(saved.sorts).not.toBeNull();
  } finally { vi.useRealTimers(); }
});

test('Undo of an edit held during the late read returns to the saved view, not the defaults', async () => {
  try {
    const { release, saveView } = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    const last = saveView.mock.calls.at(-1)![1];
    expect(Object.keys(last.filters)).toEqual(['status']);
    expect(last.limit).toBe(400);
  } finally { vi.useRealTimers(); }
});

test('two held edits, then Undo twice, return to the saved view', async () => {
  try {
    const { release, saveView } = await lateSetup(true);
    await sortAmount();
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(saveView).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    const last = saveView.mock.calls.at(-1)![1];
    expect(Object.keys(last.filters)).toEqual(['status']);
    expect(last.limit).toBe(400);
  } finally { vi.useRealTimers(); }
});

test('Undo of a held edit before the late view arrives does not lose the saved view', async () => {
  try {
    const { release, saveView } = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    release();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    for (const [, v] of saveView.mock.calls) expect(v.filters).toHaveProperty('status');
  } finally { vi.useRealTimers(); }
});

test('with the joined marts unknown, the late view keeps its joined filters', async () => {
  try {
    const { release, saveView } = await lateSetup(true, { blendFails: true, gridView: { fl: [['customers__email', 'eq', 'a@b.c', null, 1], ['status', 'eq', 'paid', null, 1]], s: null, l: 400 } });
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(1));
    expect(Object.keys(saveView.mock.calls[0]![1].filters).sort()).toEqual(['customers__email', 'status']);
  } finally { vi.useRealTimers(); }
});

test('late sorts on columns that are not shown are dropped', async () => {
  try {
    const { release, saveView } = await lateSetup(true, { gridView: { fl: [], s: [['customers__email', 1]], l: 200 } });
    release();
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    expect(within(document.getElementById('band-data')!).getAllByRole('columnheader').some((h) => h.getAttribute('aria-sort') === 'ascending')).toBe(false);
    expect(saveView).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('with no edit made, the late saved view re-seeds the grid and nothing is written back', async () => {
  try {
    const { t, release, saveView } = await lateSetup(true);
    release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(within(document.getElementById('band-data')!).getAllByRole('columnheader').some((h) => h.getAttribute('aria-sort') === 'descending')).toBe(true));
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    expect(saveView).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('an edit still held when the grid unmounts is dropped, not saved over the unread view', async () => {
  try {
    const { t, release, saveView, mounted } = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    mounted.unmount();
    release();
    await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 500);
    expect(saveView).not.toHaveBeenCalled();
    expect(t.put).not.toHaveBeenCalled();
  } finally { vi.useRealTimers(); }
});

test('a saved-view read that never settles does not hold the edit past the cap', async () => {
  try {
    const { saveView } = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(VIEW_HOLD_MAX_MS - 1000);
    expect(saveView).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    await waitFor(() => expect(saveView).toHaveBeenCalledTimes(1));
  } finally { vi.useRealTimers(); }
});

test('a moved column is saved, and a fresh mount reading the same store shows the saved order', async () => {
  const t = setup(['id', 'status', 'amount']);
  await t.seeded;
  const first = t.view();
  await waitFor(() => expect(headers()).toHaveLength(3));
  const menu = await openColumnMenu(within(document.getElementById('band-data')!), 'id');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
  await waitFor(() => expect(headers().join()).toMatch(/status.*id.*Amount/));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['status', 'id', 'amount'], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  first.unmount();
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(3));
  expect(headers().join()).toMatch(/status.*id.*Amount/);
});

test('the hold ends once the late view arrives', async () => {
  try {
    const first = await lateSetup(true);
    await sortAmount();
    await vi.advanceTimersByTimeAsync(100);
    expect(first.store.current!.holds).toHaveProperty('orders');
    first.release();
    await vi.advanceTimersByTimeAsync(200);
    await waitFor(() => expect(first.store.current!.holds).toEqual({}));
  } finally { vi.useRealTimers(); }
});
