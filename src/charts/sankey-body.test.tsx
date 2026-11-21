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
import { NO_MEASURE_NOTE } from './kinds/sankey';
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

test('sankey: Columns adds a column filled with the next dimension, a column pick swaps, fewer columns drop the last', async () => {
  const t = await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey' }] } });
  await waitFor(() => expect(data().querySelectorAll('path[data-link]').length).toBeGreaterThan(0));
  expect(titles()).toHaveLength(2);
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: '3' }));
  // The third column is Products' (the next mart's), so no metric fits all three columns: the panel says so instead of drawing.
  expect(await within(data()).findByText(NO_MEASURE_NOTE)).toBeInTheDocument();
  expect(titles()).toHaveLength(0);
  const first = savedDims(t);
  expect(new Set(first).size).toBe(3);
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Column 1' }));
  await userEvent.click((await screen.findAllByRole('menuitemradio')).find((el) => el.getAttribute('aria-checked') === 'false')!);
  await waitFor(() => expect(savedDims(t)[0]).not.toBe(first[0]));
  expect(new Set(savedDims(t)).size).toBe(3);
  expect(data().querySelectorAll('path[data-link]')).toHaveLength(0);
  await userEvent.click(panel('Sankey'));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Columns' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: '2' }));
  await waitFor(() => expect(titles()).toHaveLength(2));
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
    // Only a capped flow read is followed by the 1-row read from the other end, to find a negative among the left-out flows.
    const low = t.queries.slice(t.tableQueries()).filter((q) => q.limit === 1);
    expect(low).toHaveLength(1);
    expect(low[0]!.sort?.[0]?.direction).toBe('asc');
    const hint = await within(data().querySelector<HTMLElement>('section[data-chart-kind="Sankey"]')!).findByRole('note');
    await userEvent.hover(hint);
    expect(await screen.findByText('Showing the largest 3 combinations; smaller flows are left out.')).toBeInTheDocument();
  } finally { cap.n = 5000; }
});

test('sankey: negative values draw the empty state with a note, not a chart', async () => {
  await charts({ columns: dims, charts: { version: 2, charts: [{ id: 's', kind: 'sankey', dimensions: ['status', 'is_gift'] }] },
    mapRow: (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, k.includes(' | ') && typeof v === 'number' ? -v : v])) });
  expect(await within(data()).findByText('Sankey needs values of 0 or more; this metric has negative values.')).toBeInTheDocument();
  expect(data().querySelectorAll('path[data-link]')).toHaveLength(0);
});
