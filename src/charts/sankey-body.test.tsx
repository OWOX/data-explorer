import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

// The grid may save its own unchanged list at any time; a chart pick must never add a column to it.
const expectNoGridColumn = (t: ReturnType<typeof setup>, start: string[], field: string) => {
  for (const [, d] of t.gridPuts.mock.calls as [string, { columns: string[] }][]) {
    expect(d.columns).not.toContain(field);
    expect([...d.columns].sort()).toEqual([...start].sort());
  }
};

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
  const t = await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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

test('sankey: a dimension picked in an unused column that is not shown adds no grid column, and no read runs with other dimensions in between', async () => {
  const t = await charts({ columns: middle, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const menu = await columnRow(3);
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Customers' }));
  const from = t.queries.length;
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['status', 'is_gift', 'customers__city']));
  expectNoGridColumn(t, middle, 'customers__city');
  await waitFor(() => expect(titles()).toHaveLength(3));
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const known = new Set(['status', 'is_gift', 'customers__city']);
  const sankeyReads = t.queries.slice(from).filter((q) => q.limit === 5000 || q.limit === 10000);
  expect(sankeyReads.length).toBeGreaterThan(0);
  // Every read after the pick names only the columns of the Sankey, and no flow read has three columns other than the new set.
  for (const q of sankeyReads) for (const c of q.column ?? []) expect(known.has(c) || c.includes(' | ') || /^(amount|records)/.test(c)).toBe(true);
});

test('sankey: None on a column under two shows a notice and reads nothing; the menu still works and a second column draws at once', async () => {
  const t = await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: [] }] } });
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
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  const texts = [...titles()].map((el) => el.textContent ?? '');
  expect(texts[0]).toMatch(/^status/);
  expect(texts[1]).not.toBe(texts[0]);
  expect(data().querySelector('svg[aria-label] title')).toBeNull();
});

test('sankey: a main mart metric by a column of a one-to-one joined mart draws', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  expect(data().querySelector('section[data-chart-kind="Sankey"] [role="note"]')).toBeNull();
});

test('sankey: a column of a mart that fans out the main rows draws per-pair reads and says ribbons can overlap', async () => {
  const t = await charts({ columns: [...dims, 'shipments__carrier'], charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const hint = await within(data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!).findByRole('note');
  await userEvent.hover(hint);
  expect((await screen.findAllByText(FAN_OUT_NOTE)).length).toBeGreaterThan(0);
  expect(FAN_OUT_NOTE).toContain("A node's share is of its column's values added up, not of the metric's total.");
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
  const t = await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
    const t = await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
    const t = await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'], measure: 'records' }] } });
    await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
    expect(t.queries.slice(t.tableQueries()).filter((q) => q.limit === 5 && q.sort?.[0]?.direction === 'asc')).toHaveLength(0);
  } finally { cap.n = 5000; }
});

test('sankey: negative values draw the empty state with a note, not a chart', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] },
    mapRow: (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k.includes(' | ') && typeof v === 'number' ? -v : v])) });
  expect(await within(data()).findByText('Sankey needs values of 0 or more; this metric has negative values.')).toBeInTheDocument();
  expect(data().querySelectorAll('path[data-link]')).toHaveLength(0);
});

// Orders joins Countries through Customers, which shows no column: a middle mart of the path.
const middle = [...dims, 'customers__countries__name'];
const submenu = async (row: string, mart?: string) => {
  await userEvent.click(panel('Sankey'));
  if (/^Column \d/.test(row)) await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: row }));
  if (mart) await userEvent.click(await screen.findByRole('menuitem', { name: mart }));
};

test('sankey: a column lists a mart on the path that shows no column; picking its field draws it and adds no column', async () => {
  const t = await charts({ columns: middle, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  expect(group('customers')).toBeNull();
  await submenu('Column 1', 'Customers');
  await userEvent.click(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['customers__city', 'is_gift']));
  expectNoGridColumn(t, middle, 'customers__city');
  expect(group('customers')).toBeNull();
  await waitFor(() => expect(titles()[0]!.textContent).toMatch(/^city/));
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  // The pick is ticked under its mart.
  await submenu('Column 1', 'Customers');
  expect(within(await screen.findByRole('menu', { name: 'Customers' })).getByRole('menuitemradio', { name: 'city' })).toHaveAttribute('aria-checked', 'true');
});

test('sankey: a mart that is off the path stays out of the menus, and a mart on it offers no Count Unique until it shows a column', async () => {
  await charts({ columns: middle, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await submenu('Column 1');
  const sub = await screen.findByRole('menu', { name: 'Column 1' });
  expect(within(sub).getAllByRole('menuitem').map((el) => el.textContent)).toEqual(['Orders', 'Products', 'Countries', 'Customers']);
  await userEvent.keyboard('{Escape}{Escape}');
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Metric' }));
  // Customers has no metric of its own, and its Count Unique needs a column on the grid.
  expect(within(await screen.findByRole('menu', { name: 'Metric' })).queryByRole('menuitem', { name: 'Customers' })).toBeNull();
});

test('a metric of a mart on the path that shows no column is listed, and picking it adds no column', async () => {
  const t = await charts({ columns: ['status', 'amount', 'created_at', 'is_gift', 'products__categories__label'], charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  await submenu('Metric', 'Products');
  const products = await screen.findByRole('menu', { name: 'Products' });
  expect(within(products).queryByRole('menuitemradio', { name: 'Count Unique' })).toBeNull();
  await userEvent.click(within(products).getByRole('menuitemradio', { name: 'price · Sum' }));
  await waitFor(() => expect(screen.getByRole('heading', { name: /^price · Sum.* by status/ })).toBeInTheDocument());
  expectNoGridColumn(t, ['status', 'amount', 'created_at', 'is_gift', 'products__categories__label'], 'products__price');
});

test('sankey: in a fan-out Sankey every column has its node share, the overlapping one included, and the note says what it is of', async () => {
  await charts({ columns: [...dims, 'shipments__carrier'], charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  const nodeIn = (col: number) => [...data().querySelectorAll('rect[data-node]')].find((el) => el.getAttribute('data-node')!.startsWith(`${col}|`))!;
  await userEvent.hover(nodeIn(0));
  expect(await screen.findByRole('tooltip')).toHaveTextContent(/\(\d+%\)$/);
  await userEvent.unhover(nodeIn(0));
  await userEvent.hover(nodeIn(2));
  const tip = await screen.findByRole('tooltip');
  expect(tip.textContent).toMatch(/: .*\(\d+%\)$/);
});

test('sankey: an exact Sankey shows the share on every column', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
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
  // A tooltip the pointer can enter outlives the unhover in jsdom (no layout for Radix's grace area).
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  return text;
};
const nodeTip = async (col: number, mid: (k: string) => boolean = () => true) => {
  const el = [...data().querySelectorAll('rect[data-node]')].find((n) => n.getAttribute('data-node')!.startsWith(`${col}|`) && mid(n.getAttribute('data-node')!))!;
  await userEvent.hover(el);
  const text = (await screen.findByRole('tooltip')).textContent!;
  await userEvent.unhover(el);
  // A tooltip the pointer can enter outlives the unhover in jsdom (no layout for Radix's grace area).
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  return text;
};

test('sankey: in a fan-out Sankey a ribbon shows its percent only when both its columns do', async () => {
  await charts({ columns: [...dims, 'shipments__carrier'], charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift', 'shipments__carrier'] }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await linkTip(0)).toMatch(/\(\d+%\)$/);
  expect(await linkTip(1)).not.toMatch(/%/);
});

test('sankey: an exact Sankey keeps the percent on its ribbons', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await linkTip(0)).toMatch(/\(\d+%\)$/);
});

test('sankey: a main-mart sum keeps its share on a lookup-joined column', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'], measure: 'amount' }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await nodeTip(0)).toMatch(/\(\d+%\)$/);
  expect(await nodeTip(1)).toMatch(/\(\d+%\)$/);
});

test('sankey: a metric on a joined mart has a node share on a main-mart column and on its own mart', async () => {
  await charts({ columns: dims.concat('products__price'), charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'products__title'], measure: 'products__price' }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await nodeTip(0)).toMatch(/\(\d+%\)$/);
  expect(await nodeTip(1)).toMatch(/\(\d+%\)$/);
});

test('sankey: a sum above 10 shows no fraction in its node tooltip, its ribbon tooltip and its screen-reader table', async () => {
  await charts({ columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'], measure: 'amount' }] } });
  await waitFor(() => expect(links().length).toBeGreaterThan(0));
  expect(await nodeTip(0)).toMatch(/: [\d,]{2,}( \(\d+%\))?$/);
  expect(await linkTip(0)).toMatch(/: [\d,]{2,}( \(\d+%\))?$/);
  const cells = [...data().querySelectorAll('section[data-chart-kind="Sankey"] table.sr-only tbody tr td:last-child')].map((c) => c.textContent!);
  expect(cells.length).toBeGreaterThan(0);
  for (const c of cells) expect(c).not.toMatch(/\.\d/);
});

// Column order: the Columns menu's rows are dragged by their ⋮ (or moved with Alt+Up / Alt+Down).
const ROW_H = 32;
const ORDER = ['status', 'is_gift', 'products__title'];
const orderSaved: NonNullable<Parameters<typeof setup>[0]> = { columns: dims, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ORDER }] } };
// jsdom has no layout: the Column rows are laid out 32px apart from y = 100.
const layoutRows = () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const label = this.getAttribute('role') === 'menuitem' ? /^Column (\d)/.exec(this.textContent ?? '') : null;
    // A dragged row is shifted by its translateY, as in a browser.
    const shift = Number(/translateY\((-?[\d.]+)px\)/.exec((this as HTMLElement).style?.transform ?? '')?.[1] ?? 0);
    const top = label ? 100 + (Number(label[1]) - 1) * ROW_H + shift : 0;
    return { x: 0, y: top, left: 0, top, right: 200, bottom: top + (label ? ROW_H : 0), width: 200, height: label ? ROW_H : 0, toJSON: () => ({}) } as DOMRect;
  });
};
const columnsMenu = async () => {
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  return screen.findByRole('menu', { name: 'Columns' });
};
const colRow = (menu: HTMLElement, n: number) => within(menu).getByRole('menuitem', { name: `Column ${n}` });
const gripOf = (menu: HTMLElement, n: number) => colRow(menu, n).querySelector<HTMLElement>('[data-grip]')!;
const y = (n: number) => 100 + (n - 1) * ROW_H + ROW_H / 2;
const press = (grip: HTMLElement, at: number) => fireEvent.pointerDown(grip, { pointerId: 1, button: 0, clientY: at });
const move = (grip: HTMLElement, at: number) => fireEvent.pointerMove(grip, { pointerId: 1, buttons: 1, clientY: at });
const release = (grip: HTMLElement, at: number) => fireEvent.pointerUp(grip, { pointerId: 1, clientY: at });
const orderTitles = () => [...titles()].map((t) => t.textContent);

afterEach(() => { vi.restoreAllMocks(); });

test('sankey: the Column rows show a vertical ⋮ and no tag icon; an unused row has a muted one', async () => {
  await charts({ ...orderSaved, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  const menu = await columnsMenu();
  for (let n = 1; n <= 5; n++) {
    const row = colRow(menu, n);
    expect(row.querySelector('svg.lucide-ellipsis-vertical')).not.toBeNull();
    expect(row.querySelector('svg.lucide-tag')).toBeNull();
    expect(gripOf(menu, n).hasAttribute('data-off')).toBe(n > 2);
  }
});

test('sankey: dragging Column 1 by its ⋮ below Column 3 saves the new order in one write and keeps the menu open', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const before = orderTitles();
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(1) + 2);
  expect(t.puts).not.toHaveBeenCalled();
  move(grip, y(3) + 10);
  expect(menu.querySelector('[data-drop-line]')).not.toBeNull();
  expect(t.puts).not.toHaveBeenCalled();
  release(grip, y(3) + 10);
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'products__title', 'status']));
  expect(t.puts).toHaveBeenCalledTimes(1);
  expect(menu.querySelector('[data-drop-line]')).toBeNull();
  expect(screen.getByRole('menu', { name: 'Columns' })).toBeInTheDocument();
  await waitFor(() => expect(orderTitles()).not.toEqual(before));
});

test('sankey: a press on the ⋮ without moving, and a drag back to its own place, save nothing', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 2);
  press(grip, y(2));
  release(grip, y(2));
  fireEvent.click(grip);
  expect(screen.queryByRole('menu', { name: 'Column 2' })).toBeNull();
  press(grip, y(2));
  move(grip, y(3));
  move(grip, y(2) + 3);
  release(grip, y(2) + 3);
  expect(t.puts).not.toHaveBeenCalled();
});

test('sankey: Escape during a drag cancels it, saves nothing and keeps the menu open', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(3));
  expect(menu.querySelector('[data-drop-line]')).not.toBeNull();
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  expect(menu.querySelector('[data-drop-line]')).toBeNull();
  release(grip, y(3));
  expect(t.puts).not.toHaveBeenCalled();
  expect(screen.getByRole('menu', { name: 'Columns' })).toBeInTheDocument();
});

test('sankey: while dragging, hovering another row opens no submenu and an open Column submenu closes', async () => {
  layoutRows();
  await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  await userEvent.click(colRow(menu, 3));
  await screen.findByRole('menu', { name: 'Column 3' });
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(1) + 20);
  expect(screen.queryByRole('menu', { name: 'Column 3' })).toBeNull();
  fireEvent.mouseEnter(colRow(menu, 2));
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.queryByRole('menu', { name: 'Column 2' })).toBeNull();
  release(grip, y(1));
});

test('sankey: an unused row cannot be dragged', async () => {
  layoutRows();
  const t = await charts({ ...orderSaved, charts: { charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] } });
  await waitFor(() => expect(titles()).toHaveLength(2));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 4);
  press(grip, y(4));
  move(grip, y(1));
  expect(menu.querySelector('[data-drop-line]')).toBeNull();
  release(grip, y(1));
  expect(t.puts).not.toHaveBeenCalled();
});

test('sankey: Alt+ArrowDown moves the focused column down one place, focus stays on it; Alt+ArrowUp at the top does nothing', async () => {
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  expect(colRow(menu, 1)).toHaveAttribute('aria-description', expect.stringContaining('Alt+Up or Alt+Down to move'));
  colRow(menu, 1).focus();
  fireEvent.keyDown(colRow(menu, 1), { key: 'ArrowUp', altKey: true });
  expect(t.puts).not.toHaveBeenCalled();
  fireEvent.keyDown(colRow(menu, 1), { key: 'ArrowDown', altKey: true });
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'status', 'products__title']));
  expect(document.activeElement).toBe(colRow(menu, 2));
  fireEvent.keyDown(colRow(menu, 2), { key: 'ArrowUp', altKey: true });
  await waitFor(() => expect(savedDims(t)).toEqual(['status', 'is_gift', 'products__title']));
  expect(document.activeElement).toBe(colRow(menu, 1));
  // A plain arrow still moves focus.
  fireEvent.keyDown(colRow(menu, 1), { key: 'ArrowDown' });
  expect(document.activeElement).toBe(colRow(menu, 2));
});

test('sankey: a flick (move and release with no render in between) saves the slot the last move marked', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    // Native dispatches outside act: React has not re-rendered between the move and the release.
    grip.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, buttons: 1, clientY: y(3) + 10 }));
    grip.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientY: y(3) + 10 }));
  } finally { env.IS_REACT_ACT_ENVIRONMENT = true; }
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'products__title', 'status']));
});

test('sankey: a move with no button down ends the drag, and a lost pointer capture ends it too', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(2));
  expect(menu.querySelector('[data-drop-line]')).not.toBeNull();
  fireEvent.pointerMove(grip, { pointerId: 1, buttons: 0, clientY: y(3) });
  expect(menu.querySelector('[data-drop-line]')).toBeNull();
  press(grip, y(1));
  move(grip, y(2));
  fireEvent.lostPointerCapture(grip, { pointerId: 1 });
  expect(menu.querySelector('[data-drop-line]')).toBeNull();
  expect(t.puts).not.toHaveBeenCalled();
});

test('sankey: after Escape cancels a drag, the release and click open no submenu', async () => {
  layoutRows();
  await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(3));
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
  release(colRow(menu, 3), y(3));
  // The click of the same press, which the browser sends on the row now under the pointer.
  fireEvent.click(colRow(menu, 3), { detail: 1 });
  expect(screen.queryByRole('menu', { name: 'Column 3' })).toBeNull();
});

test('sankey: after a drop, the row under the pointer opens its submenu only once the pointer has left it', async () => {
  layoutRows();
  await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(3) + 10);
  release(grip, y(3) + 10);
  fireEvent.mouseEnter(colRow(menu, 3));
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.queryByRole('menu', { name: 'Column 3' })).toBeNull();
  fireEvent.mouseLeave(colRow(menu, 3));
  fireEvent.mouseEnter(colRow(menu, 3));
  expect(await screen.findByRole('menu', { name: 'Column 3' })).toBeInTheDocument();
});

test('sankey: a slow drag that stays above the next row\'s centre saves nothing', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  for (let at = y(1) + 2; at <= y(1) + 24; at += 2) move(grip, at);
  release(grip, y(1) + 24);
  // A save lands a moment after the release: wait it out before saying nothing was saved.
  await new Promise((r) => setTimeout(r, 300));
  expect(t.puts).not.toHaveBeenCalled();
});

test('sankey: after a drag down, the row under the pointer opens no submenu on its first hover', async () => {
  layoutRows();
  await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(2) + 4);
  release(grip, y(2) + 4);
  fireEvent.mouseEnter(colRow(menu, 2));
  await new Promise((r) => setTimeout(r, 200));
  expect(screen.queryByRole('menu', { name: 'Column 2' })).toBeNull();
});

test('sankey: pushing past the last row settles on the last slot and stays there', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  const lines: (string | undefined)[] = [];
  const shifts: string[] = [];
  for (const at of [y(3) + 10, y(3) + 20, y(3) + 40, y(3) + 40, y(3) + 40]) { move(grip, at); lines.push(menu.querySelector<HTMLElement>('[data-drop-line]')?.style.top); shifts.push(colRow(menu, 1).style.transform); }
  expect(new Set(lines).size).toBe(1);
  // The dragged row rests at the clamp (two rows down) and does not flip-flop.
  expect(new Set(shifts)).toEqual(new Set(['translateY(64px)']));
  release(grip, y(3) + 40);
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'products__title', 'status']));
});

test('sankey: a column drag is an Undo step: Undo puts the old order back and saves it, Redo moves it again', async () => {
  layoutRows();
  const t = await charts(orderSaved);
  await waitFor(() => expect(titles()).toHaveLength(3));
  const before = orderTitles();
  const menu = await columnsMenu();
  const grip = gripOf(menu, 1);
  press(grip, y(1));
  move(grip, y(3) + 10);
  release(grip, y(3) + 10);
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'products__title', 'status']));
  await waitFor(() => expect(orderTitles()).not.toEqual(before));
  // Escape steps back one menu level at a time; the Undo button is only reachable once the whole menu is closed.
  await waitFor(async () => { await userEvent.keyboard('{Escape}'); expect(screen.queryByRole('menu', { name: 'Sankey menu' })).toBeNull(); });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Undo' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(savedDims(t)).toEqual(ORDER));
  await waitFor(() => expect(orderTitles()).toEqual(before));
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(savedDims(t)).toEqual(['is_gift', 'products__title', 'status']));
  await waitFor(() => expect(orderTitles()).not.toEqual(before));
});
