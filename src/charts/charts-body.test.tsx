import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION } from '../api/grid-columns';
import { CHARTS_COLLECTION } from '../api/chart-settings';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { App } from '../ui/App';
import { openColumnMenu, openSubmenu } from '../ui/explorer/menu-test-utils';
import type { ChartSettings } from './settings';

// Orders: a primary key, a date, a number and a string; Products joins it with a number of its own (price).
const COLUMNS = ['id', 'status', 'amount', 'created_at', 'products__price'];

function setup(opts: { charts?: ChartSettings; columns?: string[]; gate?: Promise<void>; fail?: (o: TraverseOptions) => boolean; mapRow?: (row: Row) => Row } = {}) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const puts = vi.fn();
  const gridPuts = vi.fn();
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); if (id === 'orders' && opts.fail?.(o)) return Promise.reject(new Error('range failed')); const tr = real(id, o); const map = opts.mapRow; return map ? tr.then((x) => ({ ...x, rowChunks: async function* () { for await (const c of x.rowChunks()) yield c.map(map); } })) : tr; } } },
    collections: <T,>(name: string) => {
      const c = base.collections<T>(name);
      if (name === GRID_COLUMNS_COLLECTION) return { get: (id: string) => c.get(id), put: (id: string, d: T) => { gridPuts(id, d); return c.put(id, d); } };
      return name === CHARTS_COLLECTION ? { get: (id: string) => (opts.gate ? opts.gate.then(() => c.get(id)) : c.get(id)), put: (id: string, d: T) => { puts(id, d); return c.put(id, d); } } : c;
    },
  };
  const seeded = Promise.all([
    ctx.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: opts.columns ?? COLUMNS, at: 'then' }),
    opts.charts ? ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', opts.charts) : undefined,
  ]);
  return { queries, puts, gridPuts, seeded, view: () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>) };
}

const data = () => document.getElementById('band-data')!;
const radio = (name: string) => within(data()).getByRole('radio', { name });
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

test('Charts: each data mart has its own cards in its group cell, Unique Records first', async () => {
  await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Unique Records', 'Amount · Sum']));
  expect(cardNames(group('products'))).toEqual(['Unique Records', 'price · Sum']);
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
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

test('Table, Charts, Table reads the grid rows once and writes no columns', async () => {
  const t = await charts();
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
  await userEvent.click(radio('Table'));
  await waitFor(() => expect(within(data()).getAllByRole('button', { name: /^Sort by/ }).length).toBeGreaterThan(0));
  await new Promise((r) => setTimeout(r, 100));
  // The grid's own query is the only one with a page limit of 201 (200 + 1).
  expect(t.queries.filter((q) => q.limit === 201)).toHaveLength(1);
  expect(t.gridPuts).not.toHaveBeenCalled();
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
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Unique Records', 'Amount · Sum']));
  await new Promise((r) => setTimeout(r, 50));
  expect(t.puts).not.toHaveBeenCalled();
});

test('hiding a card from the Scorecards menu removes it and saves', async () => {
  const t = await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toContain('Amount · Sum'));
  await userEvent.click(screen.getByRole('button', { name: 'Scorecards options' }));
  await userEvent.click(await screen.findByRole('menuitemcheckbox', { name: 'Amount · Sum' }));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Unique Records']));
  expect(t.puts).toHaveBeenCalledWith('orders', { scorecards: { hidden: ['amount'] } });
  expect(cardNames(group('products'))).toEqual(['Unique Records', 'price · Sum']);
});

test('a change cannot be made before the saved settings load, and one made after keeps the rest of the doc', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const saved: ChartSettings = { timeSeries: { orientation: 'horizontal' }, pie: { dimension: 'status' } };
  const t = setup({ charts: saved, gate });
  await t.seeded;
  t.view();
  t.puts.mockClear();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  expect(screen.queryByRole('button', { name: 'Scorecards options' })).toBeNull();
  release();
  await userEvent.click(await screen.findByRole('button', { name: 'Scorecards options' }));
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
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'status' }));
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  expect(t.puts).toHaveBeenCalledWith('orders', { timeSeries: { stack: 'status' } });
});

test('time series without a stack is one series', async () => {
  await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  expect(series().size).toBe(1);
});

test('the Horizontal bars button turns the chart and saves', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('svg[data-orientation=vertical]')).not.toBeNull());
  expect(screen.getByRole('button', { name: 'Vertical bars' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Horizontal bars' }));
  await waitFor(() => expect(data().querySelector('svg[data-orientation=horizontal]')).not.toBeNull());
  expect(screen.getByRole('button', { name: 'Horizontal bars' })).toHaveAttribute('aria-pressed', 'true');
  expect(t.puts).toHaveBeenCalledWith('orders', { timeSeries: { orientation: 'horizontal' } });
});

test('a stack with more than 8 values adds an Other series from a not_in query; fewer than 8 sends none', async () => {
  const many = await charts({ columns: withDims, charts: { timeSeries: { stack: 'products__title' } } });
  await waitFor(() => expect(series().has('Other')).toBe(true));
  expect(series().size).toBe(9);
  const q = many.queries.find((o) => o.filter?.some((f) => f.operator === 'not_in'));
  expect(((q?.filter?.find((f) => f.operator === 'not_in') ?? {}) as { value?: unknown[] }).value).toHaveLength(8);
});

test('a stack with fewer than 8 values sends no not_in query', async () => {
  const t = await charts({ charts: { timeSeries: { stack: 'status' } } });
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  expect(series().has('Other')).toBe(false);
  expect(t.queries.some((o) => o.filter?.some((f) => f.operator === 'not_in'))).toBe(false);
});

test('a saved pie dimension that is not shown falls back to the first dimension and writes nothing', async () => {
  const t = await charts({ charts: { pie: { dimension: 'not_shown' } } });
  await waitFor(() => expect(data().querySelector('svg[aria-label="Amount · Sum by status"]')).not.toBeNull());
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  expect(t.puts).not.toHaveBeenCalled();
});

test('pie menu: a chosen dimension redraws the pie and saves', async () => {
  const t = await charts({ columns: withDims });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Products · Name' }));
  await waitFor(() => expect(data().querySelector('[data-slice="Other"]')).not.toBeNull());
  expect(t.puts).toHaveBeenCalledWith('orders', { pie: { dimension: 'products__title' } });
});

test('a chart menu closes on scroll', async () => {
  await charts();
  await userEvent.click(panel('Scorecards'));
  expect(await screen.findByRole('menu', { name: 'Scorecards menu' })).toBeInTheDocument();
  fireEvent.scroll(document);
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Scorecards menu' })).toBeNull());
});

test('the card checklist rows are checkboxes', async () => {
  await charts();
  await userEvent.click(panel('Scorecards'));
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

test('a date and a key with no metric shown still get a Unique Records time series', async () => {
  const t = await charts({ columns: ['id', 'status', 'created_at'], charts: { scorecards: { sparklines: false } } }); // no sparklines: they send the same shape
  await waitFor(() => expect(data().querySelector('svg[aria-label="Unique Records by day"], svg[aria-label^="Unique Records by"]')).not.toBeNull());
  expect(screen.getAllByRole('heading', { name: /^Unique Records by / }).length).toBeGreaterThan(0);
  const q = t.queries.find((o) => o.dateTrunc && o.uniqueCount?.[0] === '');
  expect(q).toMatchObject({ uniqueCount: [''], dateTrunc: [expect.objectContaining({ column: 'created_at' })] });
  expect(q?.aggregation).toBeUndefined();
  expect(data().querySelector('rect[data-series]')).not.toBeNull();
});

test('choosing Unique Records from the Metric menu saves timeSeries.metric records', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  const opts = await screen.findAllByRole('menuitemradio');
  expect(opts[0]).toHaveAccessibleName('Unique Records');
  await userEvent.click(opts[0]!);
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Unique Records by / })).toBeInTheDocument());
  expect(t.puts).toHaveBeenCalledWith('orders', { timeSeries: { metric: 'records' } });
});

test('the Metric menus list every mart’s Unique Records and metrics; a joined mart’s records saves records:<martId>', async () => {
  const t = await charts();
  await waitFor(() => expect(data().querySelector('rect[data-series]')).not.toBeNull());
  await userEvent.click(panel('Time series'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  const opts = await screen.findAllByRole('menuitemradio');
  expect(opts.map((o) => o.textContent)).toEqual(['Unique Records', 'Amount · Sum', 'Products · Unique Records', 'price · Sum']);
  await userEvent.click(opts[2]!);
  await waitFor(() => expect(screen.getByRole('heading', { name: /^Products · Unique Records by / })).toBeInTheDocument());
  expect(t.puts).toHaveBeenCalledWith('orders', { timeSeries: { metric: 'records:products' } });
  const q = t.queries.find((o) => o.dateTrunc && o.uniqueCount?.[0] && o.uniqueCount[0] !== '');
  expect(q).toMatchObject({ column: ['created_at'] });
  expect(q?.aggregation).toBeUndefined();
});

test('a pie of a joined mart’s Unique Records by a dimension asks the backend for that mart’s unique count', async () => {
  const t = await charts({ charts: { pie: { metric: 'records:products', dimension: 'status' } } });
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Products · Unique Records by status' })).toBeInTheDocument());
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const q = t.queries.find((o) => o.limit === 8 && o.column?.[0] === 'status' && o.uniqueCount?.[0] !== '' && o.uniqueCount);
  expect(q).toMatchObject({ column: ['status'], sort: [{ direction: 'desc' }] });
  expect(q?.aggregation).toBeUndefined();
  await userEvent.click(panel('Pie'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  expect((await screen.findAllByRole('menuitemradio')).map((o) => o.textContent)).toEqual(['Unique Records', 'Amount · Sum', 'Products · Unique Records', 'price · Sum']);
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
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Products · Name' }));
  await waitFor(() => expect(data().querySelector('[data-slice="Other"]')).not.toBeNull());
  expect(data().querySelector('[data-slice="Other"]')!.hasAttribute('tabindex')).toBe(false);
  expect(data().querySelector('[data-slice]:not([data-slice="Other"])')!.getAttribute('aria-label')).toMatch(/^Filter to /);
});

test('clicking a bar bucket filters the date column to a between over that bucket', async () => {
  const t = await charts({ charts: { timeSeries: { bucket: 'MONTH' } } });
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
  await charts({ charts: { pie: { metric: 'records', dimension: 'status' } }, mapRow: (r) => ('status' in r ? { ...r, status: ' '.repeat(++blanks) } : r) });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  const undoWas = (screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled;
  await userEvent.click(data().querySelector('[data-slice]')!);
  expect(await screen.findByText(/filter on .*not applied/i)).toBeInTheDocument();
  expect(statusFilter()).toBeNull();
  expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(undoWas);
});

test('the pie tooltip shows each share, except for another mart’s Unique Records whose slices overlap', async () => {
  const own = await charts({ charts: { pie: { metric: 'records', dimension: 'status' } } });
  await waitFor(() => expect(data().querySelector('[data-slice]')).not.toBeNull());
  fireEvent.focus(data().querySelector('[data-slice]')!);
  expect((await screen.findAllByText(/\(\d+%\)/)).length).toBeGreaterThan(0);
  expect(own.queries.length).toBeGreaterThan(0);
});

test('a pie of another mart’s Unique Records hides the share in the tooltip', async () => {
  await charts({ charts: { pie: { metric: 'records:products', dimension: 'status' } } });
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
  const t = await charts({ charts: { timeSeries: { stack: 'status' } } });
  await waitFor(() => expect(series().size).toBeGreaterThan(1));
  const own = t.queries.slice(t.tableQueries()).filter((q) => q.dateTrunc?.length && q.column?.includes('status'));
  expect(own.length).toBeGreaterThan(0);
});
