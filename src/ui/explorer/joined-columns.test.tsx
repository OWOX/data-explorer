import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

type Mock = ReturnType<typeof createMockCtx>;
const BLEND = '/api/data-marts/orders/blendable-schema';

function setup(saved: string[] | null, opts: { blendFails?: boolean } = {}) {
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
        if (path.endsWith('/blendable-schema')) { reads.push(path); if (opts.blendFails) return Promise.reject(new Error('blendable boom')); }
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
  return { view, queries, reads, put, seeded, orderQueries };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden')).map((h) => h.textContent);
const openPicker = async () => { await waitFor(() => expect(within(data()).getByRole('button', { name: /^Columns/ })).toBeInTheDocument()); await userEvent.click(within(data()).getByRole('button', { name: /^Columns/ })); };

test('the joined data marts are read only when the Columns picker first opens, once per mart', async () => {
  const t = setup(null);
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(5));
  await new Promise((r) => setTimeout(r, 100));
  expect(t.reads).toEqual([]);
  await openPicker();
  await screen.findByRole('button', { name: /^Customers/ });
  await userEvent.keyboard('{Escape}');
  await openPicker();
  expect(t.reads).toEqual([BLEND]);
});

test('the picker lists the own fields first, then one folded group per joined mart, shallow ones first, told apart by their path', async () => {
  const t = setup(null);
  t.view();
  await openPicker();
  await screen.findByRole('button', { name: /^Customers/ });
  const picker = within(screen.getByRole('dialog'));
  const names = picker.getAllByRole('button').filter((b) => b.hasAttribute('aria-expanded')).map((b) => b.textContent!.replace(/\d+\/\d+$/, ''));
  expect(names).toEqual(['Customers', 'Products', 'Stores', 'Categories', 'Countries (customers.countries)', 'Countries (stores.countries)']);
  for (const b of picker.getAllByRole('button')) expect(b).toHaveAttribute('aria-expanded', 'false');
  // folded: none of the joined fields is a checkbox yet
  expect(screen.queryByLabelText('email')).toBeNull();
  // the own fields come before the first group
  expect(picker.getAllByRole('checkbox')).toHaveLength(10);
});

test('a group shows how many of its fields are ticked, and its fields carry a (?) with the description', async () => {
  const t = setup(null);
  t.view();
  await openPicker();
  const customers = await screen.findByRole('button', { name: /^Customers/ });
  expect(customers).toHaveTextContent('0/5');
  await userEvent.click(customers);
  expect(customers).toHaveAttribute('aria-expanded', 'true');
  const fields = within(screen.getByRole('group', { name: 'Customers' }));
  expect(fields.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent)).toEqual(['id', 'name', 'email', 'city', 'Country']);
  expect(fields.getByLabelText('About name')).toBeInTheDocument();
  await userEvent.click(fields.getByLabelText('email'));
  await waitFor(() => expect(customers).toHaveTextContent('1/5'));
});

test('a ticked joined field becomes a column headed by its mart and label, with real values, and the query asks for the blended name', async () => {
  const t = setup(null);
  t.view();
  await openPicker();
  await userEvent.click(await screen.findByRole('button', { name: /^Customers/ }));
  await userEvent.click(within(screen.getByRole('group', { name: 'Customers' })).getByLabelText('email'));
  await waitFor(() => expect(headers()).toContain('Customers · email'));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.column).toContain('customers__email'));
  const at = headers().indexOf('Customers · email');
  await waitFor(() => expect(within(data()).getAllByRole('row')[1]!.querySelectorAll('td')[at]!.textContent).toMatch(/^[a-z]+\.[a-z]+\d+@example\.com$/));
  expect(screen.getByRole('button', { name: /^Columns \(5\/10 \+1\)/ })).toBeInTheDocument();
});

test('a joined column filters and sorts by its blended name, with the filters its own type has', async () => {
  const t = setup(['id', 'customers__email', 'stores__city']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'Customers · email', 'Stores · city']));
  await userEvent.click(within(data()).getByLabelText('Filter Stores · city'));
  expect(await screen.findByRole('option', { name: 'contains' })).toBeInTheDocument(); // a string: the string operators
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
  await userEvent.type(screen.getByLabelText('Value'), 'Berlin');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.filter).toEqual([{ column: 'stores__city', operator: 'eq', value: 'Berlin' }]));
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Customers · email,/ }));
  await waitFor(() => expect(t.orderQueries().at(-1)!.o.sort).toEqual([{ column: 'customers__email', direction: 'asc' }, { column: 'id', direction: 'asc' }]));
  const at = headers().indexOf('Stores · city');
  await waitFor(() => {
    const rows = within(data()).getAllByRole('row').slice(1);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.querySelectorAll('td')[at]!.textContent === 'Berlin')).toBe(true);
  });
});

test('saved columns may name joined fields: the joined marts are read first and the first rows query already asks for them', async () => {
  const t = setup(['id', 'status', 'products__sku']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'Products · SKU']));
  expect(t.reads).toEqual([BLEND]);
  await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
  expect(t.orderQueries()).toHaveLength(1);
  expect(t.orderQueries()[0]!.o.column).toEqual(['id', 'status', 'products__sku']);
  expect(t.put).not.toHaveBeenCalled();
});

test('a saved joined name the schema no longer offers is dropped, and the cleaned list is saved', async () => {
  const t = setup(['id', 'customers__email', 'customers__gone', 'status']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'Customers · email', 'status']));
  await waitFor(() => expect(t.put).toHaveBeenCalledWith('orders', { columns: ['id', 'customers__email', 'status'], at: expect.any(String) }), { timeout: SAVE_DEBOUNCE_MS + 1500 });
});

test('when the joined marts cannot be read, a saved joined column is left out of this visit without erasing it, and the picker says why', async () => {
  const t = setup(['id', 'status', 'customers__email'], { blendFails: true });
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 200));
  expect(t.put).not.toHaveBeenCalled();
  await openPicker();
  expect(await screen.findByText(/could not be read/)).toBeInTheDocument();
  // the own fields still work
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(headers()).toContain('Amount'));
});

test('a joined column is in the Data band only: the Row band lists the mart\'s own fields', async () => {
  const t = setup(['id', 'customers__email']);
  await t.seeded;
  t.view();
  await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
  await userEvent.click(within(data()).getAllByRole('row')[1]!);
  const row = document.getElementById('band-row')!;
  await within(row).findByText('status');
  expect(within(row).queryByText(/email/)).toBeNull();
});
