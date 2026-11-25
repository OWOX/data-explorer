import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

const cap = vi.hoisted(() => ({ n: 5000 }));
vi.mock('./queries', async (orig) => Object.defineProperties({ ...(await orig<typeof import('./queries')>()) }, { SANKEY_FLOW_LIMIT: { get: () => cap.n, enumerable: true } }));
import { GRID_COLUMNS_COLLECTION } from '../api/grid-columns';
import { CHARTS_COLLECTION } from '../api/chart-settings';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, Row, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { App } from '../ui/App';
import { FAN_OUT_NOTE } from './kinds/sankey';
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

const panel = (name: string) => screen.getByRole('button', { name: `${name} options` });
const titles = () => data().querySelectorAll('svg[aria-label] text.dm-chart-axis-title');
const dims = ['id', 'status', 'amount', 'created_at', 'products__title', 'is_gift'];
const savedDims = (t: { puts: { mock: { lastCall?: unknown[] } } }) => (t.puts.mock.lastCall![1] as ChartSettings).charts![0]!.dimensions!;

// Columns > Column N > data mart > field: four levels, each opened by a click.
const columnRow = async (n: number) => {
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: `Column ${n}` }));
  return screen.findByRole('menu', { name: `Column ${n}` });
};
const checked = (menu: HTMLElement) => within(menu).getAllByRole('menuitemradio').filter((el) => el.getAttribute('aria-checked') === 'true').map((el) => el.textContent);

test('sankey: one Columns row holds five Column rows; a used column picks, an unused one appends, None takes a column out', async () => {
  const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await userEvent.click(panel('Sankey'));
  const root = await screen.findByRole('menu', { name: 'Sankey menu' });
  expect(within(root).queryByRole('menuitem', { name: 'Remove column' })).toBeNull();
  expect(within(root).getAllByRole('menuitem').map((el) => el.textContent)).toContain('Columns');
  expect(within(root).queryByRole('menuitem', { name: /^Column \d/ })).toBeNull();
  await userEvent.click(within(root).getByRole('menuitem', { name: 'Columns' }));
  const list = await screen.findByRole('menu', { name: 'Columns' });
  expect(within(list).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Column 1', 'Column 2', 'Column 3', 'Column 4', 'Column 5']);
  await userEvent.keyboard('{Escape}');
  await userEvent.keyboard('{Escape}');
  // Every column lists None first: a used one with its dimension checked, an unused one with None checked.
  let menu = await columnRow(2);
  expect(within(menu).getAllByRole('menuitemradio')[0]).toHaveTextContent('None');
  expect(checked(menu)).not.toContain('None');
  await userEvent.keyboard('{Escape}{Escape}{Escape}');
  menu = await columnRow(5);
  expect(checked(menu)).toEqual(['None']);
  // Picking in column 5 appends: the saved list has no gaps (1, 2, 5 is 1, 2, 3).
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Products' }));
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Products' })).getByRole('menuitemradio', { name: 'Name' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['status', 'is_gift', 'products__title']));
  await waitFor(() => expect(titles()).toHaveLength(3));
  // With three used, None on column 2 takes it out and column 3 moves up.
  menu = await columnRow(2);
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'None' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['status', 'products__title']));
  await waitFor(() => expect(titles()).toHaveLength(2));
  // None on an unused column saves nothing.
  const puts = t.puts.mock.calls.length;
  menu = await columnRow(4);
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'None' }));
  expect(t.puts.mock.calls.length).toBe(puts);
});

test('sankey: Right opens each of four levels; Left and Escape go back from the field and mart panels, Left from a Column row, Escape from the Columns list, with focus on the row; hover opens each level', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await userEvent.click(panel('Sankey'));
  await screen.findByRole('menu', { name: 'Sankey menu' });
  const focusRow = async (name: string) => {
    for (let i = 0; i < 30 && document.activeElement?.textContent !== name; i++) await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toHaveTextContent(name);
  };
  await focusRow('Columns');
  await userEvent.keyboard('{ArrowRight}');
  await screen.findByRole('menu', { name: 'Columns' });
  await focusRow('Column 3');
  await userEvent.keyboard('{ArrowRight}');
  await screen.findByRole('menu', { name: 'Column 3' });
  await focusRow('Products');
  await userEvent.keyboard('{ArrowRight}');
  await screen.findByRole('menu', { name: 'Products' });
  // Left: the mart's panel closes, focus is on its row.
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Products' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Products'));
  await userEvent.keyboard('{ArrowRight}');
  await screen.findByRole('menu', { name: 'Products' });
  // Escape: the same.
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Products' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Products'));
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Column 3' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Column 3'));
  // Left from a Column row of the Columns list goes back to the Columns row too.
  await userEvent.keyboard('{ArrowRight}');
  await screen.findByRole('menu', { name: 'Column 3' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Column 3'));
  await userEvent.keyboard('{ArrowLeft}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Columns' })).toBeNull());
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Columns'));
  expect(screen.getByRole('menu', { name: 'Sankey menu' })).toBeInTheDocument();
  // Hover opens each level as well.
  await userEvent.hover(screen.getByRole('menuitem', { name: 'Columns' }));
  await userEvent.hover(await screen.findByRole('menuitem', { name: 'Column 4' }));
  await userEvent.hover(await screen.findByRole('menuitem', { name: 'Products' }));
  await screen.findByRole('menu', { name: 'Products' });
});

test('sankey: hovering another Column row replaces the open mart panel, and Tab on a Column row closes the menu with focus on the button', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.hover(await screen.findByRole('menuitem', { name: 'Column 3' }));
  await userEvent.hover(await screen.findByRole('menuitem', { name: 'Products' }));
  await screen.findByRole('menu', { name: 'Products' });
  await userEvent.hover(screen.getByRole('menuitem', { name: 'Column 1' }));
  // Column 1 opens its own panel (a Column row opens its own list of marts; Column 3's panel and its Products panel close) and the Products panel of Column 3 is gone.
  await screen.findByRole('menu', { name: 'Column 1' });
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Products' })).toBeNull());
  expect(screen.queryByRole('menu', { name: 'Column 3' })).toBeNull();
  await userEvent.click(screen.getByRole('menuitem', { name: 'Column 2' }));
  await screen.findByRole('menu', { name: 'Column 2' });
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.activeElement).toHaveTextContent('Column 2'));
  await userEvent.keyboard('{Tab}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Sankey menu' })).toBeNull());
  expect(screen.queryByRole('menu', { name: 'Columns' })).toBeNull();
  expect(document.activeElement).toBe(panel('Sankey'));
});

test('sankey: a dimension picked in an unused column that is not shown adds its grid column, and no read runs with other dimensions in between', async () => {
  const t = await charts({ columns: middle, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const menu = await columnRow(3);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Customers' }));
  const from = t.queries.length;
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' }));
  await waitFor(() => expect(lastColumns(t)).toContain('customers__city'));
  expect(savedDims(t)).toEqual(['status', 'is_gift', 'customers__city']);
  await waitFor(() => expect(titles()).toHaveLength(3));
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const known = new Set(['status', 'is_gift', 'customers__city']);
  const sankeyReads = t.queries.slice(from).filter((q) => q.limit === 5000 || q.limit === 10000);
  expect(sankeyReads.length).toBeGreaterThan(0);
  // Every read after the pick names only the columns of the Sankey, and no flow read has three columns other than the new set.
  for (const q of sankeyReads) for (const c of q.column ?? []) expect(known.has(c) || c.includes(' | ') || /^(amount|records)/.test(c)).toBe(true);
});

test('sankey: None on a column under two shows a notice and reads nothing; the menu still works and a second column draws at once', async () => {
  const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const section = () => data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!;
  let menu = await columnRow(2);
  const before = t.queries.length;
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'None' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['status']));
  await waitFor(() => expect(within(section()).getByText('This Sankey is misconfigured: pick at least 2 columns in its menu.')).toBeInTheDocument());
  expect(data().querySelectorAll('path[data-link]')).toHaveLength(0);
  expect(section().querySelector('.dm-skeleton, [role="alert"]')).toBeNull();
  expect(t.queries.slice(before).filter((q) => q.limit === 5000 || q.limit === 10000 || q.limit === 5)).toHaveLength(0);
  // With no column at all the same notice stays, and the title reads on without "by".
  menu = await columnRow(1);
  await userEvent.click(within(menu).getByRole('menuitemradio', { name: 'None' }));
  await waitFor(() => expect(savedDims(t)).toEqual([]));
  expect(within(section()).getByText(/misconfigured/)).toBeInTheDocument();
  expect(within(section()).getByRole('heading').textContent).toMatch(/^Sankey · /);
  expect(t.queries.slice(before).filter((q) => q.limit === 5000 || q.limit === 10000 || q.limit === 5)).toHaveLength(0);
  // The menu still has its Metric row, and picking two columns draws.
  await userEvent.click(panel('Sankey'));
  expect(await screen.findByRole('menuitem', { name: 'Metric' })).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  menu = await columnRow(1);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Orders' }));
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Orders' })).getByRole('menuitemradio', { name: 'status' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['status']));
  menu = await columnRow(2);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Orders' }));
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Orders' })).getByRole('menuitemradio', { name: 'is_gift' }));
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  expect(within(section()).queryByText(/misconfigured/)).toBeNull();
});

test('sankey: with no columns its Charts list label differs from every scorecard label', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: [] }] } });
  await waitFor(() => expect(within(data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!).getByText(/misconfigured/)).toBeInTheDocument());
  await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Charts' }));
  const list = await screen.findByRole('menu', { name: 'Charts' });
  const labels = within(list).getAllByRole('menuitemcheckbox').map((el) => el.textContent);
  const sankeyLabel = labels.find((l) => l?.startsWith('Sankey · '));
  expect(sankeyLabel).toBeDefined();
  expect(labels.filter((l) => l === sankeyLabel)).toHaveLength(1);
  expect(new Set(labels).size).toBe(labels.length);
});

test('sankey: a column title names its field and its data mart', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  const texts = [...titles()].map((el) => el.textContent ?? '');
  expect(texts[0]).toMatch(/^status/);
  expect(texts[1]).not.toBe(texts[0]);
  expect(data().querySelector('svg[aria-label] title')).toBeNull();
});

test('sankey: a main mart metric by a column of a one-to-one joined mart draws', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  expect(data().querySelector('section[data-chart-kind="Sankey"] [role="note"]')).toBeNull();
});

test('sankey: a column of a mart that fans out the main rows draws per-pair reads and says ribbons can overlap', async () => {
  const t = await charts({ columns: [...dims, 'shipments__carrier'], charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const hint = await within(data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!).findByRole('note');
  await userEvent.hover(hint);
  expect((await screen.findAllByText(FAN_OUT_NOTE)).length).toBeGreaterThan(0);
  const reads = t.queries.slice(t.tableQueries());
  // One read per pair of neighbouring columns (each with the metric), and none for all three columns at once.
  const pairs = reads.filter((q) => q.limit === cap.n && q.column?.length === 3);
  expect(pairs).toHaveLength(2);
  expect(pairs.some((q) => q.column!.includes('status') && q.column!.includes('is_gift') && !q.column!.includes('shipments__carrier'))).toBe(true);
  expect(pairs.some((q) => q.column!.includes('is_gift') && q.column!.includes('shipments__carrier') && !q.column!.includes('status'))).toBe(true);
  expect(reads.filter((q) => q.column?.includes('status') && q.column.includes('is_gift') && q.column.includes('shipments__carrier'))).toHaveLength(0);
  // The Metric stays in the menu.
  await userEvent.click(panel('Sankey'));
  expect(await screen.findByRole('menuitem', { name: 'Metric' })).toBeInTheDocument();
});

test('sankey: one flow read grouped on the columns plus one total read per column', async () => {
  const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const reads = t.queries.slice(t.tableQueries());
  const flows = reads.filter((q) => q.column?.length === 3 && q.column.includes('status') && q.column.includes('is_gift') && q.limit === 5000);
  const totals = reads.filter((q) => q.column?.length === 2 && q.limit === 10000);
  expect(flows).toHaveLength(1);
  expect(totals).toHaveLength(2);
  expect(reads.filter((q) => q.limit === 1)).toHaveLength(0);
  expect(flows[0]!.limit).toBe(5000);
  expect(data().querySelector('section[data-chart-kind="Sankey"] [role="note"]')).toBeNull();
});

test('sankey: a flow read at its row cap draws what came back and says so', async () => {
  cap.n = 3;
  try {
    const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
    await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
    // Only a capped flow read is followed by the few-row read from the other end, to find a negative among the left-out flows.
    const low = t.queries.slice(t.tableQueries()).filter((q) => q.limit === 5 && q.sort?.[0]?.direction === 'asc');
    expect(low).toHaveLength(1);
    expect(low[0]!.sort?.[0]?.direction).toBe('asc');
    const hint = await within(data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!).findByRole('note');
    await userEvent.hover(hint);
    expect(await screen.findByText('Showing the largest 3 combinations; smaller flows are left out.')).toBeInTheDocument();
  } finally { cap.n = 5000; }
});

test('sankey: a capped flow read of a count reads no low rows (a count is never negative)', async () => {
  cap.n = 3;
  try {
    const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'], measure: 'records' }] } });
    await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
    expect(t.queries.slice(t.tableQueries()).filter((q) => q.limit === 5 && q.sort?.[0]?.direction === 'asc')).toHaveLength(0);
  } finally { cap.n = 5000; }
});

test('sankey: negative values draw the empty state with a note, not a chart', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] },
    mapRow: (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k.includes(' | ') && typeof v === 'number' ? -v : v])) });
  expect(await within(data()).findByText('Sankey needs values of 0 or more; this metric has negative values.')).toBeInTheDocument();
  expect(data().querySelectorAll('path[data-link]')).toHaveLength(0);
});

// Orders joins Countries through Customers, which shows no column: a middle mart of the path.
const middle = [...dims, 'customers__countries__name'];
const lastColumns = (t: { gridPuts: { mock: { calls: unknown[][] } } }) => (t.gridPuts.mock.calls.at(-1)![1] as { columns: string[] }).columns;
const submenu = async (row: string, mart?: string) => {
  await userEvent.click(panel('Sankey'));
  if (/^Column \d/.test(row)) await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: row }));
  if (mart) await userEvent.click(await screen.findByRole('menuitem', { name: mart }));
};

test('sankey: a column lists a mart on the path that shows no column; picking its field adds it to the grid and draws it', async () => {
  const t = await charts({ columns: middle, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  expect(group('customers')).toBeNull();
  await submenu('Column 1', 'Customers');
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' }));
  await waitFor(() => expect(lastColumns(t)).toEqual(['id', 'status', 'amount', 'created_at', 'is_gift', 'products__title', 'customers__countries__name', 'customers__city']));
  expect(savedDims(t)).toEqual(['customers__city', 'is_gift']);
  await waitFor(() => expect(group('customers')).not.toBeNull());
  await waitFor(() => expect(titles()[0]!.textContent).toMatch(/^city/));
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  // The pick is ticked under its mart.
  await submenu('Column 1', 'Customers');
  expect(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' })).toHaveAttribute('aria-checked', 'true');
});

test('sankey: a mart that is off the path stays out of the menus, and a mart on it offers no Count Unique until it shows a column', async () => {
  await charts({ columns: middle, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await submenu('Column 1');
  const sub = await screen.findByRole('menu', { name: 'Column 1' });
  expect(within(sub).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Orders', 'Products', 'Countries', 'Customers']);
  await userEvent.keyboard('{Escape}{Escape}');
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  // Customers has no metric of its own, and its Count Unique needs a column on the grid.
  expect(within(await screen.findByRole('menu', { name: 'Metric' })).queryByRole('menuitem', { name: 'Customers' })).toBeNull();
});

test('a metric of a mart on the path that shows no column is listed, and picking it adds its column', async () => {
  const t = await charts({ columns: ['status', 'amount', 'created_at', 'is_gift', 'products__categories__label'], charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await submenu('Metric', 'Products');
  const products = await screen.findByRole('menu', { name: 'Products' });
  expect(within(products).queryByRole('menuitemradio', { name: 'Count Unique' })).toBeNull();
  await userEvent.click(within(products).getByRole('menuitemradio', { name: 'price · Sum' }));
  await waitFor(() => expect(lastColumns(t)).toContain('products__price'));
  await waitFor(() => expect(screen.getByRole('heading', { name: /^price · Sum.* by status/ })).toBeInTheDocument());
});

test('sankey: in a fan-out Sankey the exact columns keep their node share and the overlapping column has none', async () => {
  await charts({ columns: [...dims, 'shipments__carrier'], charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const nodeIn = (col: number) => [...data().querySelectorAll('rect[data-node]')].find((el) => el.getAttribute('data-node')!.startsWith(`${col}|`))!;
  await userEvent.hover(nodeIn(0));
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/\(\d+%\)$/);
  await userEvent.unhover(nodeIn(0));
  await userEvent.hover(nodeIn(2));
  const tip = await screen.findByRole('tooltip');
  expect(tip.textContent).toMatch(/: /);
  expect(tip.textContent).not.toMatch(/%/);
});

test('sankey: an exact Sankey shows the share on every column', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const nodeIn = (col: number) => [...data().querySelectorAll('rect[data-node]')].find((el) => el.getAttribute('data-node')!.startsWith(`${col}|`))!;
  await userEvent.hover(nodeIn(1));
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/\(\d+%\)$/);
});

const links = () => [...data().querySelectorAll('path[data-link]')];
const linkTip = async (pair: number) => {
  const el = links().find((l) => l.getAttribute('data-link')!.startsWith(`${pair}|`))!;
  await userEvent.hover(el);
  const text = (await screen.findByRole('tooltip')).textContent!;
  await userEvent.unhover(el);
  return text;
};
const nodeTip = async (col: number, mid: (k: string) => boolean = () => true) => {
  const el = [...data().querySelectorAll('rect[data-node]')].find((n) => n.getAttribute('data-node')!.startsWith(`${col}|`) && mid(n.getAttribute('data-node')!))!;
  await userEvent.hover(el);
  const text = (await screen.findByRole('tooltip')).textContent!;
  await userEvent.unhover(el);
  return text;
};

test('sankey: in a fan-out Sankey a ribbon shows its percent only when both its columns do', async () => {
  await charts({ columns: [...dims, 'shipments__carrier'], charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await linkTip(0)).toMatch(/\(\d+%\)$/);
  expect(await linkTip(1)).not.toMatch(/%/);
});

test('sankey: an exact Sankey keeps the percent on its ribbons', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await linkTip(0)).toMatch(/\(\d+%\)$/);
});

test('sankey: a main-mart sum keeps its share on a lookup-joined column', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'], measure: 'amount' }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await nodeTip(0)).toMatch(/\(\d+%\)$/);
  expect(await nodeTip(1)).toMatch(/\(\d+%\)$/);
});

test('sankey: a metric on a joined mart has no share on a main-mart column and keeps it on its own mart', async () => {
  await charts({ columns: dims.concat('products__price'), charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'], measure: 'products__price' }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await nodeTip(0)).not.toMatch(/%/);
  expect(await nodeTip(1)).toMatch(/\(\d+%\)$/);
});
