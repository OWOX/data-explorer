import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION } from '../api/grid-columns';
import { CHARTS_COLLECTION } from '../api/chart-settings';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures, type Fixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { App } from '../ui/App';
import { SAVED_COLUMNS_WAIT_MS } from '../ui/explorer/MartGrid';
import { openColumnMenu, openConfigMenu, closeConfigMenu, openFields, openSubmenu } from '../ui/explorer/menu-test-utils';
import type { ChartSettings } from './settings';

// Orders: a primary key, a date, a number and a string; Products joins it with a number of its own (price).
const COLUMNS = ['id', 'status', 'amount', 'created_at', 'products__price'];

function setup(opts: { charts?: ChartSettings; columns?: string[]; gate?: Promise<void>; fail?: (o: TraverseOptions) => boolean; mapRow?: (row: Row) => Row; aggregations?: { column: string; function: string }[]; calc?: boolean; uc?: boolean; /** Holds the keys read (a HAVING rule's, limit 501) until it resolves. */ hold?: Promise<void>; fixtures?: Fixtures } = {}) {
  const base = createMockCtx(opts.fixtures ?? demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const puts = vi.fn();
  const gridPuts = vi.fn();
  // The demo fixtures have no calculated field: with `calc`, the schema gains a metric-level `net` and every row of an orders read carries net = 42 (the mock backend rejects the unknown column, so it and any rule on it are cut from the request; it knows no HAVING on a calculated column, so every group passes).
  const calcOf = (o: TraverseOptions): TraverseOptions => ({ ...o, column: o.column?.filter((c) => c !== 'net'), sort: o.sort?.filter((x) => x.column !== 'net'), filter: o.filter?.filter((r) => r.column !== 'net') });
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox,
      getJson: opts.calc ? (async (path: string, ...rest: unknown[]) => {
        const d = await (base.owox.getJson as (p: string, ...r: unknown[]) => Promise<{ schema?: { fields?: unknown[] } }>)(path, ...rest);
        return path === '/api/data-marts/orders' ? { ...d, schema: { ...d.schema, fields: [...(d.schema?.fields ?? []), { name: 'net', type: 'NUMERIC', calculated: { level: 'metric' } }] } } : d;
      }) as Ctx['owox']['getJson'] : base.owox.getJson,
      dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); if (id === 'orders' && opts.fail?.(o)) return Promise.reject(new Error('range failed')); const held = id === 'orders' && opts.hold && o.limit === 501 ? opts.hold : Promise.resolve(); const tr = held.then(() => (id === 'orders' && opts.calc ? real(id, calcOf(o)).then((x) => ({ ...x, rowChunks: async function* () { for await (const c of x.rowChunks()) yield c.map((r) => ({ ...r, net: 42 })); } })) : real(id, o))); const map = opts.mapRow; return map ? tr.then((x) => ({ ...x, rowChunks: async function* () { for await (const c of x.rowChunks()) yield c.map(map); } })) : tr; } } },
    collections: <T,>(name: string) => {
      const c = base.collections<T>(name);
      if (name === GRID_COLUMNS_COLLECTION) return { get: (id: string) => c.get(id), put: (id: string, d: T) => { gridPuts(id, d); return c.put(id, d); } };
      return name === CHARTS_COLLECTION ? { get: (id: string) => (opts.gate ? opts.gate.then(() => c.get(id)) : c.get(id)), put: (id: string, d: T) => { puts(id, d); return c.put(id, d); } } : c;
    },
  };
  const seeded = Promise.all([
    ctx.collections<{ columns: string[]; at: string; aggregations?: unknown; gridView?: unknown }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: opts.columns ?? COLUMNS, at: 'then', ...(opts.uc ? { gridView: { fl: [], s: null, l: 100, uc: [''] } } : {}), ...(opts.aggregations ? { aggregations: opts.aggregations } : {}) }),
    opts.charts ? ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', opts.charts) : undefined,
  ]);
  return { queries, puts, gridPuts, seeded, view: () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>) };
}

const lastGrid = (t: { gridPuts: { mock: { calls: unknown[][] } } }) => t.gridPuts.mock.calls.at(-1)![1] as { columns: string[]; aggregations?: { column: string; function: string }[] };
const data = () => document.getElementById('band-data')!;
const radio = (name: string) => within(data()).getByRole('radio', { name });
/** Opens the config menu's Charts group and returns its submenu: the scorecard ticks, Sparklines and a tick per chart. */
async function openChartList() {
  const menu = await openConfigMenu();
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Charts' }));
  return screen.findByRole('menu', { name: 'Charts' });
}
const group = (id: string) => data().querySelector<HTMLElement>(`td[data-chart-group="${id}"]`);
async function charts(opts?: Parameters<typeof setup>[0]) {
  const t = setup(opts);
  await t.seeded;
  t.view();
  t.puts.mockClear();
  t.gridPuts.mockClear();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  const seen = t.queries.length;
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  return { ...t, tableQueries: () => seen };
}
const cardNames = (el: HTMLElement | null) => [...(el?.querySelectorAll('[data-card]') ?? [])].map((c) => c.querySelector('div')!.textContent);

test('Charts: the body is a direct child of the table, so the headers stay in it', async () => {
  await charts();
  expect(group('orders')!.closest('tbody')!.parentElement!.tagName).toBe('TABLE');
});

test('Charts: each data mart has its own cards in its group cell, Count Unique first', async () => {
  await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum']));
  expect(cardNames(group('products'))).toEqual(['Count Unique', 'price · Sum']);
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
});

test('a card’s menu switches its metric, saves it under the card id, and the sparkline follows; Hide hides it', async () => {
  const t = await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum']));
  await userEvent.click(within(group('orders')!).getByRole('button', { name: 'Amount · Sum options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Count Unique' }));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Count Unique']));
  expect(group('orders')!.querySelector('[data-card="amount"] svg[aria-label="Count Unique trend"]')).not.toBeNull();
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, scorecards: { metrics: { amount: 'records' } }, charts: undefined });
  await userEvent.click(within(group('orders')!).getAllByRole('button', { name: 'Count Unique options' })[1]!);
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Hide' }));
  await waitFor(() => expect(group('orders')!.querySelector('[data-card="amount"]')).toBeNull());
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, scorecards: { metrics: { amount: 'records' }, hidden: ['amount'] } });
});

test('a card is at most 10rem wide and does not grow to fill its mart’s cell', async () => {
  await charts();
  const card = await waitFor(() => { const c = group('orders')!.querySelector('[data-card]'); expect(c).not.toBeNull(); return c!; });
  expect(card.className).toContain('flex-[0_1_10rem]');
  expect(card.className).not.toMatch(/\bflex-1\b/);
});

test('a long number shows short on its card, the exact value in a tooltip and to screen readers; a short one shows in full', async () => {
  await charts();
  const amount = await waitFor(() => { const v = group('orders')!.querySelector<HTMLElement>('[data-card="amount"] [data-card-value]'); expect(v?.dataset.exact).toBeTruthy(); return v!; });
  const exact = amount.dataset.exact!;
  expect(amount.textContent).not.toBe(exact);
  expect(amount.textContent!.length).toBeLessThan(exact.length);
  expect(amount).toHaveAttribute('aria-label', `Amount · Sum: ${exact}`);
  expect(amount).toHaveAttribute('role', 'note');
  amount.focus();
  expect((await screen.findAllByText(exact)).length).toBeGreaterThan(0);
  const records = group('orders')!.querySelector<HTMLElement>('[data-card^="records:"] [data-card-value]')!;
  expect(records.textContent).toBe('450');
  expect(records.dataset.exact).toBeUndefined();
});

test('a date column draws a trend under each card; hiding it takes the trends away', async () => {
  await charts();
  await waitFor(() => expect(data().querySelectorAll('svg[aria-label*="trend"]').length).toBeGreaterThan(0));
  const menu = await openColumnMenu(within(data()), 'created_at');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(data().querySelectorAll('svg[aria-label*="trend"]')).toHaveLength(0));
});

test('Charts runs no rows query of its own: every query after the switch aggregates', async () => {
  const t = await charts();
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  const after = t.queries.slice(t.tableQueries());
  expect(after.length).toBeGreaterThan(0);
  expect(after.every((q) => q.aggregation || q.uniqueCount)).toBe(true);
});

test('a filter set from a column header changes the chart queries', async () => {
  const t = await charts();
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  await openSubmenu(within(data()), 'status', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'paid');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)!.filter).toEqual(expect.arrayContaining([expect.objectContaining({ column: 'status' })])));
});

test('Table, Charts, Table reads the grid rows once and writes the saved columns back unchanged', async () => {
  // Toggling Table/Charts saves the member's view after SAVE_DEBOUNCE_MS, a write of the whole doc: wait for that write, then give a late bad one (the
  // saved-columns fallback fires at SAVED_COLUMNS_WAIT_MS, a prune at a hide) time to land. Every write must carry the saved columns and no picks.
  const t = await charts();
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  await userEvent.click(radio('Table'));
  await waitFor(() => expect(within(data()).getAllByRole('button', { name: /^Sort by/ }).length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 100));
  // The grid's own query is the only one with a page limit of 201 (200 + 1).
  expect(t.queries.filter((q) => q.limit === 201)).toHaveLength(1);
  await waitFor(() => expect(t.gridPuts.mock.calls.some(([, d]) => 'gridView' in d)).toBe(true), { timeout: 5000 });
  await new Promise((r) => setTimeout(r, SAVED_COLUMNS_WAIT_MS + 200));
  for (const [, doc] of t.gridPuts.mock.calls) expect(doc).toEqual(expect.objectContaining({ columns: COLUMNS }));
  expect(t.gridPuts.mock.calls.every(([, doc]) => !('picks' in doc))).toBe(true);
});

test('a selection made in Table does not stay lit in Charts or when Table returns', async () => {
  const t = setup();
  await t.seeded;
  t.view();
  await waitFor(() => expect(data().querySelector('tbody td')?.textContent).toBeTruthy());
  await userEvent.click(data().querySelector('tbody td')!);
  expect(data().querySelector('[data-selected]')).not.toBeNull();
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  expect(data().querySelector('[data-selected]')).toBeNull();
  await userEvent.click(radio('Table'));
  await waitFor(() => expect(data().querySelector('tbody td')?.textContent).toBeTruthy());
  expect(data().querySelector('[data-selected]')).toBeNull();
});

test('Charts has no sort buttons or Sort row; Table has them again', async () => {
  await charts();
  expect(within(data()).queryAllByRole('button', { name: /^Sort by/ })).toHaveLength(0);
  const menu = await openColumnMenu(within(data()), 'Amount');
  expect(within(menu).queryByRole('menuitem', { name: 'Sort' })).toBeNull();
  await userEvent.keyboard('{Escape}');
  await userEvent.click(radio('Table'));
  await waitFor(() => expect(within(data()).getAllByRole('button', { name: /^Sort by/ }).length).toBeGreaterThan(0));
});

test('folding the Data band in Charts mode asks for nothing new', async () => {
  const t = await charts();
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  await new Promise((r) => setTimeout(r, 50));
  const before = t.queries.length;
  await userEvent.click(screen.getByRole('button', { name: 'Hide Data' }));
  await new Promise((r) => setTimeout(r, 100));
  expect(t.queries).toHaveLength(before);
});

test('a saved choice that names nothing shown falls back for this view and writes nothing', async () => {
  const t = await charts({ charts: { scorecards: { hidden: ['not_a_field'] } } });
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum']));
  await new Promise((r) => setTimeout(r, 50));
  expect(t.puts).not.toHaveBeenCalled();
});

test('hiding a column drops the card picks that name it, in one write; a pick of another column stays', async () => {
  const t = await charts({ charts: { scorecards: { metrics: { id: 'amount' }, dates: { amount: 'created_at' } } } });
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  const menu = await openColumnMenu(within(data()), 'created_at');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(t.puts).toHaveBeenCalledTimes(1));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, scorecards: { metrics: { id: 'amount' }, dates: {} } });
});

test('a saved pick of a column the grid does not open with (columns read late or failed) is never erased by loading', async () => {
  const t = await charts({ columns: ['id', 'status', 'created_at'], charts: { scorecards: { metrics: { id: 'amount' }, dates: { id: 'paid_at' } } } });
  await new Promise((r) => setTimeout(r, 100));
  expect(t.puts).not.toHaveBeenCalled();
});

test('hiding a card from the Charts menu removes it and saves', async () => {
  const t = await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toContain('Amount · Sum'));
  await openChartList();
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Amount · Sum' }));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique']));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, scorecards: { hidden: ['amount'] } });
  expect(cardNames(group('products'))).toEqual(['Count Unique', 'price · Sum']);
});

test('hiding a column while Charts has not loaded its settings still drops the pick, through the store', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const t = setup({ charts: { version: 2, scorecards: { dates: { amount: 'created_at' }, hidden: ['x'] } }, gate });
  await t.seeded;
  t.view();
  t.puts.mockClear();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  const menu = await openColumnMenu(within(data()), 'created_at');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  release();
  await waitFor(() => expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, scorecards: { dates: {}, hidden: ['x'] } }));
});

test('a change cannot be made before the saved settings load, and one made after keeps the rest of the doc', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const saved: ChartSettings = { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', orientation: 'horizontal' }, { id: 'pie', kind: 'pie', dimension: 'status' }] };
  const t = setup({ charts: saved, gate });
  await t.seeded;
  t.view();
  t.puts.mockClear();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  // The config menu is there, with no chart rows until the saved settings are known.
  const early = await openConfigMenu();
  expect(within(early).queryByRole('menuitem', { name: 'Charts' })).toBeNull();
  expect(within(early).queryByRole('menuitem', { name: 'Add chart' })).toBeNull();
  release();
  await userEvent.click(await within(early).findByRole('menuitem', { name: 'Charts' }));
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Amount · Sum' }));
  await waitFor(() => expect(t.puts).toHaveBeenCalledWith('orders', { ...saved, scorecards: { hidden: ['amount'] } }));
});

const panel = (name: string) => screen.getByRole('button', { name: `${name} options` });
const series = () => new Set([...data().querySelectorAll('rect[data-series]')].map((r) => r.getAttribute('data-series')));
const withDims = [...COLUMNS, 'products__title'];

test('time series: stacking by a dimension draws several series and saves the choice', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Stack by' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Orders' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'status' }));
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'status' }, { id: 'pie', kind: 'pie' }] });
});

test('time series without a stack is one series', async () => {
  await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  expect(series().size).toBe(1);
});

test('the Orientation menu row turns the chart and saves; the header has no bar buttons', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('svg[data-orientation=vertical]')).not.toBeNull());
  expect(screen.queryByRole('button', { name: 'Horizontal bars' })).toBeNull();
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Orientation' }));
  expect(await screen.findByRole('menuitemradio', { name: 'Vertical' })).toBeChecked();
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Horizontal' }));
  await waitFor(() => expect(data().querySelector('svg[data-orientation=horizontal]')).not.toBeNull());
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', orientation: 'horizontal' }, { id: 'pie', kind: 'pie' }] });
});

test('a stack with more than 8 values adds an Other series from a not_in query; fewer than 8 sends none', async () => {
  const many = await charts({ columns: withDims, charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'products__title' }, { id: 'pie', kind: 'pie' }] } });
  await waitFor(() => expect(series().has('Other')).toBe(true));
  expect(series().size).toBe(9);
  const q = many.queries.find((o) => o.filter?.some((f) => f.operator === 'not_in'));
  expect(((q?.filter?.find((f) => f.operator === 'not_in') ?? {}) as { value?: unknown[] }).value).toHaveLength(8);
});

test('a stack with fewer than 8 values sends no not_in query', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'status' }, { id: 'pie', kind: 'pie' }] } });
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  expect(series().has('Other')).toBe(false);
  expect(t.queries.some((o) => o.filter?.some((f) => f.operator === 'not_in'))).toBe(false);
});

test('a saved pie dimension that is not shown falls back to the first dimension and writes nothing', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', dimension: 'not_shown' }] } });
  await waitFor(() => expect(data().querySelector('svg[aria-label="Amount · Sum by status"]')).not.toBeNull());
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  expect(t.puts).not.toHaveBeenCalled();
});

test('pie menu: a chosen dimension redraws the pie and saves', async () => {
  const t = await charts({ columns: withDims });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Products' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }));
  await waitFor(() => expect(data().querySelector('[data-slice="Other"]')).not.toBeNull());
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', dimension: 'products__title' }] });
});

test('two quick edits both land in the saved doc', async () => {
  const t = await charts({ columns: withDims });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Orientation' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Horizontal' }));
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Products' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }));
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, charts: [
    { id: 'time-series', kind: 'timeSeries', orientation: 'horizontal' },
    { id: 'pie', kind: 'pie', dimension: 'products__title' },
  ] });
});

test('a v1 doc draws the default charts and keeps its hidden scorecards', async () => {
  await charts({ charts: { scorecards: { hidden: ['amount'] }, timeSeries: { orientation: 'horizontal' } } as never });
  await waitFor(() => expect(data().querySelector('svg[data-orientation]')).not.toBeNull());
  expect(data().querySelector('svg[data-orientation]')?.getAttribute('data-orientation')).toBe('vertical');
  expect(cardNames(group('orders'))).not.toContain('Amount · Sum');
});

test('with only a pie, the sparklines still draw under the cards', async () => {
  await charts({ charts: { version: 2, charts: [{ id: 'pie', kind: 'pie' }] } });
  await waitFor(() => expect(data().querySelectorAll('svg[aria-label*="trend"]').length).toBeGreaterThan(0));
});

test('a chart menu closes on a real scroll', async () => {
  await charts();
  await userEvent.click(panel('Pie'));
  expect(await screen.findByRole('menu', { name: 'Pie menu' })).toBeInTheDocument();
  const was = window.scrollY;
  Object.defineProperty(window, 'scrollY', { value: was + 40, configurable: true });
  try {
    fireEvent.scroll(document);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Pie menu' })).toBeNull());
  } finally { Object.defineProperty(window, 'scrollY', { value: was, configurable: true }); }
});

test('a chart menu stays open for a scroll event that moved nothing (the echo of a resize)', async () => {
  await charts();
  await userEvent.click(panel('Pie'));
  expect(await screen.findByRole('menu', { name: 'Pie menu' })).toBeInTheDocument();
  fireEvent.scroll(document);
  await new Promise((r) => setTimeout(r, 50));
  expect(screen.getByRole('menu', { name: 'Pie menu' })).toBeInTheDocument();
});

test('a chart menu stays open while its panel is resizing, even when a scroll box moved', async () => {
  await charts();
  const dots = panel('Pie');
  await userEvent.click(dots);
  expect(await screen.findByRole('menu', { name: 'Pie menu' })).toBeInTheDocument();
  const section = dots.closest('[data-chart-kind]') as HTMLElement;
  class FakeTransition {}
  const globals = globalThis as unknown as { CSSTransition?: unknown };
  const had = globals.CSSTransition;
  globals.CSSTransition = FakeTransition;
  const running = Object.assign(new FakeTransition(), { playState: 'running' });
  section.getAnimations = (() => [running]) as unknown as typeof section.getAnimations;
  const was = window.scrollY;
  Object.defineProperty(window, 'scrollY', { value: was + 40, configurable: true });
  try {
    fireEvent.scroll(document);
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('menu', { name: 'Pie menu' })).toBeInTheDocument();
    // Once the animation is over, the same scroll closes it.
    section.getAnimations = (() => []) as unknown as typeof section.getAnimations;
    fireEvent.scroll(document);
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Pie menu' })).toBeNull());
  } finally {
    Object.defineProperty(window, 'scrollY', { value: was, configurable: true });
    globals.CSSTransition = had;
  }
});

test('the card checklist rows are checkboxes', async () => {
  await charts();
  await openChartList();
  expect(await screen.findByRole('menuitemcheckbox', { name: 'Sparklines' })).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryAllByRole('menuitemradio')).toHaveLength(0);
});

test('a failed Auto range query shows Retry on the time series, which reads again', async () => {
  let broken = true;
  const t = await charts({ fail: (o) => broken && !!o.aggregation?.some((a) => a.function === 'MIN') && !o.dateTrunc });
  const retry = await screen.findByRole('button', { name: 'Retry' });
  broken = false;
  const before = t.queries.length;
  await userEvent.click(retry);
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  expect(t.queries.length).toBeGreaterThan(before);
});

test('a date and a key with no metric shown still get a Count Unique time series', async () => {
  const t = await charts({ columns: ['id', 'status', 'created_at'], charts: { scorecards: { sparklines: false } } }); // no sparklines: they send the same shape
  await waitFor(() => expect(data().querySelector('svg[aria-label="Count Unique by day"], svg[aria-label^="Count Unique by"]')).not.toBeNull());
  expect(screen.getAllByRole('heading', { name: /^Count Unique by / }).length).toBeGreaterThan(0);
  const q = t.queries.find((o) => o.dateTrunc && o.uniqueCount?.[0] === '');
  expect(q).toMatchObject({ uniqueCount: [''], dateTrunc: [expect.objectContaining({ column: 'created_at' })] });
  expect(q?.aggregation).toBeUndefined();
  expect(data().querySelector('rect[data-series]')).not.toBeNull();
});

test('choosing Count Unique from the Metric menu saves the time series measure records', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Orders' }));
  const opts = await within(await screen.findByRole('menu', { name: 'Orders' })).findAllByRole('menuitemradio');
  expect(opts.map((o) => o.textContent)).toEqual(['Count Unique', 'Amount · Sum', 'Net Revenue · Sum']);
  await userEvent.click(within(screen.getByRole('menu', { name: 'Orders' })).getByRole('menuitemradio', { name: 'Count Unique' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Count Unique by / })).toBeInTheDocument());
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', measure: 'records' }, { id: 'pie', kind: 'pie' }] });
});

test('the Metric menus list every mart’s Count Unique and metrics; a joined mart’s records saves records:<martId>', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  // Marts first; a mart's metrics are on the next level.
  expect((await within(await screen.findByRole('menu', { name: 'Metric' })).findAllByRole('menuitem')).map((o) => o.textContent)).toEqual(['Orders', 'Products']);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Products' }));
  const opts = await within(await screen.findByRole('menu', { name: 'Products' })).findAllByRole('menuitemradio');
  expect(opts.map((o) => o.textContent)).toEqual(['Count Unique', 'price · Sum']);
  await userEvent.click(opts[0]!);
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Products · Count Unique by / })).toBeInTheDocument());
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', measure: 'records:products' }, { id: 'pie', kind: 'pie' }] });
  const q = t.queries.find((o) => o.dateTrunc && o.uniqueCount?.[0] && o.uniqueCount[0] !== '');
  expect(q).toMatchObject({ column: ['created_at'] });
  expect(q?.aggregation).toBeUndefined();
});

test('a pie of a joined mart’s Count Unique by a dimension asks the backend for that mart’s unique count', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', measure: 'records:products', dimension: 'status' }] } });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Products · Count Unique by status' })).toBeInTheDocument());
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const q = t.queries.find((o) => o.limit === 8 && o.column?.[0] === 'status' && o.uniqueCount?.[0] !== '' && o.uniqueCount);
  expect(q).toMatchObject({ column: ['status'], sort: [{ direction: 'desc' }] });
  expect(q?.aggregation).toBeUndefined();
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  expect((await within(await screen.findByRole('menu', { name: 'Metric' })).findAllByRole('menuitem')).map((o) => o.textContent)).toEqual(['Orders', 'Products']);
});

const statusFilter = () => within(data()).queryByRole('button', { name: /^Filter status/i });
const lastQuery = (t: { queries: TraverseOptions[] }) => t.queries[t.queries.length - 1]!;

test('clicking a pie slice filters the grid to it; Undo removes the filter and Redo puts it back', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const slice = data().querySelector<SVGElement>('[data-slice]')!;
  const value = slice.getAttribute('data-slice')!;
  expect(statusFilter()).toBeNull();
  await userEvent.click(slice);
  await waitFor(() => expect(statusFilter()).not.toBeNull());
  await waitFor(() => expect(t.queries.some((o) => o.filter?.some((f) => f.column === 'status' && f.operator === 'eq' && f.value === value))).toBe(true));
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(statusFilter()).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(statusFilter()).not.toBeNull());
});

test('a pie slice is keyboard reachable and "Other" is not clickable', async () => {
  await charts({ columns: withDims });
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Products' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }));
  await waitFor(() => expect(data().querySelector('[data-slice="Other"]')).not.toBeNull());
  expect(data().querySelector('[data-slice="Other"]')!.hasAttribute('tabindex')).toBe(false);
  expect(data().querySelector('[data-slice]:not([data-slice="Other"])')!.getAttribute('aria-label')).toMatch(/^Filter to /);
});

test('clicking a bar bucket filters the date column to a between over that bucket', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', bucket: 'MONTH' }, { id: 'pie', kind: 'pie' }] } });
  await waitFor(() => expect(data().querySelector('[data-bucket]')).not.toBeNull());
  const band = data().querySelector<SVGElement>('[data-bucket]')!;
  const start = band.getAttribute('data-bucket')!.slice(0, 10);
  await userEvent.click(band);
  await waitFor(() => expect(within(data()).queryByRole('button', { name: /^Filter created/i })).not.toBeNull());
  await waitFor(() => {
    const f = lastQuery(t).filter?.find((x) => x.column === 'created_at');
    expect(f?.operator).toBe('between');
    expect(((f as { value: { from: string } }).value).from.startsWith(start)).toBe(true);
  });
});

let blanks = 0;
test('a pie slice whose value is blank is not turned into a filter: no filter, no Undo step, a note says so', async () => {
  await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', measure: 'records', dimension: 'status' }] }, mapRow: (r) => ('status' in r ? { ...r, status: ' '.repeat(++blanks) } : r) });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const undoWas = (screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled;
  await userEvent.click(data().querySelector('[data-slice]')!);
  expect(await screen.findByText(/filter on .*not applied/i)).toBeInTheDocument();
  expect(statusFilter()).toBeNull();
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(undoWas);
});

test('a null value is the first slice, read "(blank)", and a click filters the column to blank', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', measure: 'records', dimension: 'status' }] }, mapRow: (r) => ('status' in r && r.status === 'paid' ? { ...r, status: null } : r) });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const first = data().querySelector('[data-slice]')!;
  expect(first.getAttribute('data-slice')).toBe('(blank)');
  expect(data().querySelector('[data-slice="null"]')).toBeNull();
  // The top read keeps null rows: no rule leaves the blank value out.
  expect(t.queries.some((q) => q.limit === 8 && q.filter?.some((f) => f.operator === 'is_not_blank'))).toBe(false);
  await userEvent.click(first);
  await waitFor(() => expect(statusFilter()).not.toBeNull());
});

test('a null date bucket draws first as "(blank)" and a click filters the date to blank', async () => {
  await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', bucket: 'MONTH' }] }, mapRow: (r) => ('created_at' in r && String(r.created_at).startsWith('2026-08') ? { ...r, created_at: null } : r) });
  const blank = await waitFor(() => { const b = data().querySelector('rect[data-bucket]'); expect(b?.getAttribute('aria-label')).toBe('Filter to (blank)'); return b!; });
  expect(data().querySelector('rect[data-bucket="null"]')).toBeNull();
  await userEvent.click(blank);
  await waitFor(() => expect(within(data()).queryByRole('button', { name: /^Filter created_at/i })).not.toBeNull());
});

test('the pie tooltip shows each share, except for another mart’s Count Unique whose slices overlap', async () => {
  const own = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', measure: 'records', dimension: 'status' }] } });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  fireEvent.focus(data().querySelector('[data-slice]')!);
  expect((await screen.findAllByText(/\(\d+%\)/)).length).toBeGreaterThan(0);
  expect(own.queries.length).toBeGreaterThan(0);
});

test('a pie of another mart’s Count Unique hides the share in the tooltip', async () => {
  await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', measure: 'records:products', dimension: 'status' }] } });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const slice = data().querySelector('[data-slice]')!;
  fireEvent.focus(slice);
  expect((await screen.findAllByText(new RegExp(`^${slice.getAttribute('data-slice')}: `))).length).toBeGreaterThan(0);
  expect(screen.queryByText(/\(\d+%\)/)).toBeNull();
});

test('an unstacked time series rides on the sparklines read: one billed read where there were two', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await waitFor(() => expect(data().querySelectorAll('svg[aria-label*="trend"]').length).toBeGreaterThan(0));
  const byDate = (t.queries.slice(t.tableQueries())).filter((q) => q.dateTrunc?.length && q.column?.[0] === 'created_at');
  // The sparkline read carries every metric and the unique count; no read of its own asks for the amount alone.
  expect(byDate).toHaveLength(1);
  expect(byDate[0]!.column).toEqual(['created_at', 'amount']);
  expect(byDate[0]!.uniqueCount).toEqual(['']);
});

test('a stacked time series still reads its own series', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'status' }, { id: 'pie', kind: 'pie' }] } });
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  const own = t.queries.slice(t.tableQueries()).filter((q) => q.dateTrunc?.length && q.column?.includes('status'));
  expect(own.length).toBeGreaterThan(0);
  expect(own.every((q) => !q.uniqueCount)).toBe(true);
});

test('when the shared sparkline read fails, the bar chart draws from its own read, issued only after the failure', async () => {
  let refused = 0;
  const t = await charts({ fail: (o) => { const shared = !!o.dateTrunc?.length && !!o.uniqueCount && o.column?.[0] === 'created_at'; if (shared) refused += 1; return shared; } });
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  const after = t.queries.slice(t.tableQueries());
  const sharedAt = after.findIndex((q) => q.dateTrunc?.length && q.uniqueCount);
  const ownAt = after.findIndex((q) => q.dateTrunc?.length && !q.uniqueCount && q.column?.[0] === 'created_at');
  expect(refused).toBeGreaterThan(0);
  expect(sharedAt).toBeGreaterThanOrEqual(0);
  expect(ownAt).toBeGreaterThan(sharedAt);
  expect(after.filter((q) => q.dateTrunc?.length && !q.uniqueCount && q.column?.[0] === 'created_at')).toHaveLength(1);
});

test('the Charts menu sits in the band header and adds and hides charts', async () => {
  const t = await charts();
  const header = data().querySelector('[data-chart-list-slot]')!;
  await userEvent.click(within(header as HTMLElement).getByRole('button', { name: 'Configure data' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Add chart' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pie' }));
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(3));
  const added = (t.puts.mock.lastCall![1] as ChartSettings).charts!;
  expect(added.map((c) => c.kind)).toEqual(['timeSeries', 'pie', 'pie']);

  await openChartList();
  await userEvent.click(screen.getAllByRole('menuitemcheckbox', { name: /^Amount · Sum by / })[0]!);
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(2));
  // A tick keeps the menu open: close it before opening a chart's own.
  await closeConfigMenu();

  const pies = screen.getAllByRole('button', { name: 'Pie options' });
  await userEvent.click(pies[1]!);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(1));
});

test('Hide keeps the chart in the Charts list, and ticking it brings it back with its setup', async () => {
  const saved = { id: 'p', kind: 'pie', dimension: 'status' } as const;
  const t = await charts({ charts: { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, saved] } });
  await userEvent.click(await screen.findByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Pie"]')).toBeNull());
  await openChartList();
  const row = screen.getByRole('menuitemcheckbox', { name: /by status$/ });
  expect(row).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(row);
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Pie"]')).not.toBeNull());
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts).toEqual([{ id: 'time-series', kind: 'timeSeries' }, { ...saved, hidden: false }]);
});

test('Duplicate adds a chart beside its original', async () => {
  const t = await charts();
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Duplicate' }));
  await waitFor(() => expect(data().querySelectorAll('section[data-chart-kind="Pie"]')).toHaveLength(2));
  expect(data().querySelectorAll('section.dm-chart')).toHaveLength(3);
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts!.map((c) => c.kind)).toEqual(['timeSeries', 'pie', 'pie']);
});

test('a hidden chart sends no query', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'p', kind: 'pie', hidden: true }] } });
  await waitFor(() => expect(group('orders')).not.toBeNull());
  expect(t.queries.filter((q) => q.limit === 8)).toHaveLength(0);
});

test('a chart whose fields are not shown is listed as columns hidden and drawn again when they return', async () => {
  const t = await charts({ columns: ['id', 'amount', 'created_at'], charts: { version: 2, charts: [{ id: 'p', kind: 'pie', dimension: 'status' }] } });
  expect(data().querySelectorAll('section.dm-chart')).toHaveLength(0);
  await openChartList();
  expect(screen.getByRole('menuitemcheckbox', { name: 'Pie (columns hidden)' })).toBeTruthy();
  await closeConfigMenu();
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText(/^status/i));
  await closeConfigMenu();
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(1));
  expect(data().querySelector('section[data-chart-kind="Pie"]')).not.toBeNull();
  expect(t.puts).not.toHaveBeenCalled();
});

test('Chart type switches a chart in place and keeps its usable saved fields', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'p', kind: 'pie', measure: 'amount', dimension: 'status' }] } });
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Time series' }));
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, charts: [{ id: 'p', kind: 'timeSeries', measure: 'amount' }] });
});

test('a ranked bar draws one bar per top value; switching it to pie keeps its measure and dimension', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'r', kind: 'rankedBar', measure: 'amount', dimension: 'status' }] } });
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Ranked bar"] svg[data-orientation="horizontal"]')).not.toBeNull());
  expect(t.queries.some((q) => q.limit === 8 && q.aggregation?.[0]?.function === 'SUM')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Ranked bar options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pie' }));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Pie"] [data-slice]')).not.toBeNull());
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts).toEqual([{ id: 'r', kind: 'pie', measure: 'amount', dimension: 'status' }]);
});

test('a bar chart draws vertical bars per top value; switching it to a ranked bar keeps its measure and dimension', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'b', kind: 'bar', measure: 'amount', dimension: 'status' }] } });
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Bar chart"] svg[data-orientation="vertical"] rect[data-series]')).not.toBeNull());
  expect(t.queries.some((q) => q.limit === 8 && q.aggregation?.[0]?.function === 'SUM')).toBe(true);
  await userEvent.click(screen.getByRole('button', { name: 'Bar chart options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Ranked bar' }));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Ranked bar"] svg[data-orientation="horizontal"]')).not.toBeNull());
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts).toEqual([{ id: 'b', kind: 'rankedBar', measure: 'amount', dimension: 'status' }]);
});

test('a chart menu ends with Chart type, Duplicate, Copy to clipboard and Hide', async () => {
  await charts();
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  const rows = within(screen.getAllByRole('menu').at(-1)!).getAllByRole('menuitem').map((r) => r.textContent);
  expect(rows.slice(-4)).toEqual(['Chart type', 'Duplicate', 'Copy to clipboard', 'Hide']);
  expect(rows).not.toContain('Remove');
});

test('the grid’s chosen aggregation reaches the charts: Average ranks the bars, and a switch to Pie goes back to Sum', async () => {
  const t = setup({ charts: { version: 2, charts: [{ id: 'r', kind: 'rankedBar', measure: 'amount', dimension: 'status' }] } });
  await t.seeded;
  t.view();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  // Nothing is ticked yet: only Average, so no Sum rule can take precedence.
  await userEvent.click(within(dialog).getByLabelText('Average'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const before = t.queries.length;
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Ranked bar"] svg[data-orientation="horizontal"]')).not.toBeNull());
  const ranked = t.queries.slice(before).filter((q) => q.limit === 8);
  expect(ranked.length).toBeGreaterThan(0);
  expect(ranked.every((q) => q.aggregation?.[0]?.function === 'AVG')).toBe(true);

  const switched = t.queries.length;
  await userEvent.click(screen.getByRole('button', { name: 'Ranked bar options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pie' }));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Pie"] [data-slice]')).not.toBeNull());
  const pie = t.queries.slice(switched).filter((q) => q.limit === 8);
  expect(pie.length).toBeGreaterThan(0);
  expect(pie.every((q) => q.aggregation?.[0]?.function === 'SUM')).toBe(true);
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts).toEqual([{ id: 'r', kind: 'pie', measure: 'amount', dimension: 'status' }]);
});

test('choosing a field that is not a shown column adds the column to the grid and saves the choice', async () => {
  const t = await charts({ columns: COLUMNS });
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Orders' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Net Revenue · Sum' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('net_revenue'));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', measure: 'net_revenue' }, { id: 'pie', kind: 'pie' }] });
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Net Revenue · Sum by / })).toBeInTheDocument());
});

test('a card’s Metric pick of a hidden column shows the column once, with no extra card of its own', async () => {
  const t = await charts({ columns: ['id', 'status', 'amount', 'created_at'] });
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum']));
  await userEvent.click(within(group('orders')!).getByRole('button', { name: 'Amount · Sum options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Net Revenue · Sum' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('net_revenue'));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Net Revenue · Sum']));
});


test('in a grouped grid a metric shown by a chart choice gets an aggregation rule in the same edit', async () => {
  const t = await charts({ columns: ['status', 'amount', 'created_at'], aggregations: [{ column: 'amount', function: 'SUM' }] });
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Net Revenue · Sum' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('net_revenue'));
  expect(lastGrid(t).aggregations).toEqual([{ column: 'amount', function: 'SUM' }, { column: 'net_revenue', function: 'SUM' }]);
});

test('Stack by a hidden dimension shows the column', async () => {
  const t = await charts({ columns: ['id', 'status', 'amount', 'created_at'] });
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Stack by' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'is_gift' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('is_gift'));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'is_gift' }, { id: 'pie', kind: 'pie' }] });
});

test('a hidden field of a joined mart is shown when a chart picks it', async () => {
  const t = await charts({ columns: COLUMNS });
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Products' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Name' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('products__title'));
  expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', dimension: 'products__title' }] });
});

test('a shown calculated metric has a card by its plain label, read by name with no function', async () => {
  const t = await charts({ calc: true, columns: [...COLUMNS, 'net'] });
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum', 'net']));
  await waitFor(() => expect(group('orders')!.querySelector('[data-card="net"] [data-card-value]')?.textContent).toBe('42'));
  const read = t.queries.find((q) => q.column?.includes('net') && q.uniqueCount && !q.dateTrunc)!;
  expect(read.aggregation!.map((r) => r.column)).toEqual(['amount', 'products__price']);
  expect(read.uniqueCount).toEqual(['', 'products']);
});

test('the menu of the Count Unique card lists the calculated metric; picking it while hidden shows the column', async () => {
  const t = await charts({ calc: true });
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Count Unique', 'Amount · Sum']));
  await userEvent.click(within(group('orders')!).getByRole('button', { name: 'Count Unique options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  const menu = await screen.findByRole('menu', { name: 'Metric' });
  expect(within(menu).getAllByRole('menuitemradio').map((o) => o.textContent)).toEqual(expect.arrayContaining(['Count Unique', 'Amount · Sum', 'net']));
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'net' }));
  await waitFor(() => expect(lastGrid(t).columns).toContain('net'));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['net', 'Amount · Sum']));
});

test('a filter on a calculated metric reaches no chart query: the keys read carries it and the charts follow its groups', async () => {
  const t = await charts({ calc: true, columns: ['status', 'amount', 'net'], aggregations: [{ column: 'amount', function: 'SUM' }] });
  await waitFor(() => expect(group('orders')!.querySelector('[data-card="net"] [data-card-value]')?.textContent).toBe('42'));
  const before = t.queries.length;
  await openSubmenu(within(data()), 'net', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), '10');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  const onNet = () => t.queries.slice(before).filter((q) => q.filter?.some((r) => r.column === 'net'));
  await waitFor(() => expect(onNet().length).toBeGreaterThan(0));
  // The keys read: the key and the metric by name, no aggregation, the rule with no function.
  const read = onNet().find((q) => q.limit === 501)!;
  expect(read.column).toEqual(['status', 'net']);
  expect(read.aggregation).toBeUndefined();
  expect(read.filter).toEqual([expect.objectContaining({ column: 'net', operator: 'eq', value: 10 })]);
  expect(read.filter![0]).not.toHaveProperty('function');
  // Every chart query follows it through an `in` rule on the key instead.
  await waitFor(() => expect(t.queries.slice(before).some((q) => q.uniqueCount && q.filter?.some((r) => r.column === 'status' && r.operator === 'in'))).toBe(true));
  expect(onNet().every((q) => q.limit === 501)).toBe(true);
});

test('with Unique Count on, the keys read groups as the table does: one total row has no key', async () => {
  const t = await charts({ calc: true, uc: true, columns: ['net'] });
  await waitFor(() => expect(data().querySelector('[data-card="net"] [data-card-value]')?.textContent).toBe('42'));
  const before = t.queries.length;
  await openSubmenu(within(data()), 'net', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), '10');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.slice(before).some((q) => q.limit === 501)).toBe(true));
  const read = t.queries.slice(before).find((q) => q.limit === 501)!;
  expect(read.column).toEqual(['net']);
  expect(read.uniqueCount).toBeUndefined();
});

describe('the config button in Charts', () => {
  const configButton = () => within(data().querySelector<HTMLElement>('[data-chart-list-slot]')!).getByRole('button', { name: 'Configure data' });

  test('shows with "Nothing to chart" too, its menu listing Add chart (with nothing to add), the Charts group and the data mart', async () => {
    // Orders with no primary key and only a text column shown: no number, nothing to count.
    const fx = demoFixtures();
    const keyless = { ...fx, marts: fx.marts.map((m) => (m.id === 'orders' ? { ...m, fields: m.fields.map((f) => ({ ...f, isPrimaryKey: false })) } : m)) };
    const t = setup({ columns: ['status'], fixtures: keyless });
    await t.seeded;
    t.view();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(radio('Charts'));
    await waitFor(() => expect(data().querySelector('[data-chart-empty]')).not.toBeNull());
    expect(configButton()).toBeInTheDocument();
    const menu = await openConfigMenu();
    expect(within(menu).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Add chart', 'Charts', 'Orders']);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add chart' }));
    const empty = await screen.findByRole('menu', { name: 'Add chart' });
    expect(within(empty).getAllByRole('menuitem').map((r) => [r.textContent, r.getAttribute('aria-disabled')])).toEqual([['Show a number column to chart it.', 'true']]);
    // The note is the panel's only text: a screen reader reaches it, so it takes focus, and activating it does nothing.
    const note = within(empty).getByRole('menuitem');
    expect(note).toHaveFocus();
    expect(note).not.toBeDisabled();
    await userEvent.keyboard('{Enter}');
    expect(screen.getByRole('menu', { name: 'Add chart' })).toBeInTheDocument();
    expect(note).toHaveFocus();
  });

  test('stays open while the HAVING gate loads and the charts come in behind it', async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => { release = r; });
    await charts({ calc: true, columns: ['status', 'amount', 'net'], aggregations: [{ column: 'amount', function: 'SUM' }], hold });
    await openSubmenu(within(data()), 'net', 'Filter');
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Value'), '10');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(group('orders')).toBeNull());
    const menu = await openConfigMenu();
    release();
    await waitFor(() => expect(group('orders')).not.toBeNull());
    expect(menu).toBeInTheDocument();
    expect(configButton()).toHaveAttribute('aria-expanded', 'true');
  });

  /** Orders with an array field: shown next to a function on another column it cannot be grouped. */
  const withTags = () => { const fx = demoFixtures(); return { ...fx, marts: fx.marts.map((m) => (m.id === 'orders' ? { ...m, fields: [...m.fields, { name: 'tags', type: 'STRING', mode: 'REPEATED' as const }] } : m)) }; };
  const grouped = { columns: ['status', 'amount'], aggregations: [{ column: 'amount', function: 'SUM' }], fixtures: withTags() };
  const alert = () => data().querySelector('[role="alert"]');

  test('a tick that blocks the grid, and the one that unblocks it, keep the menu open with the focus in it', async () => {
    await charts(grouped);
    await openFields('Orders');
    const menu = screen.getByRole('menu', { name: 'Configure data' });
    await userEvent.click(await screen.findByRole('option', { name: 'tags' }));
    await waitFor(() => expect(alert()).toHaveTextContent("can't be grouped"));
    expect(menu).toBeInTheDocument();
    expect(configButton()).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.click(screen.getByRole('option', { name: 'tags' }));
    await waitFor(() => expect(group('orders')).not.toBeNull());
    expect(alert()).toBeNull();
    expect(menu).toBeInTheDocument();
    expect(configButton()).toHaveAttribute('aria-expanded', 'true');
    expect(document.activeElement).not.toBe(document.body);
  });

  test('the config button is there while the grid is blocked, in Charts and in Table', async () => {
    const t = setup({ ...grouped, columns: ['status', 'amount', 'tags'] });
    await t.seeded;
    t.view();
    await waitFor(() => expect(alert()).toHaveTextContent("can't be grouped"));
    expect(configButton()).toBeInTheDocument();
    const sent = t.queries.length;
    await userEvent.click(radio('Charts'));
    await waitFor(() => expect(data().querySelector('.dm-grid-frame-charts')).not.toBeNull());
    expect(alert()).toHaveTextContent("can't be grouped");
    // Charts opened on a blocked grid read nothing.
    await new Promise((r) => setTimeout(r, 300));
    expect(t.queries.length).toBe(sent);
    expect(configButton()).toBeInTheDocument();
    expect(within(await openConfigMenu()).getAllByRole('menuitem').map((r) => r.textContent)).toEqual(['Add chart', 'Charts', 'Orders']);
  });

  /** Marts with no primary key, so only a number column gives a chart something to count. */
  const keyless = () => { const fx = demoFixtures(); return { ...fx, marts: fx.marts.map((m) => (['orders', 'products'].includes(m.id) ? { ...m, fields: m.fields.map((f) => ({ ...f, isPrimaryKey: false })) } : m)) }; };
  const rows = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((r) => r.textContent);

  test('a pending change that leaves no kind to add keeps both chart rows working, and the focus in the menu', async () => {
    const t = setup({ columns: ['status', 'products__price'], fixtures: keyless() });
    await t.seeded;
    t.view();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(radio('Charts'));
    const products = await openFields('Products');
    await userEvent.click(within(products).getByRole('option', { name: /price/i }));
    // The row of a chart menu item takes the panel away: the pending change goes out and no kind is eligible any more.
    const menu = screen.getByRole('menu', { name: 'Configure data' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Charts' }));
    await waitFor(() => expect(data().querySelector('[data-chart-empty]')).not.toBeNull());
    expect(rows(menu)).toEqual(['Add chart', 'Charts', 'Orders', 'Products']);
    expect(await screen.findByRole('menu', { name: 'Charts' })).toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add chart' }));
    const add = await screen.findByRole('menu', { name: 'Add chart' });
    expect(screen.queryByRole('menu', { name: 'Charts' })).toBeNull();
    expect(within(add).getByRole('menuitem', { name: 'Show a number column to chart it.' })).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.keyboard('{ArrowLeft}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Add chart' })).toBeNull());
    expect(within(menu).getByRole('menuitem', { name: 'Add chart' })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await screen.findByRole('menu', { name: 'Add chart' });
    expect(document.activeElement).not.toBe(document.body);
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Add chart' })).toBeNull());
    expect(within(menu).getByRole('menuitem', { name: 'Add chart' })).toHaveFocus();
  });

  test('the rows keep their order while a kind to add comes and goes with a data mart panel open', async () => {
    const t = setup({ columns: ['status', 'amount'], fixtures: keyless() });
    await t.seeded;
    t.view();
    await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
    await userEvent.click(radio('Charts'));
    const panel = await openFields('Orders');
    const menu = screen.getByRole('menu', { name: 'Configure data' });
    expect(rows(menu)).toEqual(['Add chart', 'Charts', 'Orders']);
    await userEvent.click(within(panel).getByRole('option', { name: /amount/i }));
    await waitFor(() => expect(data().querySelector('[data-chart-empty]')).not.toBeNull());
    expect(rows(menu)).toEqual(['Add chart', 'Charts', 'Orders']);
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole('option', { name: /amount/i }));
    await waitFor(() => expect(data().querySelector('[data-chart-empty]')).toBeNull());
    expect(rows(menu)).toEqual(['Add chart', 'Charts', 'Orders']);
    expect(screen.getByRole('dialog', { name: 'Orders' })).toBeInTheDocument();
  });
});

