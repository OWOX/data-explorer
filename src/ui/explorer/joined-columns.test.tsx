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
import { openSubmenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;
const BLEND = '/api/data-marts/orders/blendable-schema';

function setup(saved: string[] | null, opts: { blendFails?: boolean; blendGate?: Promise<void>; repeats?: string } = {}) {
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
    return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { put(id, d); return c.put(id, d); } } : c;
  } };
  const seeded = saved ? spied.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: saved, at: 'then' }) : Promise.resolve();
  const view = () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  const orderQueries = () => queries.filter((q) => q.id === 'orders' && q.o.column && q.o.column.length > 1);
  return { ctx, view, queries, reads, put, seeded, orderQueries };
}

const data = () => document.getElementById('band-data')!;
const titleHeaders = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup');
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const headers = () => titleHeaders().map((h) => h.textContent);
const openPicker = async (mart = 'Orders') => { const name = `Fields of ${mart}`; await waitFor(() => expect(within(data()).getByRole('button', { name })).toBeInTheDocument()); await userEvent.click(within(data()).getByRole('button', { name })); };

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
  expect(picker.getAllByRole('option').map((c) => c.textContent)).toEqual(['Unique Count', 'id', 'name', 'email', 'city', 'Country']);
  expect(picker.queryByText(/Fields ·/)).toBeNull();
  expect(picker.getByLabelText('About name')).toBeInTheDocument();
  await userEvent.click(picker.getByLabelText('city'));
  await waitFor(() => expect(headers()).toEqual(['id', 'email', 'city']));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.column).toContain('customers__city'));
  const at = headers().indexOf('city');
  await waitFor(() => expect(bodyRows()[0]!.querySelectorAll('td')[at]!.textContent).toBeTruthy());
});

test('Clear in a joined mart\'s picker only unticks: a tick afterwards keeps the mart', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await openPicker('Customers');
  const picker = within(await screen.findByRole('dialog'));
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  expect(picker.getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  // The mart is still on the grid while the popup is open.
  expect(headers()).toEqual(['id', 'email']);
  await userEvent.click(picker.getByLabelText('city'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(headers()).toEqual(['id', 'city']));
});

test('Clear in a joined mart\'s picker removes the mart only when the popup closes with nothing ticked', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await openPicker('Customers');
  const picker = within(await screen.findByRole('dialog'));
  await userEvent.click(picker.getByRole('button', { name: 'Clear' }));
  expect(headers()).toEqual(['id', 'email']);
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(headers()).toEqual(['id']));
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
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'status', 'customers__email'], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
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
  await userEvent.keyboard('{Escape}');
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
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'customers__email', 'customers__city', 'products__sku'], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
});

test('a saved list with joined columns and none of the main mart\'s own gets the main mart\'s default columns first', async () => {
  const t = setup(['customers__email', 'products__sku']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['Customer', 'Product', 'Store', 'status', 'Amount', 'email', 'SKU']));
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
