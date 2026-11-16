import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GRID_COLUMNS_COLLECTION } from '../../api/grid-columns';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { TraverseOptions } from '../../sdk/types';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const puts: { id: string; doc: Record<string, unknown> }[] = [];
  const queries: { id: string; o: TraverseOptions }[] = [];
  const col = ctx.collections;
  const realTraverse = ctx.owox.dataMarts.traverseData.bind(ctx.owox.dataMarts);
  const spied = {
    ...ctx,
    owox: { ...ctx.owox, dataMarts: { ...ctx.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (!(o as { uniqueCount?: unknown }).uniqueCount) queries.push({ id, o }); return realTraverse(id, o); } } },
    collections: <T,>(name: string) => { const c = col<T>(name); return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { puts.push({ id, doc: d as never }); return c.put(id, d); } } : c; },
  };
  render(<AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices>);
  return { puts, queries };
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(bodyRows().length).toBeGreaterThan(1)); };

async function showColumn(label: string | RegExp) {
  await userEvent.click(within(data()).getByRole('button', { name: 'Columns of Orders' }));
  await userEvent.click(await screen.findByLabelText(label));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

/** Opens the aggregation popover of a column, ticks the functions and applies. */
async function aggregate(column: string, ...functions: string[]) {
  await userEvent.click(await within(data()).findByRole('button', { name: `Aggregate ${column}` }));
  const dialog = await screen.findByRole('dialog');
  for (const f of functions) await userEvent.click(within(dialog).getByLabelText(f));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

test('a Sum on Amount groups by the other columns: Amount · Sum, no primary key sent, a groups badge, rows that open nothing', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await waitFor(() => expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true));
  const q = t.queries.filter((x) => x.id === 'orders').at(-1)!.o;
  expect(q.aggregation).toEqual([{ column: 'amount', function: 'SUM' }]);
  expect(q.column).toEqual(['id', 'customer_id', 'product_id', 'store_id', 'status', 'amount']);
  expect(q.sort).toBeUndefined();
  await waitFor(() => expect(within(data()).getByText(/\d+\+? groups?$/)).toBeInTheDocument());
  expect(within(data()).queryByText(/records$/)).toBeNull();
  // a grouped row is no single record
  fireEvent.click(bodyRows()[0]!);
  expect(await within(row()).findByText('Grouped rows have no single record.')).toBeInTheDocument();
  expect(bodyRows()[0]).not.toHaveClass('cursor-pointer');
  // the values are numbers read from the "<column> | SUM" key
  const at = headers().findIndex((h) => h.startsWith('Amount · Sum'));
  expect(bodyRows()[0]!.querySelectorAll('td')[at]!.textContent).toMatch(/\d/);
});

test('each function is its own column, the first is sortable, the others are not; the sort names the source column', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum', 'Average');
  await waitFor(() => expect(headers().filter((h) => h.startsWith('Amount')).length).toBe(2));
  expect(within(data()).getByRole('button', { name: /^Sort by Amount · Sum,/ })).toBeInTheDocument();
  expect(within(data()).queryByRole('button', { name: /^Sort by Amount · Average,/ })).toBeNull();
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Amount · Sum,/ }));
  await waitFor(() => expect(t.queries.at(-1)!.o.sort).toEqual([{ column: 'amount', direction: 'asc' }]));
});

test('a date takes one bucket instead of functions, and shows the bucket start by its bucket', async () => {
  const t = setup();
  await ready();
  await showColumn(/created_at/);
  await userEvent.click(await within(data()).findByRole('button', { name: 'Aggregate created_at' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Group by bucket'), 'MONTH');
  await userEvent.selectOptions(within(dialog).getByLabelText('Time zone'), 'UTC');
  // a bucket and functions exclude each other
  expect(within(dialog).getByLabelText('Min')).not.toBeChecked();
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)!.o.dateTrunc).toEqual([{ column: 'created_at', unit: 'MONTH', timeZone: 'UTC' }]));
  expect(t.queries.at(-1)!.o.aggregation).toBeUndefined();
  const at = headers().indexOf('created_at');
  await waitFor(() => expect(bodyRows()[0]!.querySelectorAll('td')[at]!.textContent).toMatch(/^[A-Z][a-z]{2} \d{4}$/));
});

test('the Sigma stays on while a column is aggregated; Clear aggregation ungroups; Reset keeps aggregations', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await waitFor(() => expect(within(data()).getByRole('button', { name: 'Aggregate Amount' })).toHaveClass('dm-reveal-on'));
  await userEvent.click(within(data()).getByRole('button', { name: 'Reset' }));
  expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true);
  await waitFor(() => expect(t.puts.some((p) => p.id === 'orders' && JSON.stringify(p.doc.aggregations) === JSON.stringify([{ column: 'amount', function: 'SUM' }]))).toBe(true), { timeout: 3000 });
  await userEvent.click(within(data()).getByRole('button', { name: 'Aggregate Amount' }));
  await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Clear aggregation' }));
  await waitFor(() => expect(headers()).toContain('Amount'));
  expect(within(data()).getByText(/records$/)).toBeInTheDocument();
});

test('the filter popover of an aggregated column says it filters before aggregating', async () => {
  setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await userEvent.click(await within(data()).findByLabelText('Filter Amount'));
  expect(await screen.findByText('Filters rows before they are aggregated')).toBeInTheDocument();
});

test('a column no longer shown loses its rules', async () => {
  const t = setup();
  await ready();
  await showColumn('Amount');
  await aggregate('Amount', 'Sum');
  await userEvent.click(within(data()).getByRole('button', { name: 'Columns of Orders' }));
  await userEvent.click(await screen.findByLabelText('Amount'));
  await waitFor(() => expect(headers()).not.toContain('Amount · Sum'));
  await waitFor(() => expect(t.queries.at(-1)!.o.aggregation).toBeUndefined());
});
