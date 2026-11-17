import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore } from '../../state/store';
import { App } from '../App';

type Mock = ReturnType<typeof createMockCtx>;

// The bands exist once the model has loaded.
// The page has no Refresh button; the model reloads through a failed storage's Retry. This probe dispatches the same action.
function ModelReload() {
  const [, dispatch] = useStore();
  return <button type="button" onClick={() => dispatch({ type: 'refreshModel' })}>Reload model (test probe)</button>;
}
const reloadModel = () => userEvent.click(screen.getByRole('button', { name: 'Reload model (test probe)' }));

async function mountWith(wrap: (ctx: Mock) => Ctx = (c) => c, fixtures = demoFixtures()) {
  const view = render(<AppServices ctx={wrap(createMockCtx(fixtures, { latencyMs: 0 }))}><StoreProvider><App /><ModelReload /></StoreProvider></AppServices>);
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());
  return view;
}
const mountApp = () => mountWith();

const band = (id: string) => document.getElementById(id)!;
const data = () => band('band-data');
const row = () => band('band-row');
const marts = () => band('band-marts');
const sources = () => band('band-sources');
const martCard = (title: string) => within(marts()).getByText(title).closest('article')!;

const headingText = () => within(data()).getByRole('heading').textContent;
/** Makes a mart the main one: a mart the main one can join is added to its grid first, so clicking the main card then promotes it. */
async function goTo(title: string) {
  const main = headingText()!;
  fireEvent.click(martCard(title));
  // A mart that comes back as main shows the joined marts it was left with.
  const mainNow = () => headingText() === title || headingText()!.startsWith(`${title} + `);
  await waitFor(() => expect(mainNow() || headingText() === `${main} + ${title}`).toBe(true));
  if (!mainNow()) {
    // A search that does not match the main mart hides its card.
    if (!within(marts()).queryByText(main)) await userEvent.clear(screen.getByLabelText('Search data marts'));
    fireEvent.click(await within(marts()).findByText(main).then((el) => el.closest('article')!));
  }
  await waitFor(() => expect(mainNow()).toBe(true));
}

async function ordersGrid() {
  await mountApp();
  await within(data()).findByRole('table');
  await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
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

describe('the first load', () => {
  const bars = () => screen.queryAllByRole('progressbar', { name: 'Reading the project' });

  test('the bar never moves backwards, even when the storages arrive after the other reads', async () => {
    const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
    const lateStorages: Ctx = { ...ctx, owox: { ...ctx.owox, storages: { list: async () => { await new Promise((r) => setTimeout(r, 120)); return ctx.owox.storages.list(); } } } };
    const seen: number[] = [];
    const watch = new MutationObserver(() => { const v = document.querySelector('[role=progressbar][aria-label="Reading the project"]')?.getAttribute('aria-valuenow'); if (v) seen.push(Number(v)); });
    watch.observe(document.body, { subtree: true, attributes: true, childList: true });
    render(<AppServices ctx={lateStorages}><StoreProvider><App /></StoreProvider></AppServices>);
    await waitFor(() => expect(document.getElementById('band-data')!.querySelector('table')).not.toBeNull());
    watch.disconnect();
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]!)).toBe(true);
  });

  test('draws every band header at once with a bar in place of each body, fills it as reads finish, then shows the bodies', async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
    const slowEdges: Ctx = { ...ctx, owox: { ...ctx.owox, models: { getEdges: async (id: string) => { await gate; return ctx.owox.models.getEdges(id); } } } };
    render(<AppServices ctx={slowEdges}><StoreProvider><App /></StoreProvider></AppServices>);
    // the shell is there before anything has loaded
    for (const name of ['Data Sources', 'Data', 'Rows', 'Row']) expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data Explorer' })).toBeInTheDocument();
    expect(document.querySelector('[aria-label="Loading"]')).toBeNull(); // no skeleton rows
    // Data Sources starts folded, so three bars: the bodies are not there
    await waitFor(() => expect(bars()).toHaveLength(3));
    // every read but the edges has finished: the bar is part way
    await waitFor(() => { const v = Number(bars()[0]!.getAttribute('aria-valuenow')); expect(v).toBeGreaterThan(0); expect(v).toBeLessThan(100); });
    expect(document.querySelector('.dm-loadbar-done')).toBeNull();
    release();
    await waitFor(() => expect(document.getElementById('band-data')!.querySelector('table')).not.toBeNull());
    expect(bars()).toHaveLength(0);
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
  });
});

describe('the four bands', () => {
  test('the first load selects Orders, shows its rows and the marts joined to it', async () => {
    const grid = await ordersGrid();
    expect(within(band('band-data')).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
    expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5);
    expect(await within(data()).findByText('200+ records')).toBeInTheDocument();
    expect(martCard('Orders')).toHaveAttribute('aria-pressed', 'true');
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    expect(within(data()).queryByText('Select a data mart.')).toBeNull();
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
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
    await waitFor(() => expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument());
    expect(shopify).toHaveAttribute('aria-pressed', 'false');
  });

  test('the Data Sources band lists the connectors', async () => {
    await ordersGrid();
    for (const name of ['Shopify', 'Google Analytics 4', 'Facebook Ads']) expect(within(sources()).getByText(name)).toBeInTheDocument();
  });

  test('a row click fills the Row band', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    expect(await within(row()).findByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    expect(await within(row()).findByText('status')).toBeInTheDocument();
  });

  test('the grid id cell is plain text', async () => {
    const grid = await ordersGrid();
    expect(within(within(grid).getAllByRole('row')[2]!.querySelector('td')!).queryByRole('button')).toBeNull();
  });

  test('three follows, then three Undos, return to each selection in order', async () => {
    await ordersGrid();
    const filterActive = () => within(data()).getByRole('button', { name: 'Reset' });
    // 1. the Customers record
    await goTo('Customers');
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    const customerHeading = await within(row()).findByRole('heading', { name: /^Customers · \d+$/ });
    // 2. a filtered target: Customers record -> Orders, filtered
    const section = await within(row()).findByRole('region', { name: 'Referenced by' });
    const entry = within(section).getByRole('button', { name: /^Orders/ });
    await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry);
    await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ });
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary'));
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    // 3. a record of the filtered Orders
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    // Orders may show a joined mart here, so its group row sits above the titles: take the first row with cells.
    await userEvent.click(within(data()).getAllByRole('row').find((r) => r.querySelector('td'))!);
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    const back = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await back(); // Orders, filtered, no record
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary');
    expect(filterActive()).toBeEnabled();
    await back(); // the Customers record
    expect(await within(row()).findByRole('heading', { name: customerHeading.textContent! })).toBeInTheDocument();
    expect(within(data()).getByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(martCard('Customers')).toHaveAttribute('aria-pressed', 'true');
    await back(); // the Customers mart, no record
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    await back(); // Orders
    expect(await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
  });

  test('a reference column shows the stored value as plain text and asks no other mart for titles', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    const grid = data();
    const at = within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').findIndex((h) => h.textContent?.includes('Customer'));
    const first = within(grid).getAllByRole('row')[2]!;
    const cell = first.querySelectorAll('td')[at]!;
    expect(cell.textContent).toMatch(/^\d*$/); // the key, never a name
    expect(within(cell).queryByRole('button')).toBeNull();
    expect(cell.querySelector('.text-primary')).toBeNull();
    expect(calls.filter((c) => c.id !== 'orders' && !(c.o as { uniqueCount?: unknown }).uniqueCount)).toEqual([]);
  });

  test('Redo re-applies what Undo returned from; a new navigation empties it', async () => {
    const grid = await ordersGrid();
    const undo = () => screen.getByRole('button', { name: 'Undo' });
    const redo = () => screen.getByRole('button', { name: 'Redo' });
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    await userEvent.click(undo());
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    expect(redo()).toBeEnabled();
    await userEvent.click(redo());
    expect(await within(row()).findByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    expect(redo()).toBeDisabled();
    await userEvent.click(undo());
    await goTo('Customers');
    expect(redo()).toBeDisabled();
  });

  test('Alt+ArrowRight and Ctrl+Shift+Z redo, Ctrl+Z undoes, but not while typing in a field', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    fireEvent.keyDown(screen.getByLabelText('Search data marts'), { key: 'z', ctrlKey: true });
    await settle();
    expect(within(row()).getByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'z', ctrlKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    fireEvent.keyDown(document, { key: 'z', metaKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    fireEvent.keyDown(document, { key: 'Z', metaKey: true, shiftKey: true });
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
  });

  test('Alt+ArrowLeft goes back too', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
  });

  test('Alt+ArrowLeft typed in a field is the word-jump, not Back', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
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
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(402));
  });

  test('filter then reset', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    await userEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
  });

  test('the column picker adds a column', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Orders' }));
    await userEvent.click(screen.getByLabelText(/amount/i));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(6));
  });

  test('going back to a mart restores its filters', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    await goTo('Customers');
    // Joining it, then promoting it, are two steps.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ });
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(5));
    expect(within(data()).getByRole('button', { name: 'Reset' })).toBeEnabled();
  });

  test('edits made on top of a followed filter survive a trip away and Back', async () => {
    await ordersGrid();
    await goTo('Customers');
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Customers · \d+$/ });
    const section = await within(row()).findByRole('region', { name: 'Referenced by' });
    const entry = within(section).getByRole('button', { name: /^Orders/ });
    await waitFor(() => expect(entry).toBeEnabled());
    await userEvent.click(entry); // Orders, filtered by customer_id
    await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ });
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('text-primary'));
    await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(0));
    await userEvent.click(within(data()).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(data()).getByLabelText('Filter id')).toHaveClass('text-primary'));
    await goTo('Order Items'); // away, to a mart Orders cannot join
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ });
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
    expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5);
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
  });

  test('a failed read keeps the header and shows the error in the body', async () => {
    await mountWith(overrideTraverse((real) => (id, o) => (o.limit === 201 ? Promise.reject(new Error('read failed')) : real(id, o))));
    expect(await within(data()).findByText('read failed')).toBeInTheDocument();
    expect(within(data()).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5);
    expect(within(data()).getByLabelText('Filter id')).toBeInTheDocument();
  });

  test('hiding a column does not read the mart again', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    const before = calls.filter((c) => c.id === 'orders').length;
    await userEvent.click(within(data()).getByRole('button', { name: 'Columns of Orders' }));
    await userEvent.click(screen.getAllByRole('checkbox').filter((c) => (c as HTMLInputElement).checked).at(-1)!);
    await waitFor(() => expect(within(data()).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(4));
    await settle();
    expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before);
  });
});

describe('the record', () => {
  async function openOrderRecord() {
    const grid = await ordersGrid();
    await userEvent.click((await within(grid).findAllByRole('cell', { name: '1' }))[0]!);
    await within(row()).findByRole('heading', { name: /^Orders · 1$/ });
    return row();
  }

  test('a record is read with one query and no lookups in other marts', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await userEvent.click((await within(data()).findAllByRole('cell', { name: '1' }))[0]!);
    await within(row()).findByText('status');
    await settle();
    expect(calls.filter((c) => c.id !== 'orders' && !(c.o as { uniqueCount?: unknown }).uniqueCount)).toEqual([]);
  });

  test('the Row band labels show the alias only, with a (?) holding the description', async () => {
    await mountApp();
    await within(data()).findByRole('table');
    await userEvent.click((await within(data()).findAllByRole('cell', { name: '1' }))[0]!);
    await within(row()).findByText('status');
    expect(within(row()).getByText('Customer')).toBeInTheDocument();
    expect(within(row()).queryByText('customer_id')).toBeNull();
    expect(within(row()).queryByLabelText('About status')).toBeNull();
    await userEvent.hover(within(row()).getByLabelText('About Customer'));
    expect((await screen.findAllByText('Who placed the order.')).length).toBeGreaterThan(0);
  });

  test('Refresh on a record shows the progress bar', async () => {
    await mountWith(overrideTraverse((real) => async (id, o) => { if (o.limit === 1) await new Promise((r) => setTimeout(r, 50)); return real(id, o); }));
    await within(data()).findByRole('table');
    await userEvent.click((await within(data()).findAllByRole('cell', { name: '1' }))[0]!);
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
    expect(names).toEqual(expect.arrayContaining(['Order Items', 'Returns', 'Payments', 'Shipments']));
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
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Order Items · 1$/ });
    await within(row()).findByText('Order');
    expect(within(row()).queryByRole('region', { name: 'Referenced by' })).toBeNull();
  });

  test('a model reload re-reads the open record once, and nothing else does', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await userEvent.click((await within(data()).findAllByRole('cell', { name: '1' }))[0]!);
    await within(row()).findByText('status');
    await settle();
    const recordReads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 1).length;
    const before = recordReads();
    expect(before).toBeGreaterThan(0);
    const gridReads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 201).length;
    const gridBefore = gridReads();
    await reloadModel();
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
  test('the page header is the title with no Refresh button; the search lives in the Data Marts band', async () => {
    await ordersGrid();
    const header = document.querySelector('header.dm-page-header')!;
    expect(within(header as HTMLElement).getByRole('heading', { level: 1, name: 'Data Explorer' })).toHaveClass('dm-page-header-title');
    expect(within(header as HTMLElement).queryByRole('button', { name: /Refresh/ })).toBeNull();
    expect(header.querySelector('input')).toBeNull();
    expect(within(marts()).getByLabelText('Search data marts')).toBeInTheDocument();
    expect(document.querySelector('main.dm-page-content')).not.toBeNull();
  });

  test('search narrows the marts and keeps the selection, its card included', async () => {
    await ordersGrid();
    await userEvent.type(screen.getByLabelText('Search data marts'), 'zzzz');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Search data marts'));
    expect(await within(marts()).findByText('Customers')).toBeInTheDocument();
  });

  test('the search reads the title only: a context name finds nothing', async () => {
    await ordersGrid();
    await userEvent.type(screen.getByLabelText('Search data marts'), 'marketing');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).queryByText('Campaigns')).toBeNull();
    await userEvent.clear(screen.getByLabelText('Search data marts'));
    await userEvent.type(screen.getByLabelText('Search data marts'), 'campaign');
    expect(await within(marts()).findByText('Campaigns')).toBeInTheDocument();
    expect(within(marts()).getByText('Campaigns').closest('article')!.querySelector('.dm-badge-shrink')).toBeNull();
  });

  test('the toolbar holds the search, then Storage; the Contexts badges sit in the title row after the hint', async () => {
    await ordersGrid();
    const tools = marts().querySelector('.dm-band-tools')!;
    const kinds = [...tools.children].map((c) => (c.matches('label.dm-search') ? 'search' : c.querySelector('summary')?.firstChild?.textContent));
    expect(kinds).toEqual(['search', 'Storage']);
    const head = marts().querySelector('.dm-band-head')!;
    const order = [...head.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('dm-context-filter')).toBe(order.indexOf('dm-hint') + 1);
  });

  test('the Contexts badges show each context with its icon; none selected is no filter', async () => {
    await ordersGrid();
    const group = within(marts()).getByRole('group', { name: 'Contexts' });
    const badges = within(group).getAllByRole('button');
    expect(badges.map((b) => b.textContent)).toEqual(['Catalog', 'Marketing', 'Sales']);
    for (const b of badges) { expect(b).toHaveAttribute('aria-pressed', 'false'); expect(b.querySelector('svg')).not.toBeNull(); }
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
  });

  test('a selected badge narrows the marts to that context; a second one adds its marts (any); deselecting all restores', async () => {
    await ordersGrid();
    const group = within(marts()).getByRole('group', { name: 'Contexts' });
    await userEvent.click(within(group).getByRole('button', { name: 'Marketing' }));
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Campaigns')).toBeInTheDocument();
    expect(within(group).getByRole('button', { name: 'Marketing' })).toHaveAttribute('aria-pressed', 'true');
    // The main mart's card stays although it is not in the context.
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Sales' }));
    expect(await within(marts()).findByText('Orders')).toBeInTheDocument();
    expect(within(marts()).getByText('Campaigns')).toBeInTheDocument();
    expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
    await userEvent.click(within(group).getByRole('button', { name: 'Marketing' }));
    await userEvent.click(within(group).getByRole('button', { name: 'Sales' }));
    expect(await within(marts()).findByText('Customers')).toBeInTheDocument();
  });

  test('a click on a badge does not fold the band', async () => {
    await ordersGrid();
    await userEvent.click(within(marts()).getByRole('button', { name: 'Sales' }));
    expect(marts()).not.toHaveClass('folded');
  });

  test('a failed refresh keeps the bands and shows a retry in the header', async () => {
    const fail = { current: false };
    await mountWith((ctx) => ({ ...ctx, owox: { ...ctx.owox, storages: { list: async () => { if (fail.current) throw new Error('boom'); return ctx.owox.storages.list(); } } } }));
    await within(data()).findByRole('table');
    fail.current = true;
    await reloadModel();
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
    await goTo('Customers');
    hide.current = true;
    await reloadModel();
    await waitFor(() => expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument());
    // The replacement left no history entry: Back steps to the earlier Orders selection and then stops.
    const back = screen.getByRole('button', { name: 'Undo' });
    await userEvent.click(back); // joining Customers, and promoting it, were two steps
    await userEvent.click(back);
    expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
    await waitFor(() => expect(back).toBeDisabled());
  });
});

describe('folding and lines', () => {
  test('a band folds from its chevron', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    expect(within(data()).queryByRole('table')).toBeNull();
  });

  test('folding the Data band and unfolding it does not ask for the rows again', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    const before = calls.length;
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    expect(within(data()).queryByRole('table')).toBeNull();
    await userEvent.click(within(data()).getByRole('button', { name: /^Show / }));
    await within(data()).findByRole('table');
    await settle();
    expect(calls).toHaveLength(before);
    expect(within(data()).getAllByRole('row')).toHaveLength(202);
  });

  test('a folded Data band runs no query for marts selected meanwhile; unfolding runs exactly one for the current mart', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    // Counts for cards that came into view are not row queries.
    const rowQueries = () => calls.filter((c) => !(c.o as { uniqueCount?: unknown } | undefined)?.uniqueCount);
    const before = rowQueries().length;
    // Orders joins Customers and Stores: both become columns of its grid, which is not read while the band is folded.
    fireEvent.click(martCard('Customers'));
    await settle();
    fireEvent.click(martCard('Stores'));
    await settle();
    expect(rowQueries()).toHaveLength(before);
    await userEvent.click(within(data()).getByRole('button', { name: /^Show / }));
    await within(data()).findByRole('heading', { name: 'Orders + Customers + Stores' });
    await settle();
    const fresh = rowQueries().slice(before);
    // The grid's own rows query: one, with the joined columns in it.
    const grid = fresh.filter((c) => (c.o as { sort?: unknown } | undefined)?.sort);
    expect(grid).toHaveLength(1);
    expect(grid[0]!.id).toBe('orders');
    expect(grid[0]!.o.column).toEqual(expect.arrayContaining(['customers__name', 'stores__name']));
  });

  test('a folded Row band fetches no record for rows selected meanwhile', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    await settle();
    await userEvent.click(within(row()).getByRole('button', { name: /^Hide / }));
    const before = calls.length;
    await userEvent.click(within(data()).getAllByRole('row')[3]!);
    await settle();
    expect(calls).toHaveLength(before);
    await userEvent.click(within(row()).getByRole('button', { name: /^Show / }));
    await settle();
    expect(calls.length).toBeGreaterThan(before);
  });

  test('no line is drawn to a card in a folded band', async () => {
    // jsdom has no layout: give each card a box of its own, and a hidden one none.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const hidden = !!this.closest('[hidden]');
      const left = this.id ? (this.id.length * 91) % 600 : 0;
      const top = this.id ? (this.id.length * 37) % 400 : 0;
      const [w, h] = hidden ? [0, 0] : [100, 40];
      return { left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top, toJSON() {} } as DOMRect;
    });
    try {
      await ordersGrid();
      const svg = document.getElementById('wires')!;
      const canvas = document.querySelector('.dm-canvas')!;
      const drawn = () => svg.querySelectorAll('path.source[d], path.relationship[d]').length;
      // The browser's ResizeObserver asks for a layout when a band changes height; here the animation end does.
      fireEvent.animationEnd(canvas);
      await waitFor(() => expect(drawn()).toBeGreaterThan(0));
      await userEvent.click(within(marts()).getByRole('button', { name: /^Hide / }));
      expect(martCard('Customers')).not.toBeVisible();
      fireEvent.animationEnd(canvas);
      await waitFor(() => expect(drawn()).toBe(0));
    } finally { vi.restoreAllMocks(); }
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

  test('a column shows its alias, and its tooltip holds the technical name; no alias shows the name', async () => {
    const grid = await ordersGrid();
    const customer = within(grid).getByText('Customer');
    expect(customer.closest('button')).not.toHaveAttribute('title');
    await userEvent.hover(customer);
    expect((await screen.findAllByText('customer_id')).length).toBeGreaterThan(0);
    expect(within(grid).queryByText('customer_id')).toBeNull();
    expect(within(grid).getByLabelText('Filter Customer')).toBeInTheDocument();
    const id = within(grid).getByText('id', { selector: 'span.truncate' });
    expect(id).not.toHaveAttribute('title');
  });

  test('the column picker shows the alias only, and a (?) with the description when the field has one', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Orders' }));
    expect(screen.getByLabelText(/Amount/)).toBeInTheDocument();
    expect(screen.queryByText('amount')).toBeNull();
    expect(screen.queryByText('customer_id')).toBeNull();
    const picker = within(screen.getByRole('dialog'));
    expect(picker.getByLabelText('Customer')).toBeInTheDocument();
    const about = picker.getByLabelText('About Customer');
    expect(picker.queryByLabelText('About Amount')).toBeNull();
    await userEvent.hover(about);
    expect((await screen.findAllByText('Who placed the order.')).length).toBeGreaterThan(0);
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
    for (const name of ['Reset', 'Refresh']) expect(within(bar).getByRole('button', { name })).toBeInTheDocument();
    await userEvent.click(within(grid).getByLabelText('Filter id'));
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    await userEvent.click(within(bar).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
    await settle();
    const reads = () => calls.filter((c) => c.id === 'orders' && c.o.limit === 201).length;
    const before = reads();
    await userEvent.click(within(bar).getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(reads()).toBe(before + 1);
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Orders' }));
    await userEvent.click(screen.getByLabelText(/Amount/));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(6));
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

  test('the Row band has Refresh in its header and no Back; Undo and Redo sit after the page title', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    await within(row()).findByText('status');
    const bar = head(row());
    expect(within(bar).queryByRole('button', { name: /Back/ })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    const lead = document.querySelector('.dm-page-header-lead')!;
    expect([...lead.children].map((c) => c.tagName)).toEqual(['H1', 'DIV']);
    expect(within(lead as HTMLElement).getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(within(lead as HTMLElement).getByRole('button', { name: 'Redo' })).toBeDisabled();
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
    expect(within(data()).getByRole('heading', { name: /^Orders( \+ .*)?$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
  });

  test('a selected mart in an unticked storage leaves the Data Marts band but stays in the Data band', async () => {
    await ordersGrid();
    await userEvent.click(within(martCard('Orders').closest('section')!).getByText('Payments'));
    await within(data()).findByRole('heading', { name: 'Payments' });
    await userEvent.click(within(storageMenu()).getByRole('checkbox', { name: /Sales Lake/ }));
    await waitFor(() => expect(within(marts()).queryByText('Payments')).toBeNull());
    expect(within(data()).getByRole('heading', { name: 'Payments' })).toBeInTheDocument();
  });

  test('a click outside closes the open menu', async () => {
    await ordersGrid();
    const menu = storageMenu();
    await userEvent.click(within(menu).getByText('Storage'));
    expect(menu.open).toBe(true);
    await userEvent.click(martCard('Customers'));
    expect(menu.open).toBe(false);
  });

  test('with every storage unticked and the selected mart gone after a refresh, the selection is emptied', async () => {
    const hide = { current: false };
    await mountWith((ctx) => ({
      ...ctx,
      owox: {
        ...ctx.owox,
        getJson: async <T,>(path: string, query?: Record<string, string>) => {
          const r = await ctx.owox.getJson<T>(path, query);
          if (hide.current && path === '/api/model-canvas/data-marts') {
            const page = r as unknown as { items: { id: string }[] };
            return { ...page, items: page.items.filter((i) => i.id !== 'orders') } as T;
          }
          return r;
        },
      },
    }));
    await within(data()).findByRole('table');
    await userEvent.click(within(storageMenu()).getByLabelText('Select all'));
    await waitFor(() => expect(within(marts()).queryByText('Orders')).toBeNull());
    hide.current = true;
    await reloadModel();
    await waitFor(() => expect(within(data()).getByText('Select a data mart.')).toBeInTheDocument());
  });

  test('is hidden with one storage', async () => {
    const f = demoFixtures();
    f.marts.forEach((m) => { m.storageId = 's1'; });
    await mountWith((c) => c, f);
    expect(within(head()).queryByText('Storage')).toBeNull();
  });
});

describe('column sort', () => {
  const sortBtn = (grid: HTMLElement, label: string) => within(grid).getByRole('button', { name: new RegExp(`^Sort by ${label},`) });
  const header = (grid: HTMLElement, label: string) => sortBtn(grid, label).closest('th')!;
  const firstId = (grid: HTMLElement) => within(within(grid).getAllByRole('row')[2]!).getAllByRole('cell')[0]!.textContent;
  const sortOf = (calls: { id: string; o: { sort?: unknown } }[]) => calls.filter((c) => c.id === 'orders').at(-1)!.o.sort;

  test('a click cycles none, ascending, descending, none, with aria-sort and a label that says where it is', async () => {
    const grid = await ordersGrid();
    expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'none');
    expect(sortBtn(grid, 'status')).toHaveAccessibleName('Sort by status, currently not sorted');
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'ascending'));
    expect(sortBtn(grid, 'status')).toHaveAccessibleName('Sort by status, currently ascending');
    expect(header(grid, 'status').querySelector('svg.lucide-arrow-up')).not.toBeNull();
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'descending'));
    expect(header(grid, 'status').querySelector('svg.lucide-arrow-down')).not.toBeNull();
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'none'));
    expect(header(grid, 'status').querySelector('svg.lucide-arrow-up, svg.lucide-arrow-down')).toBeNull();
  });

  test('sorting reorders the rows: id descending puts the last row first', async () => {
    const grid = await ordersGrid();
    expect(firstId(grid)).toBe('1');
    await userEvent.click(sortBtn(grid, 'id'));
    await userEvent.click(sortBtn(grid, 'id'));
    await waitFor(() => expect(firstId(grid)).toBe('450'));
  });

  test('two sorts show precedence numbers; removing the first keeps the other, renumbered', async () => {
    const grid = await ordersGrid();
    await userEvent.click(sortBtn(grid, 'status'));
    expect(within(header(grid, 'status')).queryByText('1')).toBeNull();
    await userEvent.click(sortBtn(grid, 'Customer'));
    await userEvent.click(sortBtn(grid, 'Product'));
    await waitFor(() => expect(within(header(grid, 'Product')).getByText('3')).toBeInTheDocument());
    expect(within(header(grid, 'status')).getByText('1')).toBeInTheDocument();
    expect(within(header(grid, 'Customer')).getByText('2')).toBeInTheDocument();
    // remove the middle one: the others keep their order
    await userEvent.click(sortBtn(grid, 'Customer'));
    await userEvent.click(sortBtn(grid, 'Customer'));
    await waitFor(() => expect(within(header(grid, 'Product')).getByText('2')).toBeInTheDocument());
    expect(within(header(grid, 'status')).getByText('1')).toBeInTheDocument();
    expect(header(grid, 'Customer')).toHaveAttribute('aria-sort', 'none');
  });

  test('the query carries the sorts in order, then the primary key; one run per change, limit back to the page size', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    const grid = data();
    await userEvent.click(within(grid).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(402));
    const before = calls.filter((c) => c.id === 'orders').length;
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
    await settle();
    expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before + 1);
    expect(calls.filter((c) => c.id === 'orders').at(-1)!.o.limit).toBe(201);
    expect(sortOf(calls)).toEqual([{ column: 'status', direction: 'asc' }, { column: 'id', direction: 'asc' }]);
    // sorting the key ascending sends the very same query: nothing is billed again
    await userEvent.click(sortBtn(grid, 'id'));
    await settle();
    expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before + 1);
    await userEvent.click(sortBtn(grid, 'id'));
    await waitFor(() => expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before + 2));
    expect(sortOf(calls)).toEqual([{ column: 'status', direction: 'asc' }, { column: 'id', direction: 'desc' }]);
  });

  test('the filter icon and the (i) do not sort', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    const grid = data();
    const before = calls.filter((c) => c.id === 'orders').length;
    await userEvent.click(within(grid).getByLabelText('Filter Customer'));
    await userEvent.keyboard('{Escape}');
    await userEvent.hover(within(grid).getByLabelText('About Customer'));
    await userEvent.click(within(grid).getByLabelText('About Customer'));
    await settle();
    expect(header(grid, 'Customer')).toHaveAttribute('aria-sort', 'none');
    expect(calls.filter((c) => c.id === 'orders')).toHaveLength(before);
  });

  test('a header tooltip holds the technical name of an aliased column; a plain, short one has none', async () => {
    const grid = await ordersGrid();
    for (const name of ['Customer', 'status']) expect(sortBtn(grid, name)).not.toHaveAttribute('title');
    const tip = () => document.querySelector('[role="tooltip"]')?.textContent ?? null;
    for (const [name, text] of [['Customer', 'customer_id'], ['status', null]] as const) {
      await userEvent.hover(sortBtn(grid, name));
      if (text) await waitFor(() => expect(tip()).toBe(text)); else await settle();
      if (!text) expect(tip()).toBeNull();
      await userEvent.unhover(sortBtn(grid, name));
      await waitFor(() => expect(tip()).toBeNull());
    }
  });

  test('with two or more sorts the label says the precedence', async () => {
    const grid = await ordersGrid();
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(sortBtn(grid, 'status')).toHaveAccessibleName('Sort by status, currently ascending'));
    await userEvent.click(sortBtn(grid, 'id'));
    await waitFor(() => expect(sortBtn(grid, 'status')).toHaveAccessibleName('Sort by status, currently ascending, sort 1 of 2'));
    expect(sortBtn(grid, 'id')).toHaveAccessibleName('Sort by id, currently ascending, sort 2 of 2');
    expect(sortBtn(grid, 'Product')).toHaveAccessibleName('Sort by Product, currently not sorted');
  });

  test('Reset clears the sorts, and is enabled by a sort alone', async () => {
    const grid = await ordersGrid();
    expect(within(grid).getByRole('button', { name: 'Reset' })).toBeDisabled();
    await userEvent.click(sortBtn(grid, 'id'));
    await userEvent.click(sortBtn(grid, 'id'));
    await waitFor(() => expect(firstId(grid)).toBe('450'));
    await userEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(firstId(grid)).toBe('1'));
    expect(header(grid, 'id')).toHaveAttribute('aria-sort', 'none');
    expect(within(grid).getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  test('going back to a mart restores its sorts', async () => {
    const grid = await ordersGrid();
    await userEvent.click(sortBtn(grid, 'id'));
    await userEvent.click(sortBtn(grid, 'id'));
    await waitFor(() => expect(firstId(grid)).toBe('450'));
    await goTo('Customers');
    // Joining it, then promoting it, are two steps.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByRole('heading', { name: /^Orders( \+ .*)?$/ });
    await waitFor(() => expect(header(data(), 'id')).toHaveAttribute('aria-sort', 'descending'));
    await waitFor(() => expect(firstId(data())).toBe('450'));
  });

  test('hiding a sorted column drops its sort and the query stops sending it', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    const grid = data();
    await userEvent.click(sortBtn(grid, 'status'));
    await userEvent.click(sortBtn(grid, 'Product'));
    await waitFor(() => expect(sortOf(calls)).toEqual([{ column: 'status', direction: 'asc' }, { column: 'product_id', direction: 'asc' }, { column: 'id', direction: 'asc' }]));
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Orders' }));
    await userEvent.click(screen.getByLabelText('status'));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(4));
    await waitFor(() => expect(sortOf(calls)).toEqual([{ column: 'product_id', direction: 'asc' }, { column: 'id', direction: 'asc' }]));
    // showing it again does not bring the sort back
    await userEvent.click(screen.getByLabelText('status'));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5));
    expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'none');
  });
});

describe('remembered folds', () => {
  const seeded = (folded: Record<string, boolean> | 'fail') => (ctx: Mock): Ctx => ({
    ...ctx,
    collections: <T,>(name: string) => {
      const real = ctx.collections<T>(name);
      if (name !== 'preferences') return real;
      return { get: async (id: string) => { if (folded === 'fail') throw new Error('down'); return id === 'bands' ? ({ document: { folded } as T }) : null; }, put: real.put };
    },
  });

  test('with nothing saved only Data Sources is folded', async () => {
    await mountApp();
    expect(sources()).toHaveClass('folded');
    for (const b of [marts(), data(), row()]) expect(b).not.toHaveClass('folded');
  });

  test('a saved choice wins over the default, per band', async () => {
    await mountWith(seeded({ 'band-sources': false, 'band-marts': true }));
    await waitFor(() => expect(sources()).not.toHaveClass('folded'));
    expect(marts()).toHaveClass('folded');
    expect(data()).not.toHaveClass('folded');
  });

  test('each click writes the choices to the preferences collection, document "bands"', async () => {
    const puts: unknown[] = [];
    await mountWith((ctx) => ({ ...ctx, collections: <T,>(name: string) => { const c = ctx.collections<T>(name); return name === 'preferences' ? { get: c.get, put: async (id: string, d: T) => { puts.push([id, d]); return c.put(id, d); } } : c; } }));
    await userEvent.click(within(sources()).getByRole('button', { name: /^Show / }));
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    expect(puts).toEqual([
      ['bands', { folded: { 'band-sources': false } }],
      ['bands', { folded: { 'band-sources': false, 'band-data': true } }],
    ]);
  });

  test('a failed read keeps the defaults', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await mountWith(seeded('fail'));
    await settle();
    expect(sources()).toHaveClass('folded');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('the Data band loading bar', () => {
  const slow = (delay: { ms: number }) => overrideTraverse((real) => async (id, o) => { if (id === 'orders' && o.limit !== 1 && !o.aggregation) await new Promise((r) => setTimeout(r, delay.ms)); return real(id, o); });
  const bar = () => within(data()).queryByRole('progressbar', { name: 'Loading rows' });

  test('shows on the first load (with the skeleton), on Refresh, on a sort change and on Load more, and never rests on the page', async () => {
    const delay = { ms: 200 };
    await mountWith(slow(delay));
    const first = await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    expect(first).toHaveClass('dm-progress');
    expect(first.closest('.dm-bigcard')).not.toBeNull();
    await within(data()).findByRole('table');
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await waitFor(() => expect(bar()).toBeNull());
    // Long enough that the bar is still there when a slow machine looks for it.
    delay.ms = 1500;

    await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
    await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    // the rows stay on screen: the skeleton is for the very first load only
    expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true);
    await waitFor(() => expect(bar()).toBeNull(), { timeout: 5000 });

    await userEvent.click(within(data()).getByRole('button', { name: /^Sort by status,/ }));
    await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    await waitFor(() => expect(bar()).toBeNull(), { timeout: 5000 });

    await userEvent.click(within(data()).getByRole('button', { name: 'Load more' }));
    await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    await waitFor(() => expect(bar()).toBeNull());
  }, 30000);

  test('the bar sits on the top border of the card, as wide as it', async () => {
    const delay = { ms: 1500 };
    await mountWith(slow(delay));
    const found = await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    expect(found.closest('.dm-bigcard')).not.toBeNull();
    await waitFor(() => expect(bar()).toBeNull());
  });
});

describe('the default sort', () => {
  const orderSorts = (calls: { id: string; o: { sort?: unknown } }[]) => calls.filter((c) => c.id === 'orders').at(-1)!.o.sort;

  test('with no sort set the rows load newest date first: Orders by created_at, then the key', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    expect(orderSorts(calls)).toEqual([{ column: 'created_at', direction: 'desc' }, { column: 'id', direction: 'asc' }]);
    // created_at is not among the five opening columns, so no arrow is drawn; showing it draws one like a member sort
    expect(within(data()).queryByRole('button', { name: /^Sort by created_at,/ })).toBeNull();
    await userEvent.click(within(data()).getByRole('button', { name: 'Columns of Orders' }));
    await userEvent.click(screen.getByLabelText('created_at'));
    const head = await within(data()).findByRole('button', { name: /^Sort by created_at, currently descending/ });
    expect(head.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(head.querySelector('svg.lucide-arrow-down')).not.toBeNull();
  });

  test('a date column among the visible ones is the default, with its arrow from the start', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await userEvent.type(screen.getByLabelText('Search data marts'), 'daily');
    fireEvent.click(await within(marts()).findByText('Daily KPIs'));
    const day = await within(data()).findByRole('button', { name: /^Sort by day, currently descending/ });
    expect(day.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(calls.filter((c) => c.id === 'daily_kpis').at(-1)!.o.sort).toEqual([{ column: 'day', direction: 'desc' }]);
  });

  test("the member's own sort replaces the default, and Reset returns to it", async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    const grid = data();
    expect(within(grid).getByRole('button', { name: 'Reset' })).toBeDisabled();
    await userEvent.click(within(grid).getByRole('button', { name: /^Sort by status,/ }));
    await waitFor(() => expect(orderSorts(calls)).toEqual([{ column: 'status', direction: 'asc' }, { column: 'id', direction: 'asc' }]));
    await userEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(orderSorts(calls)).toEqual([{ column: 'created_at', direction: 'desc' }, { column: 'id', direction: 'asc' }]));
  });

  test('with the default on a visible column, a click on another column replaces it, and a click on the default column goes ascending', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await userEvent.type(screen.getByLabelText('Search data marts'), 'daily');
    fireEvent.click(await within(marts()).findByText('Daily KPIs'));
    await within(data()).findByRole('button', { name: /^Sort by day, currently descending/ });
    const sortOf = () => calls.filter((c) => c.id === 'daily_kpis').at(-1)!.o.sort;
    await userEvent.click(within(data()).getByRole('button', { name: /^Sort by revenue,/ }));
    await waitFor(() => expect(sortOf()).toEqual([{ column: 'revenue', direction: 'asc' }]));
    expect(within(data()).getByRole('button', { name: /^Sort by day, currently not sorted/ })).toBeInTheDocument();
    await userEvent.click(within(data()).getByRole('button', { name: 'Reset' }));
    await within(data()).findByRole('button', { name: /^Sort by day, currently descending/ });
    await userEvent.click(within(data()).getByRole('button', { name: /^Sort by day,/ }));
    await waitFor(() => expect(sortOf()).toEqual([{ column: 'day', direction: 'asc' }]));
    await userEvent.click(within(data()).getByRole('button', { name: /^Sort by day,/ }));
    await waitFor(() => expect(sortOf()).toEqual([{ column: 'day', direction: 'desc' }]));
  });

  test('a mart with no date field has no default sort beyond its key', async () => {
    const calls = await spyOnTraverse();
    await userEvent.type(screen.getByLabelText('Search data marts'), 'product');
    await within(marts()).findByText('Products');
    await goTo('Products');
    await waitFor(() => expect(calls.some((c) => c.id === 'products' && c.o.limit === 201)).toBe(true));
    expect(calls.filter((c) => c.id === 'products' && c.o.limit === 201).at(-1)!.o.sort).toEqual([{ column: 'id', direction: 'asc' }]);
  });
});

describe('folds and the saved preferences read', () => {
  const gated = (stored: Record<string, boolean>) => {
    const gate: { release: () => void } = { release: () => undefined };
    const opened = new Promise<void>((r) => { gate.release = r; });
    const puts: unknown[] = [];
    const wrap = (ctx: Mock): Ctx => ({
      ...ctx,
      collections: <T,>(name: string) => {
        const real = ctx.collections<T>(name);
        if (name !== 'preferences') return real;
        return { get: async (id: string) => { await opened; return id === 'bands' ? ({ document: { folded: stored } as T }) : null; }, put: async (id: string, d: T) => { puts.push([id, d]); return real.put(id, d); } };
      },
    });
    return { gate, puts, wrap };
  };

  test('a fold clicked before the saved read settles is merged into it, not written over it', async () => {
    const { gate, puts, wrap } = gated({ 'band-marts': true, 'band-data': false, 'band-extra': true });
    render(<AppServices ctx={wrap(createMockCtx(demoFixtures(), { latencyMs: 0 }))}><StoreProvider><App /></StoreProvider></AppServices>);
    await waitFor(() => expect(sources()).not.toBeNull());
    await userEvent.click(within(sources()).getByRole('button', { name: /^Show / }));
    await settle();
    expect(puts).toEqual([]);
    gate.release();
    await waitFor(() => expect(puts).toEqual([['bands', { folded: { 'band-marts': true, 'band-data': false, 'band-extra': true, 'band-sources': false } }]]));
    expect(sources()).not.toHaveClass('folded');
    expect(marts()).toHaveClass('folded');
  });

  test('the Data and Row bodies show a bar until the read settles, and a band saved as folded never reads rows', async () => {
    const calls: string[] = [];
    const { gate, wrap } = gated({ 'band-data': true });
    const ctx = overrideTraverse((real) => (id, o) => { if (!o.aggregation && o.column) calls.push(id); return real(id, o); })(createMockCtx(demoFixtures(), { latencyMs: 0 }));
    render(<AppServices ctx={wrap(ctx as Mock)}><StoreProvider><App /></StoreProvider></AppServices>);
    await waitFor(() => expect(marts()).not.toBeNull());
    await settle();
    // The headers are up, with a bar where the bodies will be; nothing in them is mounted, so nothing is read.
    expect(data().querySelector('.dm-loadbar')).not.toBeNull();
    expect(row().querySelector('.dm-loadbar')).not.toBeNull();
    expect(data().querySelector('table')).toBeNull();
    expect(calls).toEqual([]);
    gate.release();
    await waitFor(() => expect(data()).toHaveClass('folded'));
    await settle();
    expect(data().querySelector('table')).toBeNull();
    expect(calls.filter((c) => c === 'orders' )).toEqual([]);
    await userEvent.click(within(data()).getByRole('button', { name: /^Show / }));
    await within(data()).findByRole('table');
  });
});

describe('hidden fields, clipped cells and the field (?)', () => {
  test('a field hidden for reporting is offered nowhere: not a default column, not in the picker, not in the Row band, never queried', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await goTo('Customers');
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    const grid = data();
    expect(within(grid).queryByText('internal_flag')).toBeNull();
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Customers' }));
    expect(screen.queryByText('internal_flag')).toBeNull();
    expect(screen.queryByRole('separator')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByText('email');
    expect(within(row()).queryByText('internal_flag')).toBeNull();
    const named = calls.filter((c) => c.id === 'customers').flatMap((c) => [...(c.o.column ?? []), ...(c.o.sort ?? []).map((s) => s.column), ...(c.o.filter ?? []).map((f) => f.column)]);
    expect(named).not.toContain('internal_flag');
  });

  test('a mart whose primary key is hidden for reporting is preview only, with no 400', async () => {
    const f = demoFixtures();
    const stores = f.marts.find((m) => m.id === 'stores')!;
    stores.fields = stores.fields.map((x) => (x.name === 'id' ? { ...x, isHiddenForReporting: true } : x));
    const queries: { id: string; o: { column?: string[]; sort?: { column: string }[] } }[] = [];
    await mountWith(overrideTraverse((real) => (id, o) => { queries.push({ id, o }); return real(id, o); }), f);
    await within(data()).findByRole('table');
    await userEvent.type(screen.getByLabelText('Search data marts'), 'stores');
    await within(marts()).findByText('Stores');
    await goTo('Stores');
    expect(await screen.findByText('Preview only: this data mart has no primary key.')).toBeInTheDocument();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    expect(within(data()).queryByText(/Unknown column/)).toBeNull();
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    const named = queries.filter((q) => q.id === 'stores').flatMap((q) => [...(q.o.column ?? []), ...(q.o.sort ?? []).map((s) => s.column)]);
    expect(named).not.toContain('id');
  });

  test('Referenced by leaves out a link whose join field is hidden for reporting', async () => {
    const f = demoFixtures();
    const shipments = f.marts.find((m) => m.id === 'shipments')!;
    shipments.fields = shipments.fields.map((x) => (x.name === 'order_id' ? { ...x, isHiddenForReporting: true } : x));
    await mountWith((c) => c, f);
    await within(data()).findByRole('table');
    await userEvent.click((await within(data()).findAllByRole('cell', { name: '1' }))[0]!);
    const section = await within(row()).findByRole('region', { name: 'Referenced by' });
    await waitFor(() => expect(within(section).queryByRole('button', { name: /Shipments/ })).toBeNull());
    expect(within(section).getAllByRole('button').map((b) => b.textContent)).toEqual(['Order Items', 'Returns', 'Payments']);
  });

  test('grid cells and headers are clipped to one line, with a width cap by type, and a filler cell keeps the header line full width', async () => {
    const grid = await ordersGrid();
    const first = within(grid).getAllByRole('row')[2]!;
    const cells = [...first.querySelectorAll('td:not([aria-hidden])')];
    expect(cells.length).toBe(5);
    for (const td of cells) expect(td.className).toMatch(/overflow-hidden.*whitespace-nowrap|whitespace-nowrap.*overflow-hidden/);
    expect(cells[0]!.querySelector('.truncate')).not.toBeNull();
    const status = within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').find((h) => h.textContent?.includes('status'))!;
    expect(status.className).toContain('max-w-[24rem]');
    const id = within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').find((h) => h.textContent === 'id')!;
    expect(id.className).toContain('max-w-[12rem]');
    expect(grid.querySelector('thead th[aria-hidden]')!.className).toContain('w-full');
    // The line under the header is a shadow on every header cell (the filler too), so it survives a sticky header over a scrolling body.
    expect(grid.querySelector('thead th[aria-hidden]')!.className).toContain('dm-th');
    for (const h of within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')) expect(h.className).toContain('dm-th');
  });

  test('the (?) after a field label is revealed by its row, in the picker and in the Row band', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Columns of Orders' }));
    const hint = screen.getAllByLabelText('About Customer').find((el) => el.closest('label'))!;
    expect(hint.closest('label')).toHaveClass('dm-reveal-host');
    expect(hint.closest('.dm-hint-slot')).not.toBeNull();
    // right after the label, in the same inline box
    expect(hint.closest('.dm-fieldlabel')).not.toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByText('status');
    expect(within(row()).getByLabelText('About Customer').closest('dt')).toHaveClass('dm-reveal-host');
  });

  test('a filter popover is capped at 20rem with its title pinned above the scrolling body', async () => {
    await ordersGrid();
    await userEvent.type(screen.getByLabelText('Search data marts'), 'daily');
    fireEvent.click(await within(marts()).findByText('Daily KPIs'));
    await within(data()).findByRole('heading', { name: 'Daily KPIs' });
    await userEvent.click(await within(data()).findByLabelText('Filter day'));
    const body = (await screen.findByRole('group', { name: 'Filter day' })).closest('[data-popover-body]')!;
    expect(body.parentElement!.className).toContain('max-h-[min(20rem,var(--radix-popover-content-available-height))]');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.querySelector('.dm-popover-title')).toHaveTextContent(/^Filter$/);
  });
});
