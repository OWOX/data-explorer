import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

type Mock = ReturnType<typeof createMockCtx>;

// The bands exist once the model has loaded.
async function mountWith(wrap: (ctx: Mock) => Ctx = (c) => c, fixtures = demoFixtures()) {
  const view = render(<AppServices ctx={wrap(createMockCtx(fixtures, { latencyMs: 0 }))}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  return view;
}
const mountApp = () => mountWith();

const band = (id: string) => document.getElementById(id)!;
const data = () => band('band-data');
const row = () => band('band-row');
const marts = () => band('band-marts');
const sources = () => band('band-sources');
const martCard = (title: string) => within(marts()).getByText(title).closest('article')!;

async function ordersGrid() {
  await mountApp();
  await within(data()).findByRole('table');
  await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(201));
  return data();
}

const overrideTraverse = (wrap: (real: Mock['owox']['dataMarts']['traverseData']) => Mock['owox']['dataMarts']['traverseData']) => (ctx: Mock): Ctx => ({
  ...ctx,
  owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: wrap(ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts)) } },
});

async function spyOnTraverse() {
  const calls: { id: string; o: Parameters<Mock['owox']['dataMarts']['traverseData']>[1] }[] = [];
  await mountWith(overrideTraverse((real) => (id, o) => { calls.push({ id, o }); return real(id, o); }));
  return calls;
}
const settle = () => new Promise((r) => setTimeout(r, 150));

describe('the four bands', () => {
  test('the first load selects Orders, shows its rows and the marts joined to it', async () => {
    const grid = await ordersGrid();
    expect(within(band('band-data')).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(data()).getByText('200+ rows')).toBeInTheDocument();
    expect(martCard('Orders')).toHaveAttribute('aria-pressed', 'true');
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    expect(within(data()).queryByText('Select a data mart.')).toBeNull();
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    expect(within(row()).getByRole('button', { name: /Back/ })).toBeDisabled();
  });

  test('a source click narrows the marts to what it feeds; clicking it again returns to the focus mart', async () => {
    await ordersGrid();
    const shopify = within(sources()).getByText('Shopify').closest('article')!;
    fireEvent.click(shopify);
    await waitFor(() => expect(within(marts()).queryByText('Sessions')).toBeNull());
    expect(shopify).toHaveAttribute('aria-pressed', 'true');
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    await waitFor(() => expect(within(marts()).queryByText('Order Items')).toBeNull()); // an SQL mart: not fed by the source; it shrinks away first
    expect(within(data()).getByText('Select a data mart.')).toBeInTheDocument();
    fireEvent.click(shopify);
    await waitFor(() => expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
    expect(shopify).toHaveAttribute('aria-pressed', 'false');
  });

  test('the Data Sources band lists the connectors', async () => {
    await ordersGrid();
    for (const name of ['Shopify', 'Google Analytics 4', 'Facebook Ads']) expect(within(sources()).getByText(name)).toBeInTheDocument();
  });

  test('a row click fills the Row band', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[1]!);
    expect(await within(row()).findByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    expect(await within(row()).findByText('status')).toBeInTheDocument();
  });

  test('the grid id cell is plain text', async () => {
    const grid = await ordersGrid();
    expect(within(within(grid).getAllByRole('row')[1]!.querySelector('td')!).queryByRole('button')).toBeNull();
  });

  test('three follows, then three Backs, return to each selection in order', async () => {
    const grid = await ordersGrid();
    const filterActive = () => within(data()).getByRole('button', { name: 'Reset' });
    const nameLink = async (scope: HTMLElement) => waitFor(() => {
      const b = within(scope).getAllByRole('button').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
      expect(b).toBeDefined();
      return b!;
    });
    // 1. a record target: Orders -> Customers record
    await userEvent.click(within(grid).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    await userEvent.click(await nameLink(row()));
    const customerHeading = await within(row()).findByRole('heading', { name: /^Customers · \d+$/ });
    // 2. a filtered target: Customers record -> Orders, filtered
    const section = await within(row()).findByRole('region', { name: 'Referenced by' });
    const entry = within(section).getByRole('button', { name: /^Orders/ });
    await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry);
    await within(data()).findByRole('heading', { name: 'Orders' });
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary'));
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    // 3. a record target again: a row, then its customer
    await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
    await userEvent.click(within(data()).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    await userEvent.click(await nameLink(row()));
    await within(row()).findByRole('heading', { name: /^Customers · \d+$/ });
    const back = () => userEvent.click(within(row()).getByRole('button', { name: /Back/ }));

    await back(); // the Orders record
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary');
    await back(); // Orders, filtered, no record
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary');
    expect(filterActive()).toBeEnabled();
    await back(); // the Customers record
    expect(await within(row()).findByRole('heading', { name: customerHeading.textContent! })).toBeInTheDocument();
    expect(within(data()).getByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(martCard('Customers')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a related title moves the selection, and Back restores it', async () => {
    const grid = await ordersGrid();
    const nameCell = await waitFor(() => {
      const c = within(grid).getAllByRole('cell').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
      expect(c).toBeDefined();
      return c!;
    });
    await userEvent.click(within(nameCell).getByRole('button'));
    expect(await within(data()).findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(await within(row()).findByRole('heading', { name: /^Customers · \d+$/ })).toBeInTheDocument();
    expect(martCard('Customers')).toHaveAttribute('aria-pressed', 'true');

    await userEvent.click(within(row()).getByRole('button', { name: /Back/ }));
    expect(await within(data()).findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(martCard('Orders')).toHaveAttribute('aria-pressed', 'true');
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    expect(within(row()).getByRole('button', { name: /Back/ })).toBeDisabled();
  });

  test('Alt+ArrowLeft goes back too', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
  });

  test('Alt+ArrowLeft typed in a field is the word-jump, not Back', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    fireEvent.keyDown(screen.getByLabelText('Search data marts'), { key: 'ArrowLeft', altKey: true });
    await settle();
    expect(within(row()).getByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
  });

  test('a connected mart the member cannot open shows as No access, and its Data band says so', async () => {
    const fixtures = demoFixtures();
    fixtures.edges.push({ id: 'e-orders-secret', sourceDataMartId: 'orders', targetDataMartId: 'secret_ledger', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] });
    await mountWith((c) => c, fixtures);
    await within(data()).findByRole('table');
    const card = (await within(marts()).findByText('Secret Ledger')).closest('article')!;
    expect(within(card).getByText('No access')).toBeInTheDocument();
    fireEvent.click(card);
    expect(await within(data()).findByText('You do not have access to this data mart')).toBeInTheDocument();
    expect(within(data()).queryByRole('table')).toBeNull();
  });
});

describe('the grid', () => {
  test('shows the first 5 columns and 200 rows with load more', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(401));
  });

  test('filter then reset', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(4));
    await userEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(201));
  });

  test('the column picker adds a column', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: /Columns \(5\/8\)/ }));
    await userEvent.click(screen.getByLabelText(/amount/i));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader')).toHaveLength(6));
  });

  test('going back to a mart restores its filters', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(4));
    fireEvent.click(martCard('Customers'));
    await within(data()).findByRole('heading', { name: 'Customers' });
    await userEvent.click(within(row()).getByRole('button', { name: /Back/ }));
    await within(data()).findByRole('heading', { name: 'Orders' });
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(4));
    expect(within(data()).getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  test('edits made on top of a followed filter survive a trip away and Back', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    const customerLink = await waitFor(() => {
      const b = within(row()).getAllByRole('button').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
      expect(b).toBeDefined();
      return b!;
    });
    await userEvent.click(customerLink);
    await within(data()).findByRole('heading', { name: 'Customers' });
    const section = await within(row()).findByRole('region', { name: 'Referenced by' });
    const entry = within(section).getByRole('button', { name: /^Orders/ });
    await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry); // Orders, filtered by customer_id
    await within(data()).findByRole('heading', { name: 'Orders' });
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary'));
    await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
    await userEvent.click(within(data()).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(data()).getByLabelText('Filter id')).toHaveClass('text-primary'));
    await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
    await userEvent.click(within(data()).getAllByRole('row')[1]!); // a row, then follow away
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    const link = await waitFor(() => {
      const b = within(row()).getAllByRole('button').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
      expect(b).toBeDefined();
      return b!;
    });
    await userEvent.click(link);
    await within(data()).findByRole('heading', { name: 'Customers' });
    await userEvent.click(within(row()).getByRole('button', { name: /Back/ }));
    await userEvent.click(within(row()).getByRole('button', { name: /Back/ }));
    await within(data()).findByRole('heading', { name: 'Orders' });
    await waitFor(() => expect(within(data()).getByLabelText('Filter id')).toHaveClass('text-primary'));
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary');
  });

  test('a mart without a primary key is preview only', async () => {
    await mountApp();
    await within(data()).findByRole('table');
    await userEvent.type(screen.getByLabelText('Search data marts'), 'daily');
    fireEvent.click(await within(marts()).findByText('Daily KPIs'));
    expect(await screen.findByText('Preview only: this data mart has no primary key.')).toBeInTheDocument();
  });

  test('a filter with no matches keeps the header, so the filter can be cleared', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
    await userEvent.type(screen.getByLabelText('Value'), '999999');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await within(grid).findByText('No rows match the filters.')).toBeInTheDocument();
    expect(within(grid).getAllByRole('columnheader')).toHaveLength(5);
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(201));
  });

  test('a failed read keeps the header and shows the error in the body', async () => {
    await mountWith(overrideTraverse((real) => (id, o) => (o.limit === 201 ? Promise.reject(new Error('read failed')) : real(id, o))));
    expect(await within(data()).findByText('read failed')).toBeInTheDocument();
    expect(within(data()).getAllByRole('columnheader')).toHaveLength(5);
    expect(within(data()).getByLabelText('Filter id')).toBeInTheDocument();
  });

  test('hiding a column does not read the mart again', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(201));
    await settle();
    const before = calls.filter((c) => c.id === 'orders').length;
    await userEvent.click(within(data()).getByRole('button', { name: /Columns \(5\/8\)/ }));
    await userEvent.click(screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).at(-1)!);
    await waitFor(() => expect(within(data()).getAllByRole('columnheader')).toHaveLength(4));
    await settle();
    expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before);
  });

  test('Load more looks titles up only for values not seen yet', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(201));
    await waitFor(() => expect(calls.some((c) => c.id === 'customers' && c.o.filter?.[0]?.operator === 'in')).toBe(true));
    await settle();
    const lookups = () => calls.filter((c) => c.id === 'customers' && c.o.filter?.[0]?.operator === 'in').map((c) => (c.o.filter![0] as unknown as { value: number[] }).value);
    const first = lookups().flat();
    expect(first.length).toBeGreaterThan(0);
    await userEvent.click(within(data()).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(401));
    await settle();
    const afterLoadMore = lookups().flat().slice(first.length);
    expect(afterLoadMore.length).toBeGreaterThan(0);
    expect(afterLoadMore.every((v) => !first.includes(v))).toBe(true);
  });

  test('titles still land when Load more arrives while the first lookup is pending', async () => {
    let first = true;
    await mountWith(overrideTraverse((real) => async (id, o) => {
      if (id === 'customers' && o.filter?.[0]?.operator === 'in' && first) { first = false; await new Promise((r) => setTimeout(r, 400)); }
      return real(id, o);
    }));
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(201));
    await userEvent.click(within(data()).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(401));
    const customerCol = within(data()).getAllByRole('columnheader').findIndex((h) => h.textContent?.includes('Customer'));
    await waitFor(() => {
      const cells = within(data()).getAllByRole('row').slice(1).map((r) => r.querySelectorAll('td')[customerCol]!.textContent ?? '');
      expect(cells.filter((c) => /^\d+$/.test(c.trim()))).toEqual([]);
    }, { timeout: 4000 });
  });
});

describe('the record', () => {
  async function openOrderRecord() {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('cell').find((c) => c.textContent === '1')!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    return row();
  }

  test('a record still renders when a related title lookup fails', async () => {
    await mountWith(overrideTraverse((real) => (id, o) => (id === 'customers' ? Promise.reject(new Error('boom')) : real(id, o))));
    await within(data()).findByRole('table');
    await userEvent.click(within(data()).getAllByRole('cell').find((c) => c.textContent === '1')!);
    expect(await within(row()).findByText('status')).toBeInTheDocument();
    expect(within(row()).queryByText(/boom/)).toBeNull();
  });

  test('Refresh on a record shows the progress bar', async () => {
    await mountWith(overrideTraverse((real) => async (id, o) => { if (o.limit === 1) await new Promise((r) => setTimeout(r, 50)); return real(id, o); }));
    await within(data()).findByRole('table');
    await userEvent.click(within(data()).getAllByRole('cell').find((c) => c.textContent === '1')!);
    await within(row()).findByText('status');
    expect(within(row()).queryByRole('progressbar')).toBeNull();
    await userEvent.click(within(row()).getByRole('button', { name: 'Refresh' }));
    expect(within(row()).getByRole('progressbar')).toBeInTheDocument();
    await waitFor(() => expect(within(row()).queryByRole('progressbar')).toBeNull());
  });

  test('lists every mart that references it, and a click opens that mart filtered', async () => {
    const record = await openOrderRecord();
    const section = await within(record).findByRole('region', { name: 'Referenced by' });
    const names = within(section).getAllByRole('button').map((b) => b.textContent);
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/Order Items.*via order_id/), expect.stringMatching(/Returns.*via order_id/), expect.stringMatching(/Payments.*via order_id/), expect.stringMatching(/Shipments.*via order_id/)]));
    expect(names).toHaveLength(4);
    const entry = within(section).getByRole('button', { name: /Order Items/ });
    await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry);
    expect(await within(data()).findByRole('heading', { name: 'Order Items' })).toBeInTheDocument();
    await waitFor(() => expect(within(data()).getByRole('button', { name: 'Reset' })).toBeEnabled());
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
  });

  test('a record nobody references has no Referenced by section', async () => {
    await mountApp();
    await within(data()).findByRole('table');
    await userEvent.type(screen.getByLabelText('Search data marts'), 'order items');
    fireEvent.click(await within(marts()).findByText('Order Items'));
    await within(data()).findByRole('heading', { name: 'Order Items' });
    await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1));
    await userEvent.click(within(data()).getAllByRole('row')[1]!);
    await within(row()).findByRole('heading', { name: /^Order Items · 1$/ });
    await within(row()).findByText('order_id');
    expect(within(row()).queryByRole('region', { name: 'Referenced by' })).toBeNull();
  });

  test('a header Refresh re-reads the open record once, and nothing else does', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await userEvent.click(within(data()).getAllByRole('cell').find((c) => c.textContent === '1')!);
    await within(row()).findByText('status');
    await settle();
    const recordReads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 1).length;
    const before = recordReads();
    expect(before).toBeGreaterThan(0);
    const gridReads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 201).length;
    const gridBefore = gridReads();
    await userEvent.click(screen.getByRole('button', { name: 'Refresh model' }));
    await settle();
    await settle();
    expect(recordReads()).toBe(before + 1);
    expect(gridReads()).toBe(gridBefore + 1);
    // Nothing else re-reads: a hover, a search that hides nothing relevant, or a second settle.
    await userEvent.type(screen.getByLabelText('Search data marts'), 'a');
    await settle();
    expect(recordReads()).toBe(before + 1);
    expect(gridReads()).toBe(gridBefore + 1);
  });
});

describe('search, contexts and refresh', () => {
  test('search narrows the marts, keeps the selection, and an empty match says so', async () => {
    await ordersGrid();
    await userEvent.type(screen.getByLabelText('Search data marts'), 'zzzz');
    expect(await within(marts()).findByText('No data marts match.')).toBeInTheDocument();
    expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Clear search'));
    expect(await within(marts()).findByText('Customers')).toBeInTheDocument();
  });

  test('a context chip filters to that context', async () => {
    await ordersGrid();
    await userEvent.click(within(screen.getByRole('group', { name: 'Contexts' })).getByText('Marketing'));
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Campaigns')).toBeInTheDocument();
  });

  test('a failed refresh keeps the bands and shows a retry in the header', async () => {
    const fail = { current: false };
    await mountWith((ctx) => ({ ...ctx, owox: { ...ctx.owox, storages: { list: async () => { if (fail.current) throw new Error('boom'); return ctx.owox.storages.list(); } } } }));
    await within(data()).findByRole('table');
    fail.current = true;
    await userEvent.click(screen.getByLabelText('Refresh model'));
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
    expect(within(data()).getByRole('table')).toBeInTheDocument();
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  test('a failed first load shows the full-screen error', async () => {
    const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
    render(<AppServices ctx={{ ...ctx, owox: { ...ctx.owox, storages: { list: async () => { throw new Error('down'); } } } }}><StoreProvider><App /></StoreProvider></AppServices>);
    expect(await screen.findByRole('alert')).toHaveTextContent('down');
    expect(screen.queryByLabelText('Search data marts')).toBeNull();
  });

  test('a selected mart that disappears after a refresh is replaced by the focus mart', async () => {
    const hide = { current: false };
    await mountWith((ctx) => ({
      ...ctx,
      owox: {
        ...ctx.owox,
        getJson: async <T,>(path: string, query?: Record<string, string>) => {
          const r = await ctx.owox.getJson<T>(path, query);
          if (hide.current && path === '/api/model-canvas/data-marts') {
            const page = r as unknown as { items: { id: string }[] };
            return { ...page, items: page.items.filter((i) => i.id !== 'customers') } as T;
          }
          return r;
        },
      },
    }));
    await within(data()).findByRole('table');
    fireEvent.click(martCard('Customers'));
    await within(data()).findByRole('heading', { name: 'Customers' });
    hide.current = true;
    await userEvent.click(screen.getByLabelText('Refresh model'));
    await waitFor(() => expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument());
    // The replacement left no history entry: Back steps to the earlier Orders selection and then stops.
    const back = within(row()).getByRole('button', { name: /Back/ });
    await userEvent.click(back);
    expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    await waitFor(() => expect(back).toBeDisabled());
  });
});

describe('folding and lines', () => {
  test('a band folds from its chevron', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    expect(within(data()).queryByRole('table')).toBeNull();
  });

  test('the page draws one line layer with a path per shown pair', async () => {
    await ordersGrid();
    const svg = document.getElementById('wires')!;
    expect(svg).not.toBeNull();
    await waitFor(() => expect(svg.querySelectorAll('path.source').length).toBeGreaterThan(0));
    expect(svg.querySelectorAll('path.relationship').length).toBeGreaterThan(0);
  });

  test('hovering a card focuses the canvas and lights its lines; Escape lets go', async () => {
    await ordersGrid();
    const canvas = document.querySelector('.dm-canvas')!;
    const customers = martCard('Customers');
    fireEvent.pointerOver(customers);
    expect(canvas).toHaveClass('focused');
    expect(customers).toHaveClass('lit');
    expect(martCard('Orders')).toHaveClass('lit'); // joined to Customers
    expect(customers).not.toHaveClass('aside'); // the pinned mart lights it too
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(canvas).toHaveClass('focused'); // the selected mart stays pinned
    expect(customers).toHaveClass('lit');
  });

  test('a card lit only by the pointer while another is pinned is drawn aside, and Escape clears it', async () => {
    await ordersGrid();
    const shopify = within(sources()).getByText('Shopify').closest('article')!;
    fireEvent.click(shopify); // pins the source; no mart is selected
    await waitFor(() => expect(within(marts()).queryByText('Sessions')).toBeNull());
    const ga = within(sources()).getByText('Google Analytics 4').closest('article')!;
    expect(ga).not.toHaveClass('lit');
    fireEvent.pointerOver(ga);
    expect(ga).toHaveClass('lit', 'aside');
    expect(shopify).toHaveClass('lit');
    expect(shopify).not.toHaveClass('aside');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(ga).not.toHaveClass('lit');
    expect(shopify).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('column headers and band toolbars', () => {
  const head = (b: HTMLElement) => b.querySelector<HTMLElement>('.dm-band-head')!;

  test('a column shows its alias, and its title attribute holds the technical name; no alias shows the name', async () => {
    const grid = await ordersGrid();
    const customer = within(grid).getByText('Customer');
    expect(customer).toHaveAttribute('title', 'customer_id');
    expect(within(grid).queryByText('customer_id')).toBeNull();
    expect(within(grid).getByLabelText('Filter Customer')).toBeInTheDocument();
    const id = within(grid).getByText('id', { selector: 'span.truncate' });
    expect(id).not.toHaveAttribute('title');
  });

  test('the column picker lists the alias beside the technical name', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: /Columns \(5\/8\)/ }));
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
    expect(screen.getByText('amount')).toBeInTheDocument();
  });

  test('the (i) is there only with a description, and shows it in a tooltip', async () => {
    const grid = await ordersGrid();
    expect(within(grid).queryByLabelText('About id')).toBeNull();
    await userEvent.hover(within(grid).getByLabelText('About Customer'));
    expect((await screen.findAllByText('Who placed the order.')).length).toBeGreaterThan(0);
  });

  test('an active filter keeps its icon on screen, an idle one reveals on hover', async () => {
    const grid = await ordersGrid();
    const idle = within(grid).getByLabelText('Filter id');
    expect(idle).toHaveClass('dm-reveal');
    expect(idle).not.toHaveClass('dm-reveal-on');
    await userEvent.click(idle);
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getByLabelText('Filter id')).toHaveClass('dm-reveal-on'));
  });

  test('the Data band controls sit in its header and work from there', async () => {
    const calls = await spyOnTraverse();
    const grid = await ordersGrid();
    const bar = head(grid);
    for (const name of ['Reset', 'Refresh', /Columns \(5\/8\)/]) expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(4));
    await userEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(201));
    await settle();
    const reads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 201).length;
    const before = reads();
    await userEvent.click(within(bar).getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(reads()).toBe(before + 1);
    await userEvent.click(within(bar).getByRole('button', { name: /Columns \(5\/8\)/ }));
    await userEvent.click(screen.getByLabelText(/Amount/));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader')).toHaveLength(6));
  });

  test('the content is one card inside the band, and folding the band takes the controls with it', async () => {
    const grid = await ordersGrid();
    expect(grid.querySelector('.dm-bigcard')).toContainElement(within(grid).getByRole('table'));
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Hide Orders' }));
    expect(within(grid).queryByRole('button', { name: 'Reset' })).toBeNull();
  });

  test('unfolding the band brings back exactly one set of controls', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Hide Orders' }));
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Show Orders' }));
    await within(grid).findByRole('table');
    expect(within(grid).getAllByRole('button', { name: 'Reset' })).toHaveLength(1);
    expect(within(grid).getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(within(grid).getAllByRole('button', { name: /Columns/ })).toHaveLength(1);
  });

  test('the Row band has Back and Refresh in its header', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getAllByRole('row')[1]!);
    await within(row()).findByText('status');
    const bar = head(row());
    expect(within(bar).getByRole('button', { name: /Back/ })).toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

describe('the storage filter', () => {
  const head = () => marts().querySelector<HTMLElement>('.dm-band-head')!;
  const storageMenu = () => within(head()).getByText('Storage').closest('details')!;

  test('is in the Data Marts header, ticked by default, with a count per storage', async () => {
    await ordersGrid();
    const menu = storageMenu();
    expect(within(menu).getByText('All')).toBeInTheDocument();
    expect(within(menu).getByRole('checkbox', { name: /Demo Warehouse/ })).toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: /Sales Lake/ })).toBeChecked();
    expect(within(menu).getByRole('checkbox', { name: /Sales Lake/ }).closest('label')).toHaveTextContent('4');
  });

  test('unticking Sales Lake removes Payments from the band; the Data band keeps the selected mart, with no history entry', async () => {
    await ordersGrid();
    expect(within(marts()).getByText('Payments')).toBeInTheDocument();
    await userEvent.click(within(storageMenu()).getByRole('checkbox', { name: /Sales Lake/ }));
    await waitFor(() => expect(within(marts()).queryByText('Payments')).toBeNull());
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    expect(martCard('Orders')).toHaveAttribute('aria-pressed', 'true');
    expect(within(data()).getByRole('heading', { name: 'Orders' })).toBeInTheDocument();
    expect(within(row()).getByRole('button', { name: /Back/ })).toBeDisabled();
  });

  test('a selected mart in an unticked storage leaves the Data Marts band but stays in the Data band', async () => {
    await ordersGrid();
    await userEvent.click(within(martCard('Orders').closest('section')!).getByText('Payments'));
    await within(data()).findByRole('heading', { name: 'Payments' });
    await userEvent.click(within(storageMenu()).getByRole('checkbox', { name: /Sales Lake/ }));
    await waitFor(() => expect(within(marts()).queryByText('Payments')).toBeNull());
    expect(within(data()).getByRole('heading', { name: 'Payments' })).toBeInTheDocument();
  });

  test('is hidden with one storage', async () => {
    const f = demoFixtures();
    f.marts.forEach((m) => { m.storageId = 's1'; });
    await mountWith((c) => c, f);
    expect(within(head()).queryByText('Storage')).toBeNull();
  });
});
