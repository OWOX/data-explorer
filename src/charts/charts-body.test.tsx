import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION } from '../api/grid-columns';
import { CHARTS_COLLECTION } from '../api/chart-settings';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx, TraverseOptions } from '../sdk/types';
import { AppServices, StoreProvider } from '../state/store';
import { App } from '../ui/App';
import { openColumnMenu, openSubmenu } from '../ui/explorer/menu-test-utils';
import type { ChartSettings } from './settings';

// Orders: a primary key, a date, a number and a string; Products joins it with a number of its own (price).
const COLUMNS = ['id', 'status', 'amount', 'created_at', 'products__price'];

function setup(opts: { charts?: ChartSettings; columns?: string[] } = {}) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const puts = vi.fn();
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); return real(id, o); } } },
    collections: <T,>(name: string) => {
      const c = base.collections<T>(name);
      return name === CHARTS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { puts(id, d); return c.put(id, d); } } : c;
    },
  };
  const seeded = Promise.all([
    ctx.collections<{ columns: string[]; at: string }>(GRID_COLUMNS_COLLECTION).put('orders', { columns: opts.columns ?? COLUMNS, at: 'then' }),
    opts.charts ? ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', opts.charts) : undefined,
  ]);
  return { queries, puts, seeded, view: () => render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>) };
}

const data = () => document.getElementById('band-data')!;
const radio = (name: string) => within(data()).getByRole('radio', { name });
const group = (id: string) => data().querySelector<HTMLElement>(`td[data-chart-group="${id}"]`);
async function charts(opts?: Parameters<typeof setup>[0]) {
  const t = setup(opts);
  await t.seeded;
  t.view();
  t.puts.mockClear();
  await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
  const seen = t.queries.length;
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(group('orders')).not.toBeNull());
  return { ...t, tableQueries: () => seen };
}
const cardNames = (el: HTMLElement | null) => [...(el?.querySelectorAll('[data-card]') ?? [])].map((c) => c.querySelector('div')!.textContent);

// A joined field never carries isPrimaryKey (blendable.ts), so a joined mart has metric cards but no Records card.
test('Charts: each data mart has its own cards in its group cell, Records first', async () => {
  await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Records', 'Amount · Sum']));
  expect(cardNames(group('products'))).toEqual(['price · Sum']);
  await waitFor(() => expect(within(group('orders')!).getByText('450')).toBeInTheDocument());
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
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Records', 'Amount · Sum']));
  await new Promise((r) => setTimeout(r, 50));
  expect(t.puts).not.toHaveBeenCalled();
});

test('hiding a card from the Scorecards menu removes it and saves', async () => {
  const t = await charts();
  await waitFor(() => expect(cardNames(group('orders'))).toContain('Amount · Sum'));
  await userEvent.click(screen.getByRole('button', { name: 'Scorecards options' }));
  await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Amount · Sum' }));
  await waitFor(() => expect(cardNames(group('orders'))).toEqual(['Records']));
  expect(t.puts).toHaveBeenCalledWith('orders', { scorecards: { hidden: ['amount'] } });
  expect(cardNames(group('products'))).toEqual(['price · Sum']);
});
