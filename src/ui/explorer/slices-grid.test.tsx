import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;

function setup(grid: GridState, opts: { blendFails?: boolean } = {}) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const realGet = base.owox.getJson.bind(base.owox);
  const ctx: Ctx = {
    ...base,
    owox: {
      ...base.owox,
      dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); return real(id, o); } },
      getJson: (<T,>(path: string, query?: Record<string, string>) => (opts.blendFails && path.endsWith('/blendable-schema') ? Promise.reject(new Error('blendable boom')) : realGet<T>(path, query))) as Mock['owox']['getJson'],
    },
  };
  const state: { current: ReturnType<typeof useStore>[0] | null } = { current: null };
  function Probe() {
    const [s, dispatch] = useStore();
    state.current = s;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries, state };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const slice = { field: 'customers__country_code', op: 'eq' as const, value: 'PL' };
const sliced: GridState = { columns: ['id', 'status', 'customers__city'], filters: {}, slices: { customers__country_code: slice }, sorts: null, limit: 200 };
const having: GridState = {
  columns: ['status', 'net_revenue'], filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: 100, fn: 'SUM' } }, aggregations: [{ column: 'net_revenue', function: 'SUM' }], sorts: null, limit: 200,
};

test('the rows query sends the slice, pre-join, with an explicit column list', async () => {
  const t = setup(sliced);
  await waitFor(() => expect(t.queries.some((q) => q.filter?.some((f) => f.placement === 'pre-join'))).toBe(true));
  const q = t.queries.find((x) => x.filter?.some((f) => f.placement === 'pre-join'))!;
  expect(q.filter).toEqual([{ column: 'customers__country_code', operator: 'eq', value: 'PL', placement: 'pre-join' }]);
  expect(q.column).toEqual(expect.arrayContaining(['id', 'status', 'customers__city']));
});

test('a grouped rows query sends the HAVING filter with its aggregation', async () => {
  const t = setup(having);
  await waitFor(() => expect(t.queries.some((q) => q.filter?.some((f) => f.function === 'SUM'))).toBe(true));
  const q = t.queries.find((x) => x.filter?.some((f) => f.function === 'SUM'))!;
  expect(q.aggregation).toEqual([{ column: 'net_revenue', function: 'SUM' }]);
  expect(q.filter).toEqual([{ column: 'net_revenue', operator: 'gt', value: 100, function: 'SUM' }]);
});

test('Reset clears the slices too, as one step', async () => {
  const t = setup(sliced);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const reset = within(data()).getByRole('button', { name: 'Reset' });
  await waitFor(() => expect(reset).toBeEnabled());
  await userEvent.click(reset);
  await waitFor(() => expect(t.state.current!.grids.orders!.slices).toBeUndefined());
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(t.state.current!.grids.orders!.slices).toEqual({ customers__country_code: slice }));
});

test('a slice on a field that is not offered is parked: not sent, and kept in the saved grid', async () => {
  const t = setup(sliced, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  expect(t.queries.every((q) => !q.filter)).toBe(true);
  expect(t.state.current!.grids.orders!.slices).toEqual({ customers__country_code: slice });
});

test('hiding the column drops its HAVING filter in the same step, and Undo brings both back', async () => {
  const t = setup(having);
  await waitFor(() => expect(headers()).toHaveLength(2));
  const menu = await openColumnMenu(within(data()), 'Net Revenue');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(t.state.current!.grids.orders!.columns).toEqual(['status']));
  expect(t.state.current!.grids.orders!.filters).toEqual({});
  expect(t.state.current!.grids.orders!.aggregations).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(t.state.current!.grids.orders!.columns).toEqual(['status', 'net_revenue']));
  expect(t.state.current!.grids.orders!.filters.net_revenue?.fn).toBe('SUM');
  expect(t.state.current!.grids.orders!.aggregations).toEqual([{ column: 'net_revenue', function: 'SUM' }]);
});
