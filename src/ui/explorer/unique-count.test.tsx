import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;

/** The grid of a mart: `grid` is stored for it before the page reads it; `main` makes it the selected mart. */
function setup(opts: { main?: string; grid?: GridState; hideStoreKey?: boolean; saved?: object; blendFails?: boolean } = {}) {
  const f = demoFixtures();
  if (opts.hideStoreKey) {
    const stores = f.marts.find((m) => m.id === 'stores')!;
    stores.fields = stores.fields.map((x) => (x.name === 'id' ? { ...x, isHiddenForReporting: true } : x));
  }
  const base: Mock = createMockCtx(f, { latencyMs: 0 });
  const queries: { id: string; o: TraverseOptions }[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const realGet = base.owox.getJson.bind(base.owox);
  const getJson = (<T,>(path: string, query?: Record<string, string>) => (opts.blendFails && path.endsWith('/blendable-schema') ? Promise.reject(new Error('blendable boom')) : realGet<T>(path, query))) as Mock['owox']['getJson'];
  const ctx: Ctx = { ...base, owox: { ...base.owox, getJson, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { queries.push({ id, o }); return real(id, o); } } } };
  const state: { current: ReturnType<typeof useStore>[0] | null } = { current: null };
  function Probe() {
    const [s, dispatch] = useStore();
    state.current = s;
    useEffect(() => {
      if (opts.main) dispatch({ type: 'selectMart', id: opts.main, sourceOf: () => null });
      if (opts.grid) dispatch({ type: 'saveGrid', martId: opts.main ?? 'orders', grid: opts.grid });
    }, [dispatch]);
    return null;
  }
  const seeded = opts.saved ? ctx.collections(GRID_COLUMNS_COLLECTION).put(opts.main ?? 'orders', opts.saved as never) : Promise.resolve();
  const view = async () => { await seeded; render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>); };
  const of = (id: string) => queries.filter((q) => q.id === id);
  return { view, queries, state, ctx, of };
}

const data = () => document.getElementById('band-data')!;
const titleHeaders = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup');
const headers = () => titleHeaders().map((h) => h.textContent);
const groupRow = () => data().querySelector('tr[data-group-row]')!;
const picker = async (mart: string) => {
  // The bands are drawn again once the model has loaded: the grid is looked up after that.
  await waitFor(() => expect(data().querySelector('table')).not.toBeNull(), { timeout: 5000 });
  await userEvent.click(await within(data()).findByRole('button', { name: `Fields of ${mart}` }, { timeout: 5000 }));
  return within(await screen.findByRole('dialog'));
};
const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));
/** The grid's cells of one column, by its header text. */
const cellsOf = (title: string) => {
  const at = headers().indexOf(title);
  return within(data()).getAllByRole('row').filter((r) => r.querySelector('td')).map((r) => r.querySelectorAll('td')[at]!.textContent);
};

describe('a mart whose primary key is hidden for reporting', () => {
  test('offers Unique Count in the Fields picker; ticking it adds a counted column, names no hidden field, and Undo takes it back', async () => {
    const t = setup({ main: 'stores', hideStoreKey: true });
    await t.view();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
    const before = headers();
    expect(before).not.toContain('Unique Count');
    const fields = await picker('Stores');
    // The lead row is there although the key is not a field of the list.
    expect(fields.getAllByRole('option')[0]).toHaveAccessibleName('Unique Count');
    expect(fields.queryByRole('option', { name: 'id' })).toBeNull();
    await userEvent.click(fields.getByRole('option', { name: 'Unique Count' }));
    await waitFor(() => expect(headers()).toEqual([...before, 'Unique Count']));
    await waitFor(() => expect(t.of('stores').at(-1)!.o.uniqueCount).toEqual(['']));
    const last = t.of('stores').at(-1)!.o;
    // The shown columns become the group keys, and no hidden field is named anywhere.
    expect(last.column).toEqual(expect.arrayContaining(['name', 'city']));
    expect(last.column).not.toContain('id');
    expect(t.of('stores').flatMap((q) => [...(q.o.column ?? []), ...(q.o.sort ?? []).map((s) => s.column)])).not.toContain('id');
    await waitFor(() => expect(cellsOf('Unique Count').length).toBeGreaterThan(0));
    for (const c of cellsOf('Unique Count')) expect(Number(c)).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText(/Unknown column/)).toBeNull();
    expect(t.state.current!.grids.stores!.uniqueCount).toEqual(['']);
    await userEvent.keyboard('{Escape}');
    // A column of the metric has no filter and no function.
    const menu = await openColumnMenu(within(data()), 'Unique Count');
    expect(within(menu).queryByRole('menuitem', { name: 'Filter' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Aggregate' })).toBeNull();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Menu of Unique Count' })).toBeNull());
    await undo();
    await waitFor(() => expect(headers()).toEqual(before));
    expect(t.state.current!.grids.stores!.uniqueCount).toBeUndefined();
    await waitFor(() => expect(t.of('stores').at(-1)!.o.uniqueCount).toBeUndefined());
  });

  test('a mart with a composite key offers it too', async () => {
    const f = demoFixtures();
    const m = f.marts.find((x) => x.id === 'orders')!;
    m.fields = m.fields.map((x) => (x.name === 'status' ? { ...x, isPrimaryKey: true } : x));
    const base = createMockCtx(f, { latencyMs: 0 });
    render(<AppServices ctx={base}><StoreProvider><App /></StoreProvider></AppServices>);
    const fields = await picker('Orders');
    expect(fields.getAllByRole('option')[0]).toHaveAccessibleName('Unique Count');
  });
});

describe('the Unique Count column', () => {
  const withCustomers: GridState = { columns: ['id', 'status', 'customers__name'], filters: {}, sorts: null, limit: 200 };

  test('is read-only and numeric, sits after its mart\'s own columns, and can be sorted by its row key', async () => {
    const t = setup({ grid: { ...withCustomers, uniqueCount: [''] } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count', 'name']));
    await waitFor(() => expect(t.of('orders').at(-1)!.o.uniqueCount).toEqual(['']));
    const th = titleHeaders()[2]!;
    expect(th).not.toHaveAttribute('data-column');
    // The group of the main mart spans its three columns; the joined group has its one.
    const spans = [...groupRow().querySelectorAll<HTMLTableCellElement>('th[data-group-path]')].map((h) => [h.dataset.groupPath, h.colSpan]);
    expect(spans).toEqual([['', 3], ['customers', 1]]);
    expect(within(th).getByRole('button', { name: /^Sort by Unique Count/ })).toBeInTheDocument();
    await userEvent.click(within(th).getByRole('button', { name: /^Sort by Unique Count/ }));
    await waitFor(() => expect(t.of('orders').at(-1)!.o.sort).toEqual([{ column: 'Unique Count', direction: 'asc' }]));
  });

  test('a joined mart\'s Unique Count is sent by its alias path and shown in its group', async () => {
    const t = setup({ grid: withCustomers });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'name']));
    const fields = await picker('Customers');
    expect(fields.getAllByRole('option')[0]).toHaveAccessibleName('Unique Count');
    await userEvent.click(fields.getByRole('option', { name: 'Unique Count' }));
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'name', 'Unique Count']));
    await waitFor(() => expect(t.of('orders').at(-1)!.o.uniqueCount).toEqual(['customers']));
    const spans = [...groupRow().querySelectorAll<HTMLTableCellElement>('th[data-group-path]')].map((h) => [h.dataset.groupPath, h.colSpan]);
    expect(spans).toEqual([['', 2], ['customers', 2]]);
    expect(t.state.current!.grids.orders!.uniqueCount).toEqual(['customers']);
    // A customer-less order counts none.
    await waitFor(() => expect(cellsOf('Unique Count').some((c) => Number(c) >= 1)).toBe(true));
    expect(cellsOf('Unique Count').every((c) => Number.isInteger(Number(c)))).toBe(true);
  });

  test('its header menu removes it; the other mart\'s Unique Count is a separate switch', async () => {
    const t = setup({ grid: { ...withCustomers, uniqueCount: ['', 'customers'] } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count', 'name', 'Unique Count']));
    const menu = await openColumnMenu(within(data()), 'Customers · Unique Count');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove Unique Count' }));
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count', 'name']));
    await waitFor(() => expect(t.of('orders').at(-1)!.o.uniqueCount).toEqual(['']));
    expect(t.state.current!.grids.orders!.uniqueCount).toEqual(['']);
  });

  test('taking its sort off with it: removing the count leaves no ordering by a column that is gone', async () => {
    const t = setup({ grid: { ...withCustomers, uniqueCount: [''], sorts: [{ field: 'Unique Count', direction: 'desc' }, { field: 'status', direction: 'asc' }] } });
    await t.view();
    await waitFor(() => expect(t.of('orders').at(-1)!.o.sort).toEqual([{ column: 'Unique Count', direction: 'desc' }, { column: 'status', direction: 'asc' }]));
    const menu = await openColumnMenu(within(data()), 'Unique Count');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Remove Unique Count' }));
    await waitFor(() => expect(t.state.current!.grids.orders!.sorts).toEqual([{ field: 'status', direction: 'asc' }]));
  });

  test('a joined mart with no column left on the grid takes its Unique Count with it', async () => {
    const t = setup({ grid: { ...withCustomers, uniqueCount: ['', 'customers'] } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count', 'name', 'Unique Count']));
    await userEvent.click(within(data()).getByRole('button', { name: 'Remove Customers from the grid' }));
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count']));
    await waitFor(() => expect(t.state.current!.grids.orders!.uniqueCount).toEqual(['']));
  });

  test('is saved with the view when it is ticked', async () => {
    const t = setup({ grid: withCustomers });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'name']));
    await userEvent.click((await picker('Orders')).getByRole('option', { name: 'Unique Count' }));
    await waitFor(() => expect(headers()).toContain('Unique Count'));
    await waitFor(async () => expect((await t.ctx.collections<{ gridView?: { uc?: string[] } }>(GRID_COLUMNS_COLLECTION).get('orders'))?.document.gridView?.uc).toEqual(['']), { timeout: SAVE_DEBOUNCE_MS + 2000 });
  });

  test('a saved view that carries it opens with the column', async () => {
    const t = setup({ saved: { columns: ['id', 'status'], at: 'then', gridView: { fl: [], s: null, l: 200, uc: [''] } } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count']));
    await waitFor(() => expect(t.of('orders').at(-1)!.o.uniqueCount).toEqual(['']));
  });

  test('a saved metric the mart cannot count is dropped when the grid opens', async () => {
    const t = setup({ saved: { columns: ['id', 'status'], at: 'then', gridView: { fl: [], s: [['customers__unique_count', 1]], l: 200, uc: ['', 'campaigns'] } } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Unique Count']));
    expect(t.of('orders').every((q) => !q.o.uniqueCount?.includes('campaigns'))).toBe(true);
  });

  test('a saved view whose only Unique Count is unavailable, and which sorts on it, opens ungrouped with no sort on that key', async () => {
    const t = setup({ saved: { columns: ['id', 'status'], at: 'then', gridView: { fl: [], s: [['campaigns__unique_count', 1], ['status', -1]], l: 200, uc: ['campaigns'] } } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status']));
    // The record count (no columns) asks for the main mart's count on its own; the grid's reads name columns.
    await waitFor(() => expect(t.of('orders').filter((q) => q.o.column?.length).length).toBeGreaterThan(0));
    for (const q of t.of('orders').filter((q) => q.o.column?.length)) {
      expect(q.o.uniqueCount).toBeUndefined();
      expect((q.o.sort ?? []).map((x) => x.column)).not.toContain('campaigns__unique_count');
    }
    expect(t.state.current!.grids.orders!.uniqueCount).toBeUndefined();
    expect(t.state.current!.grids.orders!.sorts).toEqual([{ field: 'status', direction: 'desc' }]);
  });

  test('a toggle made before the joined marts are read keeps a parked joined path', async () => {
    const t = setup({ blendFails: true, grid: { columns: ['id', 'status', 'customers__name'], filters: {}, sorts: null, limit: 200, uniqueCount: ['customers'] } });
    await t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status']));
    await userEvent.click((await picker('Orders')).getByRole('option', { name: 'Unique Count' }));
    await waitFor(() => expect(headers()).toContain('Unique Count'));
    await waitFor(() => expect(t.state.current!.grids.orders!.uniqueCount).toEqual(['customers', '']));
    expect(t.of('orders').at(-1)!.o.uniqueCount).toEqual(['']);
  });
});
