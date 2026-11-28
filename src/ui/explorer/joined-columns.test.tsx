import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore } from '../../state/store';
import { App } from '../App';
import { SAVED_COLUMNS_WAIT_MS } from './SeededGrid';
import { closeConfigMenu, openColumnMenu, openConfigMenu, openFields, openSubmenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;
const BLEND = '/api/data-marts/orders/blendable-schema';

function setup(saved: string[] | null, opts: { blendFails?: boolean; blendGate?: Promise<void>; repeats?: string; empty?: string[]; slowStoreMs?: number } = {}) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: { id: string; o: TraverseOptions }[] = [];
  const reads: string[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const realGet = base.owox.getJson.bind(base.owox);
  const spied: Mock = {
    ...base,
    owox: {
      ...base.owox,
      dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { queries.push({ id, o }); return real(id, o); } },
      getJson: (<T,>(path: string, query?: Record<string, string>) => {
        if (path.endsWith('/blendable-schema')) {
          reads.push(path);
          if (opts.blendFails) return Promise.reject(new Error('blendable boom'));
          if (opts.blendGate) return opts.blendGate.then(() => realGet<T>(path, query));
        }
        return realGet<T>(path, query);
      }) as Mock['owox']['getJson'],
    },
  };
  const put = vi.fn();
  const ctx: Ctx = { ...spied, collections: <T,>(name: string) => {
    const c = spied.collections<T>(name);
    return name === GRID_COLUMNS_COLLECTION ? { get: opts.slowStoreMs ? (id: string) => new Promise<Awaited<ReturnType<typeof c.get>>>((res) => setTimeout(() => res(c.get(id)), opts.slowStoreMs)) : c.get, put: (id: string, d: T) => { put(id, d); return c.put(id, d); } } : c;
  } };
  const seeded = saved ? spied.collections<{ columns: string[]; gridView?: unknown }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: saved, ...(opts.empty ? { gridView: { fl: [], s: null, l: 50, ep: opts.empty } } : {}) }) : Promise.resolve();
  const view = () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  const orderQueries = () => queries.filter((q) => q.id === 'orders' && q.o.column && q.o.column.length > 1);
  return { ctx, view, queries, reads, put, seeded, orderQueries };
}

const data = () => document.getElementById('band-data')!;
const titleHeaders = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup');
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const headers = () => titleHeaders().map((h) => h.textContent);
const openPicker = (mart = 'Orders') => openFields(mart);

test('the joined data marts are read when a mart becomes main, once per mart, and the picker opening asks nothing more', async () => {
  const t = setup(null);
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(5));
  await waitFor(() => expect(t.reads).toEqual([BLEND]));
  await new Promise((r) => setTimeout(r, 100));
  await openPicker();
  await screen.findByLabelText('status');
  await userEvent.keyboard('{Escape}');
  await openPicker();
  expect(t.reads).toEqual([BLEND]);
});

test('the Orders tab lists only Orders\' own fields: no joined group, and nothing is read', async () => {
  const t = setup(null);
  t.view();
  await openPicker();
  const picker = within(await screen.findByRole('dialog'));
  // Its own fields, after the mart's Unique Count row.
  expect(picker.getAllByRole('option')).toHaveLength(11);
  expect(picker.queryByRole('button', { name: /^Customers/ })).toBeNull();
  expect(t.reads).toEqual([BLEND]);
});

test('a joined tab lists that mart\'s fields with a count, each with its description, and ticking one adds a column to its group', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await openPicker('Customers');
  const picker = within(await screen.findByRole('dialog'));
  expect(picker.getAllByRole('option').map((c) => c.textContent)).toEqual(['Unique Count', 'city', 'Country', 'email', 'id', 'name']);
  expect(picker.queryByText(/Fields ·/)).toBeNull();
  expect(picker.getByLabelText('About name')).toBeInTheDocument();
  await userEvent.click(picker.getByLabelText('city'));
  await waitFor(() => expect(headers()).toEqual(['id', 'email', 'city']));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.column).toContain('customers__city'));
  const at = headers().indexOf('city');
  await waitFor(() => expect(bodyRows()[0]!.querySelectorAll('td')[at]!.textContent).toBeTruthy());
});

test('Clear in a joined mart\'s picker only unticks: the mart stays in the config menu and a tick afterwards brings its column back', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await openPicker('Customers');
  const picker = within(await screen.findByRole('dialog'));
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  expect(picker.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  // The column is gone at once, the mart is not.
  await waitFor(() => expect(headers()).toEqual(['id']));
  await userEvent.click(picker.getByLabelText('city'));
  await waitFor(() => expect(headers()).toEqual(['id', 'city']));
});

test('Clear in a joined mart\'s picker keeps the mart after the menu closes, and a reload finds it: Remove from report is the way out', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  const first = t.view();
  await openPicker('Customers');
  const picker = within(await screen.findByRole('dialog'));
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(headers()).toEqual(['id']));
  await closeConfigMenu();
  expect(headers()).toEqual(['id']);
  // The empty mart is saved with the view (after the save pause) and read back by a fresh page.
  await waitFor(() => expect(t.put.mock.calls.some(([id, d]) => id === 'orders' && JSON.stringify(d).includes('"ep":["customers"]'))).toBe(true), { timeout: SAVE_DEBOUNCE_MS + 3000 });
  first.unmount();
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id']));
  const menu = await openConfigMenu();
  expect(within(menu).getByRole('menuitem', { name: 'Customers' })).toBeInTheDocument();
  await closeConfigMenu();
  const panel = await openPicker('Customers');
  await userEvent.click(within(panel).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Configure data' })).toBeNull());
  const again = await openConfigMenu();
  expect(within(again).queryByRole('menuitem', { name: 'Customers' })).toBeNull();
});

test('Clear in the main mart\'s picker leaves only the joined columns; the mart stays listed first and a tick brings a column back', async () => {
  const t = setup(['id', 'status', 'customers__email']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'email']));
  const picker = within(await openPicker());
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(headers()).toEqual(['email']));
  await userEvent.keyboard('{Escape}{Escape}');
  const menu = await openConfigMenu();
  expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)[0]).toBe('Orders');
  const again = within(await openPicker());
  expect(again.getAllByRole('option').filter((o) => o.getAttribute('aria-selected') === 'true')).toHaveLength(0);
  await userEvent.click(again.getByLabelText('status'));
  await waitFor(() => expect(headers()).toEqual(['status', 'email']));
});

test('Remove from report on a main mart with no column promotes the joined mart', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  const picker = within(await openPicker());
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(headers()).toEqual(['email']));
  await userEvent.click(picker.getByRole('menuitem', { name: 'Remove from report' }));
  await userEvent.keyboard('{Escape}{Escape}');
  await waitFor(async () => expect(within(await openConfigMenu()).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Customers']));
});

test('the last own column of the main mart can be unticked while a joined mart is shown', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  const picker = within(await openPicker());
  await userEvent.click(picker.getByLabelText('id'));
  await waitFor(() => expect(headers()).toEqual(['email']));
});

test('Clear in the main mart\'s picker still leaves a column', async () => {
  const t = setup(['id', 'status']);
  await t.seeded;
  t.view();
  await openPicker();
  const picker = within(await screen.findByRole('dialog'));
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(headers().length).toBe(1));
});

test('a joined column filters and sorts by its blended name, with the filters its own type has', async () => {
  const t = setup(['id', 'customers__email', 'stores__city']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'email', 'city']));
  await openSubmenu(within(data()), 'Stores · city', 'Filter');
  expect(await screen.findByRole('option', { name: 'contains' })).toBeInTheDocument(); // a string: the string operators
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
  await userEvent.type(screen.getByLabelText('Value'), 'Berlin');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.filter).toEqual([{ column: 'stores__city', operator: 'eq', value: 'Berlin' }]));
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Customers · email,/ }));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.sort).toEqual([{ column: 'customers__email', direction: 'asc' }, { column: 'id', direction: 'asc' }]));
  const at = headers().indexOf('city');
  await waitFor(() => {
    const rows = bodyRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.querySelectorAll('td')[at]!.textContent === 'Berlin')).toBe(true);
  });
});

test('saved columns may name joined fields: the joined marts are read first and the first rows query already asks for them', async () => {
  const t = setup(['id', 'status', 'products__sku']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'SKU']));
  expect(t.reads).toEqual([BLEND]);
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
  expect(t.orderQueries()).toHaveLength(1);
  expect(t.orderQueries()[0]!.o.column).toEqual(['id', 'status', 'products__sku']);
  await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 200)); // past the save debounce
  expect(t.put).not.toHaveBeenCalled();
});

test('a saved joined name the schema no longer offers is dropped, and the cleaned list is saved', async () => {
  const t = setup(['id', 'customers__email', 'customers__gone', 'status']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'email']));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'status', 'customers__email'] }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
});

test('when the joined marts cannot be read, a saved joined column is left out of this visit without erasing it', async () => {
  const t = setup(['id', 'status', 'customers__email'], { blendFails: true });
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 200));
  expect(t.put).not.toHaveBeenCalled();
  await openPicker();
  // the own fields still work
  await userEvent.click(screen.getByRole('option', { name: /amount/i }));
  await waitFor(() => expect(headers()).toContain('Amount'));
});

test('a joined column is in the Data band only: the Row band lists the mart\'s own fields', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(bodyRows()[0]!);
  const row = document.getElementById('band-row')!;
  await within(row).findByText('status');
  expect(within(row).queryByText(/email/)).toBeNull();
});

test('a filter popover the reader has open stays open when the joined marts arrive', async () => {
  let release: () => void = () => {};
  const t = setup(null, { blendGate: new Promise<void>((r) => { release = r; }) });
  t.view();
  await openPicker();
  await closeConfigMenu();
  await openSubmenu(within(data()), 'status', 'Filter');
  expect(await screen.findByLabelText('Operator')).toBeInTheDocument();
  release();
  await waitFor(() => expect(t.reads).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 150));
  expect(screen.getByLabelText('Operator')).toBeInTheDocument();
});

test('a saved filter on a joined field that could not be read is not applied this visit, and stays in the kept copy', async () => {
  const t = setup(null, { blendFails: true });
  const state: { current: ReturnType<typeof useStore>[0] | null } = { current: null };
  function Probe() {
    const [s, dispatch] = useStore();
    state.current = s;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid: { columns: ['id', 'status'], filters: { customers__email: { field: 'customers__email', op: 'contains', value: 'anna' } }, sorts: null, limit: 200 } }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={t.ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
  expect(within(data()).getByRole('button', { name: 'Reset' })).toBeDisabled();
  expect(t.orderQueries().every((q) => !q.o.filter)).toBe(true);
  expect(state.current!.grids.orders!.filters.customers__email).toBeDefined();
});

test('a saved list that interleaves the marts shows grouped and is saved grouped', async () => {
  const t = setup(['id', 'customers__email', 'products__sku', 'customers__city']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'email', 'city', 'SKU']));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'customers__email', 'customers__city', 'products__sku'] }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
});

test('a saved list with joined columns and none of the main mart\'s own stays without one', async () => {
  const t = setup(['customers__email', 'products__sku']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['email', 'SKU']));
  // An untick is saved after the pause: no saved column list holds a column of the main mart (the restore did not add one back).
  await openPicker('Customers');
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(t.put).toHaveBeenCalled(), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  const saved = t.put.mock.calls.flatMap(([id, d]) => (id === 'orders' ? ['orders'] : (d as { columns: string[] }).columns));
  expect(saved.filter((c) => ['orders', 'id', 'status', 'amount'].includes(c))).toEqual([]);
  expect(headers()).toEqual(['SKU']);
});

test('Hide column focuses the neighbour by field, even when two columns share a title', async () => {
  const t = setup(['id', 'customers__id', 'status']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'id']));
  const icons = () => [...data().querySelectorAll<HTMLElement>('[data-menu-icon]')];
  await waitFor(() => expect(icons().map((i) => i.dataset.field)).toEqual(['id', 'status', 'customers__id']));
  await userEvent.click(icons()[1]!);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(document.activeElement).toBe(icons().find((i) => i.dataset.field === 'customers__id')));
  expect(document.activeElement).not.toBe(icons().find((i) => i.dataset.field === 'id'));
});

describe('a saved empty mart is read back whenever the joined marts arrive', () => {
  const savedWithEp = (t: ReturnType<typeof setup>) => t.put.mock.calls.some(([id, d]) => id === 'orders' && JSON.stringify(d).includes('"ep":["customers"]'));
  const toCharts = () => userEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  const lists = async () => { const menu = await openConfigMenu(); const names = within(menu).getAllByRole('menuitem').map((r) => r.textContent); await closeConfigMenu(); return names; };

  test('joins slower than the saved columns: the mart is listed and a later edit still saves it', async () => {
    let release: () => void = () => undefined;
    const t = setup(['id'], { empty: ['customers'], blendGate: new Promise<void>((r) => { release = r; }) });
    await t.seeded;
    t.view();
    await new Promise((r) => setTimeout(r, 400));
    release();
    await waitFor(async () => expect(await lists()).toContain('Customers'));
    await toCharts();
    await waitFor(() => expect(savedWithEp(t)).toBe(true), { timeout: SAVE_DEBOUNCE_MS + 3000 });
  });

  test('joins that cannot be read: the path is parked and an edit still saves it', async () => {
    const t = setup(['id'], { empty: ['customers'], blendFails: true });
    await t.seeded;
    t.view();
    await waitFor(() => expect(headers()).toEqual(['id']));
    await toCharts();
    await waitFor(() => expect(savedWithEp(t)).toBe(true), { timeout: SAVE_DEBOUNCE_MS + 3000 });
  });

  test('the saved view is read after the wait and the joins are still unread: the mart is listed once they arrive, and an edit saves it', async () => {
    let release: () => void = () => undefined;
    const t = setup(['id'], { empty: ['customers'], slowStoreMs: SAVED_COLUMNS_WAIT_MS + 400, blendGate: new Promise<void>((r) => { release = r; }) });
    await t.seeded;
    t.view();
    // Past the wait the grid opens with the defaults; the saved view comes late, with the joins still unread.
    await waitFor(() => expect(headers()).toHaveLength(5), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 800));
    release();
    await waitFor(async () => expect(await lists()).toContain('Customers'), { timeout: 5000 });
    await toCharts();
    await waitFor(() => expect(savedWithEp(t)).toBe(true), { timeout: SAVE_DEBOUNCE_MS + 3000 });
  }, 20000);

  test('joins slower than the wait: the saved native columns paint at once, and an edit saves them with the empty mart kept', async () => {
    let release: () => void = () => undefined;
    const t = setup(['id', 'status'], { empty: ['customers'], blendGate: new Promise<void>((r) => { release = r; }) });
    await t.seeded;
    t.view();
    await waitFor(() => expect(headers()).toEqual(['id', 'status']));
    await new Promise((r) => setTimeout(r, SAVED_COLUMNS_WAIT_MS + 500));
    expect(headers()).toEqual(['id', 'status']);
    const menu = await openColumnMenu(within(data()), 'id');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(headers()).toEqual(['status']));
    await waitFor(() => expect(t.put.mock.calls.some(([id, d]) => id === 'orders' && JSON.stringify(d.columns) === '["status"]' && JSON.stringify(d).includes('"ep":["customers"]'))).toBe(true), { timeout: SAVE_DEBOUNCE_MS + 3000 });
    release();
  }, 20000);
});
