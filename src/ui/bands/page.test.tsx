import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { keyShown } from '../../sdk/mock/key-shown';
import { AppServices, StoreProvider, useStore } from '../../state/store';
import { App } from '../App';
import { openSubmenu } from '../explorer/menu-test-utils';
import { dragOntoMain } from './drag-main-test-utils';

type Mock = ReturnType<typeof createMockCtx>;

// The bands exist once the model has loaded.
// The page has no Refresh button; the model reloads through a failed storage's Retry. This probe dispatches the same action.
function ModelReload() {
  const [, dispatch] = useStore();
  return <button type="button" onClick={() => dispatch({ type: 'refreshModel' })}>Reload model (test probe)</button>;
}
// A mart nobody here can open cannot be made main from the page; this probe selects it the way a restored view would.
function SelectSecretLedger() {
  const [, dispatch] = useStore();
  return <button type="button" onClick={() => dispatch({ type: 'selectMart', id: 'secret_ledger', sourceOf: () => null })}>Select Secret Ledger (test probe)</button>;
}
const reloadModel = () => userEvent.click(screen.getByRole('button', { name: 'Reload model (test probe)' }));

// These tests drive the search as a title filter: the OWOX search finds nothing and no AI is configured, so the title match answers.
// The smart search itself is covered in smart-search.test.tsx.
const titleSearchOnly = (ctx: Ctx): Ctx => ({ ...ctx, credentials: {}, owox: { ...ctx.owox, getJson: ((path: string, q?: Record<string, string>) => (path === '/api/search' ? Promise.resolve([]) : ctx.owox.getJson(path, q))) as Ctx['owox']['getJson'] } });
/** Opens the search, types the query and runs it. */
async function search(q: string) {
  if (!screen.queryByRole('combobox', { name: 'Search data marts' })) {
    const chip = screen.queryByRole('button', { name: /^Search data marts: / });
    await userEvent.click(chip ?? screen.getByRole('button', { name: 'Search data marts' }));
  }
  const box = screen.getByRole('combobox', { name: 'Search data marts' });
  await userEvent.clear(box);
  await userEvent.type(box, `${q}{Enter}`);
}
/** The x on the search: clears the query and restores the band. */
const clearSearch = () => userEvent.click(screen.getByRole('button', { name: 'Clear search' }));

// The orders grid used to open on its key; the key is no longer a default column, so these tests start from a grid that was saved with it.
const withKeyShown = (c: Mock): Mock => keyShown(c);
async function mountWith(wrap: (ctx: Mock) => Ctx = (c) => c, fixtures = demoFixtures(), seedKey = true) {
  const view = render(<AppServices ctx={titleSearchOnly(wrap((seedKey ? withKeyShown : (c: Mock) => c)(createMockCtx(fixtures, { latencyMs: 0 }))))}><StoreProvider><App /><ModelReload /><SelectSecretLedger /></StoreProvider></AppServices>);
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

const headingText = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!).join(' + ');
/** Drags a card onto the main one: the way to a mart the main one cannot join (a click on it only joins it or explains). */
async function makeMain(title: string) {
  await within(marts()).findByText(title);
  dragOntoMain(martCard(title), marts().querySelector('article[aria-pressed="true"]:not([data-path]):not([data-ghost])')!);
}
/** Makes a mart the main one by dragging it onto the main card: a click on the main card only focuses it. */
async function goTo(title: string) {
  await makeMain(title);
  await waitFor(() => expect(headingText() === title || headingText()!.startsWith(`${title} + `)).toBe(true));
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
    for (const name of ['Data Sources', 'Data Marts', 'Data', 'Row']) expect(await screen.findByRole('heading', { name })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Data Explorer' })).toBeInTheDocument();
    expect(document.querySelector('[aria-label="Loading"]')).toBeNull(); // no skeleton rows
    // a bar in every band, the folded Data Sources too: the page keeps its height while it reads
    await waitFor(() => expect(bars()).toHaveLength(4));
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
    expect(within(band('band-data')).getByText('Orders')).toBeInTheDocument();
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
    await waitFor(() => expect(within(data()).getByText('Orders')).toBeInTheDocument());
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
    await within(data()).findByText('Orders');
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('dm-ctl-on'));
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    // 3. a record of the filtered Orders
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    // Orders may show a joined mart here, so its group row sits above the titles: take the first row with cells.
    await userEvent.click(within(data()).getAllByRole('row').find((r) => r.querySelector('td'))!);
    await within(row()).findByRole('heading', { name: /^Orders · \d+$/ });
    const back = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));

    await back(); // Orders, filtered, no record
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('dm-ctl-on');
    expect(filterActive()).toBeEnabled();
    await back(); // the Customers record
    expect(await within(row()).findByRole('heading', { name: customerHeading.textContent! })).toBeInTheDocument();
    expect(within(data()).getByText('Customers')).toBeInTheDocument();
    expect(martCard('Customers')).toHaveAttribute('aria-pressed', 'true');
    await back(); // the Customers mart, no record
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
    await back(); // Orders
    expect(await within(data()).findByText('Orders')).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search data marts' }), { key: 'z', ctrlKey: true });
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
    await userEvent.click(screen.getByRole('button', { name: 'Search data marts' }));
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Search data marts' }), { key: 'ArrowLeft', altKey: true });
    await settle();
    expect(within(row()).getByRole('heading', { name: /^Orders · 1$/ })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(within(row()).getByText('Select a row.')).toBeInTheDocument());
  });

  test('a connected mart the member cannot open is not offered in the band, and when it is selected anyway the card shows No access and the Data band says so', async () => {
    const fixtures = demoFixtures();
    fixtures.edges.push({ id: 'e-orders-secret', sourceDataMartId: 'orders', targetDataMartId: 'secret_ledger', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] });
    await mountWith((c) => c, fixtures);
    await within(data()).findByRole('table');
    // The main mart cannot join a mart nobody here can open, so once the joins are read the band does not list it.
    await waitFor(() => expect(within(marts()).queryByText('Secret Ledger')).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Select Secret Ledger (test probe)' }));
    const card = (await within(marts()).findByText('Secret Ledger')).closest('article')!;
    expect(within(card).getByText('No access')).toBeInTheDocument();
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
    await openSubmenu(within(grid), 'id', 'Filter');
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    await userEvent.click(within(grid).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
  });

  test('the column picker adds a column', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Orders' }));
    await userEvent.click(screen.getByLabelText(/amount/i));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(6));
  });

  test('going back to a mart restores its filters', async () => {
    const grid = await ordersGrid();
    await openSubmenu(within(grid), 'id', 'Filter');
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '3');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(5));
    await goTo('Customers');
    // The make-main button is one step.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByText('Orders');
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
    await within(data()).findByText('Orders');
    await waitFor(() => expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('dm-ctl-on'));
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
    await openSubmenu(within(data()), 'id', 'Filter');
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
    await userEvent.type(screen.getByLabelText('Value'), '1000');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(within(data()).getByLabelText('Filter id')).toHaveClass('dm-ctl-on'));
    await search('order items'); // away, to a mart Orders cannot join: the band lists it only for a search
    await goTo('Order Items');
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByText('Orders');
    await waitFor(() => expect(within(data()).getByLabelText('Filter id')).toHaveClass('dm-ctl-on'));
    expect(within(data()).getByLabelText('Filter Customer')).toHaveClass('dm-ctl-on');
  });

  test('a mart without a primary key is preview only', async () => {
    await mountApp();
    await within(data()).findByRole('table');
    await search('daily');
    await makeMain('Daily KPIs');
    const warning = await within(data()).findByRole('note', { name: NO_PK });
    expect(warning).toBeInTheDocument();
    // The sentence is gone from above the grid; it is the warning's tooltip and the end of the (i) hint.
    expect(within(data()).queryByText(NO_PK)).toBeNull();
    await userEvent.hover(warning);
    expect((await screen.findAllByText(NO_PK)).length).toBeGreaterThan(0);
    await userEvent.unhover(warning);
    await userEvent.hover(within(data()).getByRole('note', { name: 'About Data' }));
    expect((await screen.findAllByText(new RegExp(`Click a row to open it below\\. ${NO_PK}`))).length).toBeGreaterThan(0);
  });

  test('a mart with a primary key shows no warning, and neither does a grouped grid', async () => {
    await ordersGrid();
    expect(within(data()).queryByRole('note', { name: NO_PK })).toBeNull();
  });

  test('a filter with no matches keeps the header, so the filter can be cleared', async () => {
    const grid = await ordersGrid();
    await openSubmenu(within(grid), 'id', 'Filter');
    await userEvent.selectOptions(screen.getByLabelText('Operator'), 'eq');
    await userEvent.type(screen.getByLabelText('Value'), '999999');
    await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(await within(grid).findByText('No rows match the filters.')).toBeInTheDocument();
    expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5);
    await openSubmenu(within(grid), 'id', 'Filter');
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(within(grid).getAllByRole('row')).toHaveLength(202));
  });

  test('a failed read keeps the header and shows the error in the body', async () => {
    await mountWith(overrideTraverse((real) => (id, o) => (o.limit === 201 ? Promise.reject(new Error('read failed')) : real(id, o))));
    expect(await within(data()).findByText('read failed')).toBeInTheDocument();
    expect(within(data()).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(5);
    expect(within(data()).getByLabelText('Column menu id')).toBeInTheDocument();
  });

  test('hiding a column does not read the mart again', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await settle();
    const before = calls.filter((c) => c.id === 'orders').length;
    await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
    await userEvent.click(screen.getAllByRole('option').filter((c) => c.getAttribute('aria-selected') === 'true').at(-1)!);
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
    expect(await within(data()).findByText('Order Items')).toBeInTheDocument();
    await waitFor(() => expect(within(data()).getByRole('button', { name: 'Reset' })).toBeEnabled());
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
  });

  test('a record nobody references has no Referenced by section', async () => {
    await mountApp();
    await within(data()).findByRole('table');
    await search('order items');
    await makeMain('Order Items');
    await within(data()).findByText('Order Items');
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
    await search('a');
    await settle();
    expect(recordReads()).toBe(before + 1);
    expect(gridReads()).toBe(gridBefore + 1);
  });
});

const NO_PK = 'Preview only: this data mart has no primary key.';
const HIDDEN_PK = "Preview only: this data mart's primary key is hidden for reporting.";

describe('search, contexts and refresh', () => {
  test('the page header is the title and the actions (the search first) with no Refresh button', async () => {
    await ordersGrid();
    const header = document.querySelector('header.dm-page-header')!;
    expect(within(header as HTMLElement).getByRole('heading', { level: 1, name: 'Data Explorer' })).toHaveClass('dm-page-header-title');
    expect(within(header as HTMLElement).queryByRole('button', { name: /Refresh/ })).toBeNull();
    expect(header.querySelector('input')).toBeNull();
    expect(within(header as HTMLElement).getByRole('button', { name: 'Search data marts' })).toBeInTheDocument();
    expect(within(marts()).queryByLabelText('Search data marts')).toBeNull();
    expect(document.querySelector('main.dm-page-content')).not.toBeNull();
  });

  test('search narrows the marts and keeps the selection, its card included', async () => {
    await ordersGrid();
    await search('zzzz');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).getByText('Orders')).toBeInTheDocument();
    expect(within(data()).getByText('Orders')).toBeInTheDocument();
    await clearSearch();
    expect(await within(marts()).findByText('Customers')).toBeInTheDocument();
  });

  test('the search reads the title only: a context name finds nothing', async () => {
    await ordersGrid();
    await search('marketing');
    await waitFor(() => expect(within(marts()).queryByText('Customers')).toBeNull());
    expect(within(marts()).queryByText('Campaigns')).toBeNull();
    await clearSearch();
    await search('campaign');
    expect(await within(marts()).findByText('Campaigns')).toBeInTheDocument();
    expect(within(marts()).getByText('Campaigns').closest('article')!.querySelector('.dm-badge-shrink')).toBeNull();
  });

  test('the toolbar holds Storage (the search is in the page header); the Grid / Graph switch and then the Contexts badges sit in the title row after the hint', async () => {
    await ordersGrid();
    const tools = marts().querySelector('.dm-band-tools')!;
    const kinds = [...tools.children].map((c) => (c.matches('button.dm-search-btn') ? 'search' : c.querySelector('summary')?.firstChild?.textContent));
    expect(kinds).toEqual(['Storage']);
    const head = marts().querySelector('.dm-band-titlegroup')!;
    const order = [...head.children].map((c) => c.className.split(' ')[0]);
    expect(order.indexOf('dm-context-filter')).toBeGreaterThan(order.indexOf('dm-hint'));
    expect(head.querySelector('.dm-context-filter')!.previousElementSibling).toBe(within(marts()).getByRole('radiogroup', { name: 'Show data marts as' }));
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
    expect(within(data()).getByText('Orders')).toBeInTheDocument();
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
    await waitFor(() => expect(within(data()).getByText('Orders')).toBeInTheDocument());
    // The replacement left no history entry: Back steps to the earlier Orders selection and then stops.
    const back = screen.getByRole('button', { name: 'Undo' });
    await userEvent.click(back); // making Customers main was one step
    expect(within(data()).getByText('Orders')).toBeInTheDocument();
    await waitFor(() => expect(back).toBeDisabled());
  });
});

describe('folding and lines', () => {
  test('a band folds from its chevron', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    await waitFor(() => expect(within(data()).queryByRole('table')).toBeNull());
  });

  test('folding the Data band and unfolding it does not ask for the rows again', async () => {
    const calls = await spyOnTraverse();
    await within(data()).findByRole('table');
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    const before = calls.length;
    await userEvent.click(within(data()).getByRole('button', { name: /^Hide / }));
    await waitFor(() => expect(within(data()).queryByRole('table')).toBeNull());
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
    // Adding from the band focuses the new card; Stores joins Orders, not Customers, so let go of the focus first.
    await waitFor(() => expect(martCard('Customers')).toHaveAttribute('data-focused'));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(martCard('Customers')).not.toHaveAttribute('data-focused'));
    fireEvent.click(martCard('Stores'));
    await settle();
    expect(rowQueries()).toHaveLength(before);
    await userEvent.click(within(data()).getByRole('button', { name: /^Show / }));
    await waitFor(() => expect(within(data()).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent)).toEqual(['Orders', 'Customers', 'Stores']));
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
      // The body collapses over 200ms, and leaves the page when that is done.
      await waitFor(() => expect(martCard('Customers')).not.toBeVisible());
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
    expect(within(grid).getByLabelText('Column menu Customer')).toBeInTheDocument();
    const id = within(grid).getByText('id', { selector: 'span.truncate' });
    expect(id).not.toHaveAttribute('title');
  });

  test('the column picker shows the alias only, and a (?) with the description when the field has one', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Orders' }));
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

  test('the filter icon shows only while a filter is set, and then stays on screen', async () => {
    const grid = await ordersGrid();
    expect(within(grid).queryByLabelText('Filter id')).toBeNull();
    await openSubmenu(within(grid), 'id', 'Filter');
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
    await openSubmenu(within(grid), 'id', 'Filter');
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
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Orders' }));
    await userEvent.click(screen.getByLabelText(/Amount/));
    await waitFor(() => expect(within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')).toHaveLength(6));
  });

  test('the content is one card inside the band, and folding the band takes the controls with it', async () => {
    const grid = await ordersGrid();
    expect(grid.querySelector('.dm-bigcard')).toContainElement(within(grid).getByRole('table'));
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Hide Data' }));
    await waitFor(() => expect(within(grid).queryByRole('button', { name: 'Reset' })).toBeNull());
  });

  test('unfolding the band brings back exactly one set of controls', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Hide Data' }));
    await userEvent.click(within(head(grid)).getByRole('button', { name: 'Show Data' }));
    await within(grid).findByRole('table');
    expect(within(grid).getAllByRole('button', { name: 'Reset' })).toHaveLength(1);
    expect(within(grid).getAllByRole('button', { name: 'Refresh' })).toHaveLength(1);
    expect(within(grid).getAllByRole('button', { name: /^Fields of / })).toHaveLength(1);
  });

  test('the Row band has Refresh in its header and no Back; Undo and Redo sit after the page title', async () => {
    await ordersGrid();
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    await within(row()).findByText('status');
    const bar = head(row());
    expect(within(bar).queryByRole('button', { name: /Back/ })).toBeNull();
    expect(within(bar).getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
    const lead = document.querySelector('.dm-page-header-lead')!;
    expect([...lead.children].map((c) => c.tagName)).toEqual(['H1']);
    const actions = document.querySelector<HTMLElement>('.dm-page-header-actions')!;
    expect(within(actions).getByRole('button', { name: 'Undo' })).toBeEnabled();
    expect(within(actions).getByRole('button', { name: 'Redo' })).toBeDisabled();
    const names = within(actions).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names.slice(-3)).toEqual(['Undo', 'Redo', 'Copy link to this view']);
  });
});

describe('the storage filter', () => {
  const head = () => marts().querySelector<HTMLElement>('.dm-band-head')!;
  const storageMenu = () => within(head()).getByText('Storage').closest('details')!;

  test('is in the Data Marts header, ticked by default, with a count per storage', async () => {
    await ordersGrid();
    const menu = storageMenu();
    expect(within(menu).getByText('All')).toBeInTheDocument();
    expect(within(menu).getByRole('option', { name: /Demo Warehouse/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(menu).getByRole('option', { name: /Sales Lake/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(menu).getByRole('option', { name: /Sales Lake/ })).toHaveTextContent('4');
  });

  test('unticking Sales Lake removes Payments from the band; the selected Data Source stays selected', async () => {
    await ordersGrid();
    // Orders cannot join Payments, so the band lists it through its Data Source.
    fireEvent.click(within(sources()).getByText('Shopify').closest('article')!);
    await within(marts()).findByText('Payments');
    await userEvent.click(within(storageMenu()).getByRole('option', { name: /Sales Lake/ }));
    await waitFor(() => expect(within(marts()).queryByText('Payments')).toBeNull());
    expect(within(marts()).getByText('Customers')).toBeInTheDocument();
    expect(within(sources()).getByText('Shopify').closest('article')).toHaveAttribute('aria-pressed', 'true');
  });

  test('a selected mart in an unticked storage leaves the Data Marts band but stays in the Data band', async () => {
    await ordersGrid();
    // The band lists Payments for a search; its make-main button makes it the main mart.
    await search('payments');
    await makeMain('Payments');
    await within(data()).findByText('Payments');
    await userEvent.click(within(storageMenu()).getByRole('option', { name: /Sales Lake/ }));
    await waitFor(() => expect(within(marts()).queryByText('Payments')).toBeNull());
    expect(within(data()).getByText('Payments')).toBeInTheDocument();
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
    await userEvent.click(within(storageMenu()).getByRole('button', { name: 'Clear' }));
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
    expect(header(grid, 'status').querySelector('[data-sort-mark].dm-ctl-on svg.lucide-arrow-up')).not.toBeNull();
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'descending'));
    expect(header(grid, 'status').querySelector('[data-sort-mark].dm-ctl-on svg.lucide-arrow-down')).not.toBeNull();
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status')).toHaveAttribute('aria-sort', 'none'));
    expect(header(grid, 'status').querySelector('[data-sort-mark].dm-ctl-on')).toBeNull();
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
    await openSubmenu(within(grid), 'Customer', 'Filter');
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
    // The make-main button is one step.
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await within(data()).findByText('Orders');
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
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Orders' }));
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
    const delay = { ms: 1500 };
    await mountWith(slow(delay));
    const first = await within(data()).findByRole('progressbar', { name: 'Loading rows' });
    expect(first).toHaveClass('dm-progress');
    expect(first.closest('.dm-bigcard')).not.toBeNull();
    await within(data()).findByRole('table');
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await waitFor(() => expect(bar()).toBeNull());

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
    await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
    await userEvent.click(screen.getByLabelText('created_at'));
    const head = await within(data()).findByRole('button', { name: /^Sort by created_at, currently descending/ });
    expect(head.closest('th')).toHaveAttribute('aria-sort', 'descending');
    expect(head.closest('th')!.querySelector('[data-sort-mark].dm-ctl-on svg.lucide-arrow-down')).not.toBeNull();
  });

  test('a date column among the visible ones is the default, with its arrow from the start', async () => {
    const calls = await spyOnTraverse();
    await waitFor(() => expect(within(data()).getAllByRole('row')).toHaveLength(202));
    await search('daily');
    await makeMain('Daily KPIs');
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
    await search('daily');
    await makeMain('Daily KPIs');
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
    await search('product');
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
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Customers' }));
    expect(screen.queryByText('internal_flag')).toBeNull();
    // The Export menu has its own separator, so only the picker's are looked at.
    expect(screen.queryAllByRole('separator').filter((x) => !x.closest('.dm-export'))).toEqual([]);
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByText('email');
    expect(within(row()).queryByText('internal_flag')).toBeNull();
    const named = calls.filter((c) => c.id === 'customers').flatMap((c) => [...(c.o.column ?? []), ...(c.o.sort ?? []).map((s) => s.column), ...(c.o.filter ?? []).map((f) => f.column)]);
    expect(named).not.toContain('internal_flag');
  });

  test('a mart whose primary key is hidden for reporting is preview only (and says so), with no 400, a record count, and no key in the picker', async () => {
    const f = demoFixtures();
    const stores = f.marts.find((m) => m.id === 'stores')!;
    stores.fields = stores.fields.map((x) => (x.name === 'id' ? { ...x, isHiddenForReporting: true } : x));
    const queries: { id: string; o: { column?: string[]; sort?: { column: string }[] } }[] = [];
    await mountWith(overrideTraverse((real) => (id, o) => { queries.push({ id, o }); return real(id, o); }), f);
    await within(data()).findByRole('table');
    await search('stores');
    await within(marts()).findByText('Stores');
    await goTo('Stores');
    expect(await within(data()).findByRole('note', { name: HIDDEN_PK })).toBeInTheDocument();
    expect(within(data()).queryByRole('note', { name: NO_PK })).toBeNull();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => !!r.querySelector('td')?.textContent)).toBe(true));
    expect(within(data()).queryByText(/Unknown column/)).toBeNull();
    await userEvent.click(within(data()).getAllByRole('row')[2]!);
    expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
    const named = queries.filter((q) => q.id === 'stores').flatMap((q) => [...(q.o.column ?? []), ...(q.o.sort ?? []).map((s) => s.column)]);
    expect(named).not.toContain('id');
    // The mart is still counted by its key: Unique Count is sent for it, and no card says it cannot count.
    expect(queries.some((q) => q.id === 'stores' && (q.o as { uniqueCount?: string[] }).uniqueCount?.[0] === '')).toBe(true);
    expect(screen.queryByText(/Can't count records/)).toBeNull();
  });

  test('a fresh orders grid does not show its key column, and a row still opens', async () => {
    await mountWith((c) => c, demoFixtures(), false);
    const grid = await within(data()).findByRole('table');
    await waitFor(() => expect(within(grid).getAllByRole('row').length).toBeGreaterThan(2));
    expect(within(grid).queryByLabelText('Column menu id')).toBeNull();
    expect(within(grid).getByLabelText('Column menu status')).toBeInTheDocument();
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await waitFor(() => expect(within(row()).queryByText('Select a row.')).toBeNull());
    expect(within(data()).queryByRole('note', { name: NO_PK })).toBeNull();
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
    expect(grid.querySelector('thead tr:not([data-group-row]) th[aria-hidden]')!.className).toContain('w-full');
    // The line under the header is a shadow on every header cell (the filler too), so it survives a sticky header over a scrolling body.
    expect(grid.querySelector('thead tr:not([data-group-row]) th[aria-hidden]')!.className).toContain('dm-th');
    // The tab row has its own filler, which carries the line under the tabs to the card's edge.
    expect(grid.querySelector('thead tr[data-group-row] th[aria-hidden]')!.className).toContain('dm-gh-fill');
    for (const h of within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup')) expect(h.className).toContain('dm-th');
  });

  test('the (?) after a field label is revealed by its row, in the picker and in the Row band', async () => {
    const grid = await ordersGrid();
    await userEvent.click(within(grid).getByRole('button', { name: 'Fields of Orders' }));
    const hint = screen.getAllByLabelText('About Customer').find((el) => el.closest('.dm-checklist-row'))!;
    expect(hint.closest('.dm-checklist-row')).toHaveClass('dm-reveal-host');
    expect(hint.closest('.dm-hint-slot')).not.toBeNull();
    // beside the option, not inside it
    expect(hint.closest('[role="option"]')).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(within(grid).getAllByRole('row')[2]!);
    await within(row()).findByText('status');
    expect(within(row()).getByLabelText('About Customer').closest('dt')).toHaveClass('dm-reveal-host');
  });

  test('the Fields icon of a tab shows on hover of its cell, in the same green and size as the column menu icons', async () => {
    const grid = await ordersGrid();
    const icon = within(grid).getByRole('button', { name: 'Fields of Orders' });
    expect(icon).toHaveClass('dm-reveal');
    expect(icon).not.toHaveClass('dm-reveal-on');
    expect(icon).toHaveClass('dm-ctl', 'dm-ctl-lg');
    expect(within(grid).getByLabelText('Column menu id')).toHaveClass('dm-ctl', 'dm-ctl-lg', 'dm-reveal');
    expect(icon.closest('th')).toHaveClass('dm-gh');
  });

  test('the main data mart is the first card, whatever the search says', async () => {
    await ordersGrid();
    const first = () => marts().querySelector('article')!.textContent;
    expect(first()).toContain('Orders');
    await search('Customers');
    await waitFor(() => expect(within(marts()).queryByText('Products')).toBeNull());
    expect(first()).toContain('Orders');
  });

  test('a filter panel is capped at 20rem (bands.css .dm-menu-editor) with no title row above the scrolling body', async () => {
    await ordersGrid();
    await search('daily');
    await makeMain('Daily KPIs');
    await within(data()).findByText('Daily KPIs');
    await openSubmenu(within(data()), 'day', 'Filter');
    const body = (await screen.findByRole('menu', { name: 'Filter day' })).closest('[data-popover-body]')!;
    expect(body.parentElement).toHaveClass('dm-menu-editor');
    expect(body.className).toContain('overflow-y-auto');
    expect(body.querySelector('.dm-popover-title')).toBeNull();
  });
});

describe('the grid chrome', () => {
  const letters = (grid: HTMLElement) => [...grid.querySelectorAll('thead .dm-letter[data-chrome]')].map((e) => e.textContent).filter(Boolean);
  const selectedCell = (grid: HTMLElement) => grid.querySelector('td[data-selected]');

  test('one letter per column and a number per row, all decorative', async () => {
    const grid = await ordersGrid();
    const columns = within(grid).getAllByRole('columnheader').filter((h) => h.getAttribute('scope') !== 'colgroup').length;
    expect(letters(grid)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'].slice(0, columns));
    const numbers = [...grid.querySelectorAll('tbody th[data-chrome]')].map((e) => e.textContent);
    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3']);
    expect(grid.querySelector('thead tr[data-chrome]')).toHaveAttribute('aria-hidden', 'true');
    expect(grid.querySelector('tbody th[data-chrome]')).toHaveAttribute('aria-hidden', 'true');
  });

  test('a click selects the cell and lights its letter and number, and still opens the row', async () => {
    const grid = await ordersGrid();
    const cell = within(grid).getAllByRole('row')[3]!.querySelectorAll('td')[1]!;
    await userEvent.click(cell);
    expect(selectedCell(grid)).toBe(cell);
    expect(grid.querySelectorAll('[data-chrome][data-selected]')).toHaveLength(2);
    expect(grid.querySelector('thead .dm-letter[data-selected]')).toHaveTextContent('B');
    expect(grid.querySelector('tbody th[data-selected]')).toHaveTextContent('2');
    expect(await within(row()).findByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
  });

  test('arrow keys move the selection, Escape clears it, and rows do not highlight on hover', async () => {
    const grid = await ordersGrid();
    const box = grid.querySelector<HTMLElement>('.dm-grid-root')!;
    expect(box).toHaveAttribute('tabindex', '0');
    await userEvent.click(within(grid).getAllByRole('row')[2]!.querySelectorAll('td')[0]!);
    expect(grid.querySelector('tbody th[data-selected]')).toHaveTextContent('1');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowRight' });
    expect(grid.querySelector('tbody th[data-selected]')).toHaveTextContent('2');
    expect(grid.querySelector('thead .dm-letter[data-selected]')).toHaveTextContent('B');
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(grid.querySelector('tbody th[data-selected]')).toHaveTextContent('1');
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(selectedCell(grid)).toBeNull();
    expect(grid.querySelector('tbody tr')!.className).not.toContain('hover:');
  });
});

describe('whole column and row selection, and the header layout', () => {
  const sortBtn = (grid: HTMLElement, label: string) => within(grid).getByRole('button', { name: new RegExp(`^Sort by ${label},`) });
  const header = (grid: HTMLElement, label: string) => sortBtn(grid, label).closest('th')!;
  const cellsOfCol = (grid: HTMLElement, c: number) => [...grid.querySelectorAll('tbody tr')].map((tr) => tr.querySelectorAll('td')[c]!).filter((td) => !td.getAttribute('aria-hidden'));

  test('a click on a column letter marks every cell of that column and lights the letter strongly', async () => {
    const grid = await ordersGrid();
    const letter = [...grid.querySelectorAll<HTMLElement>('thead .dm-letter[data-chrome]')].find((e) => e.textContent === 'B')!;
    await userEvent.click(letter);
    const col = cellsOfCol(grid, 1);
    expect(col.length).toBeGreaterThan(2);
    expect(col.every((td) => td.hasAttribute('data-range'))).toBe(true);
    expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(col.length);
    expect(col[0]).toHaveAttribute('data-edge', 'l r t');
    expect(col[1]).toHaveAttribute('data-edge', 'l r');
    expect(letter).toHaveAttribute('data-selected', 'full');
    expect(grid.querySelectorAll('thead .dm-letter[data-selected]')).toHaveLength(1);
    expect(grid.querySelector('td[data-selected]')).toBeNull();
    // shift extends to a range of columns
    const d = [...grid.querySelectorAll<HTMLElement>('thead .dm-letter[data-chrome]')].find((e) => e.textContent === 'D')!;
    fireEvent.click(d, { shiftKey: true });
    expect(grid.querySelectorAll('thead .dm-letter[data-selected="full"]')).toHaveLength(3);
    // Escape clears, arrows leave a whole column for one cell
    const box = grid.querySelector<HTMLElement>('.dm-grid-root')!;
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(grid.querySelector('[data-range]')).toBeNull();
    await userEvent.click(letter);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(grid.querySelector('[data-range]')).toBeNull();
    expect(grid.querySelectorAll('td[data-selected]')).toHaveLength(1);
  });

  test('a click on a row number marks every cell of that row and still opens the record', async () => {
    const grid = await ordersGrid();
    const number = [...grid.querySelectorAll<HTMLElement>('tbody th[data-chrome]')][1]!;
    await userEvent.click(number);
    const tr = number.closest('tr')!;
    const cells = [...tr.querySelectorAll('td')].filter((td) => !td.getAttribute('aria-hidden'));
    expect(cells.every((td) => td.hasAttribute('data-range'))).toBe(true);
    expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(cells.length);
    expect(number).toHaveAttribute('data-selected', 'full');
    expect(await within(row()).findByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
  });

  test('shift-click on a row number extends the rows and opens no other record', async () => {
    const grid = await ordersGrid();
    const numbers = [...grid.querySelectorAll<HTMLElement>('tbody th[data-chrome]')];
    await userEvent.click(numbers[1]!);
    expect(await within(row()).findByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
    const user = userEvent.setup();
    await user.keyboard('{Shift>}');
    await user.click(numbers[3]!);
    await user.keyboard('{/Shift}');
    expect(numbers.slice(1, 4).every((n) => n.getAttribute('data-selected') === 'full')).toBe(true);
    // the record stays the one first opened: the shift-click does not open row 4
    await new Promise((r) => setTimeout(r, 300));
    expect(within(row()).getByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
  });

  describe('shift-click and Shift+Arrow make a block of cells', () => {
    const bodyCell = (grid: HTMLElement, r: number, c: number) => grid.querySelectorAll('tbody tr')[r]!.querySelectorAll('td')[c]!;
    const selectedCell = (grid: HTMLElement) => grid.querySelector('td[data-selected]');
    const lit = (grid: HTMLElement) => ({
      letters: [...grid.querySelectorAll('thead .dm-letter[data-selected]')].map((e) => [e.textContent, e.getAttribute('data-selected')]),
      numbers: [...grid.querySelectorAll('tbody th[data-selected]')].map((e) => [e.textContent, e.getAttribute('data-selected')]),
    });

    test('shift-click on another cell: the first cell stays active, the block is tinted and framed, handle at the far corner, headers lit lightly, no other record opens', async () => {
      const grid = await ordersGrid();
      await userEvent.click(bodyCell(grid, 1, 1));
      expect(await within(row()).findByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
      const user = userEvent.setup();
      await user.keyboard('{Shift>}');
      await user.click(bodyCell(grid, 3, 3));
      await user.keyboard('{/Shift}');
      const block = [1, 2, 3].flatMap((r) => [1, 2, 3].map((c) => bodyCell(grid, r, c)));
      expect(block.every((td) => td.hasAttribute('data-range'))).toBe(true);
      expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(9);
      expect(grid.querySelectorAll('tbody td[data-active]')).toHaveLength(1);
      expect(bodyCell(grid, 1, 1)).toHaveAttribute('data-active');
      expect(grid.querySelectorAll('tbody td[data-handle]')).toHaveLength(1);
      expect(bodyCell(grid, 3, 3)).toHaveAttribute('data-handle');
      expect(bodyCell(grid, 1, 1)).toHaveAttribute('data-edge', 'l t');
      expect(bodyCell(grid, 2, 2)).toHaveAttribute('data-edge', '');
      expect(bodyCell(grid, 3, 3)).toHaveAttribute('data-edge', 'r b');
      expect(grid.querySelector('td[data-selected]')).toBeNull();
      expect(lit(grid)).toEqual({ letters: [['B', ''], ['C', ''], ['D', '']], numbers: [['2', ''], ['3', ''], ['4', '']] });
      await new Promise((r) => setTimeout(r, 300));
      expect(within(row()).getByRole('heading', { name: /^Orders · 2$/ })).toBeInTheDocument();
    });

    test('the block can run up and left of the first cell; the first cell is still the active one', async () => {
      const grid = await ordersGrid();
      await userEvent.click(bodyCell(grid, 3, 3));
      fireEvent.click(bodyCell(grid, 1, 2), { shiftKey: true });
      expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(6);
      expect(bodyCell(grid, 3, 3)).toHaveAttribute('data-active');
      expect(bodyCell(grid, 3, 3)).toHaveAttribute('data-handle');
      expect(bodyCell(grid, 1, 2)).toHaveAttribute('data-edge', 'l t');
    });

    test('Shift+Arrow grows and shrinks the block from the active cell; a plain click or Escape ends it', async () => {
      const grid = await ordersGrid();
      const box = grid.querySelector<HTMLElement>('.dm-grid-root')!;
      await userEvent.click(bodyCell(grid, 1, 1));
      fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
      fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
      fireEvent.keyDown(box, { key: 'ArrowRight', shiftKey: true });
      expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(6);
      expect(bodyCell(grid, 1, 1)).toHaveAttribute('data-active');
      expect(bodyCell(grid, 2, 3)).toHaveAttribute('data-handle');
      fireEvent.keyDown(box, { key: 'ArrowUp', shiftKey: true });
      fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
      expect(grid.querySelectorAll('tbody td[data-range]')).toHaveLength(2);
      fireEvent.keyDown(box, { key: 'ArrowLeft', shiftKey: true });
      // back on the active cell: a single selected cell again, no block
      expect(grid.querySelector('[data-range]')).toBeNull();
      expect(selectedCell(grid)).toBe(bodyCell(grid, 1, 1));
      fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
      fireEvent.keyDown(box, { key: 'Escape' });
      expect(grid.querySelector('[data-range]')).toBeNull();
      expect(selectedCell(grid)).toBeNull();
      await userEvent.click(bodyCell(grid, 1, 1));
      fireEvent.keyDown(box, { key: 'ArrowDown', shiftKey: true });
      await userEvent.click(bodyCell(grid, 2, 2));
      expect(grid.querySelector('[data-range]')).toBeNull();
      expect(selectedCell(grid)).toBe(bodyCell(grid, 2, 2));
    });
  });

  test('a filter, an aggregation and a sort in use are green line icons and keep the menu icon on; idle ones are not', async () => {
    const grid = await ordersGrid();
    expect(within(grid).queryByLabelText('Filter id')).toBeNull();
    expect(within(grid).getByLabelText('Column menu id')).not.toHaveClass('dm-ctl-on');
    expect(within(grid).getByLabelText('Column menu id')).not.toHaveClass('dm-reveal-on');
    expect(within(grid).getByLabelText('Column menu id')).toHaveClass('dm-ctl');
    await userEvent.click(sortBtn(grid, 'status'));
    await waitFor(() => expect(header(grid, 'status').querySelector('[data-sort-mark]')).toHaveClass('dm-ctl-on'));
    expect(within(grid).getByLabelText('Column menu status')).toHaveClass('dm-ctl-on', 'dm-reveal-on');
    expect(header(grid, 'id').querySelector('[data-sort-mark]')).toBeNull();
  });

  test('a header reads: title, then the (i), then a spacer, then the controls at the right', async () => {
    const grid = await ordersGrid();
    // Customer has a description, so its header has the (i)
    const hdr = header(grid, 'Customer').querySelector('.dm-hdr')!;
    const kids = [...hdr.children];
    const at = (pred: (e: Element) => boolean) => kids.findIndex(pred);
    const title = at((e) => e.matches('button.dm-sort, span.inline-flex') || !!e.querySelector('.truncate'));
    const spacer = at((e) => e.classList.contains('dm-hdr-spacer'));
    const controls = at((e) => e.classList.contains('dm-hdr-controls'));
    expect(title).toBe(0);
    expect(spacer).toBeGreaterThan(title);
    expect(controls).toBe(spacer + 1);
    expect(controls).toBe(kids.length - 1);
    const info = at((e) => e.getAttribute('aria-label')?.startsWith('About ') ?? false);
    expect(info).toBe(1);
    expect(hdr.querySelector('.dm-hdr-controls [aria-label^="Column menu"]')).not.toBeNull();
  });
});

test('a mart the main one cannot join is dimmed in a search, and a click explains instead of switching', async () => {
  await mountWith();
  await search('Order Items');
  const marts = document.getElementById('band-marts')!;
  const items = (await within(marts).findByText('Order Items')).closest('article')!;
  expect(items).toHaveClass('dm-unjoinable');
  fireEvent.click(items);
  expect(await within(items).findByRole('status')).toHaveTextContent("Can't join Orders. Drag it onto Orders to make it the main data mart.");
  expect(marts.querySelector('article')).toHaveTextContent('Orders');
  expect(within(document.getElementById('band-data')!).queryAllByRole('columnheader').some((h) => h.textContent === 'Order Items')).toBe(false);
});

test('with a mart nobody can open as the main one, a click on another card makes it the main one', async () => {
  const fixtures = demoFixtures();
  fixtures.edges.push({ id: 'e-orders-secret', sourceDataMartId: 'orders', targetDataMartId: 'secret_ledger', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] });
  await mountWith((c) => c, fixtures);
  await within(data()).findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Select Secret Ledger (test probe)' }));
  await within(data()).findByText('You do not have access to this data mart');
  fireEvent.click((await within(marts()).findByText('Orders')).closest('article')!);
  await waitFor(() => expect(headingText()).toBe('Orders'));
});

test('a click on an unreadable main card focuses it and does not deselect it', async () => {
  const fixtures = demoFixtures();
  fixtures.edges.push({ id: 'e-orders-secret', sourceDataMartId: 'orders', targetDataMartId: 'secret_ledger', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] });
  await mountWith((c) => c, fixtures);
  await within(data()).findByRole('table');
  await userEvent.click(screen.getByRole('button', { name: 'Select Secret Ledger (test probe)' }));
  await within(data()).findByText('You do not have access to this data mart');
  const card = (await within(marts()).findByText('Secret Ledger')).closest('article')!;
  fireEvent.click(card);
  await waitFor(() => expect(card).toHaveAttribute('data-focused'));
  expect(within(data()).getByText('You do not have access to this data mart')).toBeInTheDocument();
});

test('a failed read of the main mart joins leaves the one-hop band with nothing dimmed', async () => {
  await mountWith((c) => ({ ...c, owox: { ...c.owox, getJson: ((path: string, q?: Record<string, string>) => (path.endsWith('/blendable-schema') ? Promise.reject(new Error('blendable down')) : c.owox.getJson(path, q))) as Ctx['owox']['getJson'] } }));
  await within(data()).findByRole('table');
  await within(marts()).findByText('Customers');
  // Let the failed read settle.
  await new Promise((r) => setTimeout(r, 50));
  expect(within(marts()).getAllByRole('article').length).toBeGreaterThan(1);
  expect(marts().querySelectorAll('.dm-unjoinable')).toHaveLength(0);
});

describe('ghost cards on hover', () => {
  const marts = () => document.getElementById('band-marts')!;
  const cardOf = (t: string) => within(marts()).getByText(t).closest('article')!;

  test('hovering a card shows its neighbours that are not in the band, dashed, after the last card', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    expect(within(marts()).queryByText('Sessions')).toBeNull();
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    expect(ghost).toHaveClass('dm-ghost');
    expect(ghost).toHaveAttribute('data-ghost');
    const all = [...marts().querySelectorAll('article')];
    expect(all.indexOf(ghost)).toBeGreaterThan(all.indexOf(cardOf('Customers')));
  });

  test('the ghosts stay while the pointer crosses to them, and go once it leaves', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.pointerOver(marts());
    fireEvent.pointerOver(ghost);
    await new Promise((r) => setTimeout(r, 500));
    expect(within(marts()).getByText('Sessions')).toBeInTheDocument();
    fireEvent.pointerLeave(document.querySelector('.dm-canvas')!);
    await waitFor(() => expect(within(marts()).queryByText('Sessions')).toBeNull());
  });

  test('keyboard focus on a card shows the same ghosts', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.focus(cardOf('Customers'));
    expect(await within(marts()).findByText('Sessions')).toBeInTheDocument();
  });

  test('a ghost of a mart the main one cannot join is dimmed and explains on click', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    expect(ghost).toHaveClass('dm-unjoinable');
    fireEvent.click(ghost);
    expect(await within(ghost).findByRole('status')).toHaveTextContent("Can't join Orders. Use Make it main in the section header to make it the main data mart.");
  });

  test('crossing another card on the way to a ghost keeps the ghosts', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.pointerOver(cardOf('Products'));
    fireEvent.pointerOver(ghost);
    await new Promise((r) => setTimeout(r, 500));
    expect(within(marts()).getByText('Sessions')).toBeInTheDocument();
  });

  test('resting on another card for over 400 ms switches the ghosts', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    await within(marts()).findByText('Sessions');
    fireEvent.pointerOver(cardOf('Products'));
    await waitFor(() => expect(within(marts()).queryByText('Sessions')).toBeNull(), { timeout: 1500 });
  });

  test('a ghost has no make-main button', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    expect(within(ghost).queryByRole('button', { name: /make (it )?main/i })).toBeNull();
  });

  test('a clicked ghost the main one cannot join is picked: the header offers Make it main, and it makes that mart the main one', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    expect(screen.queryByRole('button', { name: /^Make it main: / })).toBeNull();
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.click(ghost);
    expect(ghost).toHaveAttribute('data-focused');
    // The pointer leaves for the header: the picked ghost stays.
    fireEvent.pointerOver(document.body);
    await new Promise((r) => setTimeout(r, 500));
    expect(within(marts()).getByText('Sessions')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: /^Make it main: / }));
    await waitFor(() => expect(document.querySelector('#band-data thead tr[data-group-row] th[data-group]')).toHaveTextContent('Sessions'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Make it main: / })).toBeNull());
  });

  test('a click on the band background drops the pick, and the header button goes', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.click(ghost);
    await screen.findByRole('button', { name: /^Make it main: / });
    fireEvent.click(marts().querySelector('.dm-band-body')!);
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Make it main: / })).toBeNull());
  });

  test('clicking a joinable card after picking a ghost drops the pick', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.click(ghost);
    await screen.findByRole('button', { name: /^Make it main: / });
    fireEvent.click(cardOf('Products'));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Make it main: Sessions' })).toBeNull());
  });

  test('ghosts do not change the band total and request no row count', async () => {
    const calls = await spyOnTraverse();
    await within(marts()).findByText('Customers');
    const total = () => document.querySelector('#band-marts .dm-band-count')!.textContent;
    const before = total();
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    await settle();
    expect(total()).toBe(before);
    const sessions = ghost.id.slice(3);
    expect(calls.filter((c) => c.id === sessions)).toEqual([]);
  });
});
