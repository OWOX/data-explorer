import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function mountApp() {
  render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
}

// userEvent.click on a canvas card crashes d3-drag in jsdom (mousedown with view=null), so cards are clicked with fireEvent.
async function openOrders() {
  mountApp();
  fireEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  await within(panel).findByRole('table');
  return panel;
}

test('mart tab shows the first 5 columns and 200 rows with load more', async () => {
  const panel = await openOrders();
  const headers = within(panel).getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toHaveLength(5);
  expect(within(panel).getAllByRole('row')).toHaveLength(201); // header + 200
  await userEvent.click(within(panel).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(401));
});

test('relationship column shows the customer name and opens the customer record', async () => {
  const panel = await openOrders();
  const nameCell = await waitFor(() => {
    const c = within(panel).getAllByRole('cell').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
    expect(c).toBeDefined();
    return c!;
  });
  await userEvent.click(within(nameCell).getByRole('button'));
  const tabs = screen.getAllByRole('tab');
  expect(tabs.at(-1)!.textContent).toMatch(/^Customers: \d+/);
});

test('filter then reset', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByLabelText('Filter id'));
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
  await userEvent.type(screen.getByLabelText('Value'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(4));
  await userEvent.click(within(panel).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(201));
});

test('column picker adds a column', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByRole('button', { name: /Columns \(5\/8\)/ }));
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(within(panel).getAllByRole('columnheader')).toHaveLength(6));
});

test('a mart without a primary key is preview only', async () => {
  mountApp();
  await userEvent.type(await screen.findByLabelText('Search data marts'), 'daily');
  fireEvent.click(await screen.findByText('Daily KPIs'));
  expect(await screen.findByText('Preview only: this data mart has no primary key.')).toBeInTheDocument();
});

test('closing the last tab returns to the full canvas', async () => {
  await openOrders();
  await userEvent.click(screen.getByLabelText(/^Close Orders/));
  await waitFor(() => expect(screen.queryByTestId('explorer')).toBeNull());
});

function mountWith(wrap: (ctx: ReturnType<typeof createMockCtx>) => ReturnType<typeof createMockCtx>) {
  render(<AppServices ctx={wrap(createMockCtx(demoFixtures()))}><StoreProvider><App /></StoreProvider></AppServices>);
}

async function openOrderRecord() {
  fireEvent.click(await screen.findByText('Orders'));
  const grid = await screen.findByRole('tabpanel');
  const table = await within(grid).findByRole('table');
  await userEvent.click(within(table).getAllByRole('cell').find((c) => c.textContent === '1')!);
  await waitFor(() => expect(screen.getAllByRole('tab').at(-1)!.textContent).toMatch(/^Orders: 1/));
  return (await screen.findAllByRole('tabpanel')).at(-1)!;
}

test('a record still renders when a related title lookup fails', async () => {
  mountWith((ctx) => {
    const real = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
    return { ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id, o) => (id === 'customers' ? Promise.reject(new Error('boom')) : real(id, o)) } } };
  });
  const panel = await openOrderRecord();
  expect(await within(panel).findByText('status')).toBeInTheDocument();
  expect(within(panel).queryByText(/boom/)).toBeNull();
});

test('Refresh on a record shows the progress bar', async () => {
  mountWith((ctx) => {
    const real = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
    return { ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: async (id, o) => { if (o.limit === 1) await new Promise((r) => setTimeout(r, 50)); return real(id, o); } } } };
  });
  const panel = await openOrderRecord();
  await within(panel).findByText('status');
  expect(within(panel).queryByRole('progressbar')).toBeNull();
  await userEvent.click(within(panel).getByRole('button', { name: 'Refresh' }));
  expect(within(panel).getByRole('progressbar')).toBeInTheDocument();
  await waitFor(() => expect(within(panel).queryByRole('progressbar')).toBeNull());
});

test('the grid id cell is plain text, and a row click opens the record', async () => {
  const panel = await openOrders();
  const idCell = within(panel).getAllByRole('row')[1]!.querySelector('td')!;
  expect(within(idCell).queryByRole('button')).toBeNull();
  await userEvent.click(idCell);
  await waitFor(() => expect(screen.getAllByRole('tab').at(-1)!.textContent).toMatch(/^Orders: 1/));
});

test('a record lists every mart that references it, and a click opens that mart filtered', async () => {
  mountApp();
  const record = await openOrderRecord();
  const section = await within(record).findByRole('region', { name: 'Referenced by' });
  const names = within(section).getAllByRole('button').map((b) => b.textContent);
  expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/Order Items.*via order_id/), expect.stringMatching(/Returns.*via order_id/), expect.stringMatching(/Payments.*via order_id/), expect.stringMatching(/Shipments.*via order_id/)]));
  expect(names).toHaveLength(4);
  const entry = within(section).getByRole('button', { name: /Order Items/ });
  await waitFor(() => expect(entry).toBeEnabled());
  await userEvent.click(entry);
  expect(screen.getAllByRole('tab').at(-1)!.textContent).toBe('Order Items');
  const items = (await screen.findAllByRole('tabpanel')).find((p) => !p.hidden)!;
  // the order_id = 1 filter is applied (seeded data may have no such item, so rows are not asserted)
  await waitFor(() => expect(within(items).getByRole('button', { name: 'Reset' })).toBeEnabled());
});

test('a record nobody references has no Referenced by section', async () => {
  mountApp();
  await userEvent.type(await screen.findByLabelText('Search data marts'), 'order items');
  fireEvent.click(await screen.findByText('Order Items'));
  const grid = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(1));
  await userEvent.click(within(grid).getAllByRole('row')[1]!);
  await waitFor(() => expect(screen.getAllByRole('tab').at(-1)!.textContent).toMatch(/^Order Items: 1/));
  const record = (await screen.findAllByRole('tabpanel')).at(-1)!;
  await within(record).findByText('order_id');
  expect(within(record).queryByRole('region', { name: 'Referenced by' })).toBeNull();
});

function spyOnTraverse() {
  const calls: { id: string; o: Parameters<ReturnType<typeof createMockCtx>['owox']['dataMarts']['traverseData']>[1] }[] = [];
  mountWith((ctx) => {
    const real = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
    return { ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id, o) => { calls.push({ id, o }); return real(id, o); } } } };
  });
  return calls;
}
const settle = () => new Promise((r) => setTimeout(r, 150));

test('a filter with no matches keeps the header, so the filter can be cleared', async () => {
  mountApp();
  fireEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  await within(panel).findByRole('table');
  await userEvent.click(within(panel).getByLabelText('Filter id'));
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
  await userEvent.type(screen.getByLabelText('Value'), '999999');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(await within(panel).findByText('No rows match the filters.')).toBeInTheDocument();
  expect(within(panel).getAllByRole('columnheader')).toHaveLength(5);
  await userEvent.click(within(panel).getByLabelText('Filter id'));
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(201));
});

test('a failed read keeps the header and shows the error in the body', async () => {
  mountWith((ctx) => ({ ...ctx, owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id, o) => (o.limit === 201 ? Promise.reject(new Error('read failed')) : ctx.owox.dataMarts.traverseData(id, o)) } } }));
  fireEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  expect(await within(panel).findByText('read failed')).toBeInTheDocument();
  expect(within(panel).getAllByRole('columnheader')).toHaveLength(5);
  expect(within(panel).getByLabelText('Filter id')).toBeInTheDocument();
});

test('hiding a column does not read the mart again', async () => {
  const calls = spyOnTraverse();
  fireEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(201));
  await settle();
  const before = calls.filter((c) => c.id === 'orders').length;
  await userEvent.click(within(panel).getByRole('button', { name: /Columns \(5\/8\)/ }));
  await userEvent.click(screen.getAllByRole('checkbox').find((c) => (c as HTMLInputElement).checked && /status|total|amount/i.test(c.parentElement?.textContent ?? '')) ?? screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).at(-1)!);
  await waitFor(() => expect(within(panel).getAllByRole('columnheader')).toHaveLength(4));
  await settle();
  expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before);
});

test('Load more looks titles up only for values not seen yet', async () => {
  const calls = spyOnTraverse();
  const panel = await (async () => { fireEvent.click(await screen.findByText('Orders')); const p = await screen.findByRole('tabpanel'); await waitFor(() => expect(within(p).getAllByRole('row')).toHaveLength(201)); return p; })();
  await waitFor(() => expect(calls.some((c) => c.id === 'customers' && c.o.filter?.[0]?.operator === 'in')).toBe(true));
  await settle();
  const lookups = () => calls.filter((c) => c.id === 'customers' && c.o.filter?.[0]?.operator === 'in').map((c) => (c.o.filter![0] as unknown as { value: number[] }).value);
  const first = lookups().flat();
  expect(first.length).toBeGreaterThan(0);
  await userEvent.click(within(panel).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(401));
  await settle();
  const afterLoadMore = lookups().flat().slice(first.length);
  expect(afterLoadMore.length).toBeGreaterThan(0);
  expect(afterLoadMore.every((v) => !first.includes(v))).toBe(true);
});

test('a model refresh with identical edges does not re-read an open record', async () => {
  const calls = spyOnTraverse();
  await openOrderRecord();
  await settle();
  const recordReads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 1).length;
  const before = recordReads();
  expect(before).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh model' }));
  await settle();
  await settle();
  expect(recordReads()).toBe(before);
});
