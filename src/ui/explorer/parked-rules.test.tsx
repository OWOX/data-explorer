import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;

// Pins how the grid keeps rules on fields it does not offer ("parked"): they are never sent, always saved, and Reset, a followed link and Undo treat them like the applied ones.
function setup(grid: GridState, opts: { blendFails?: boolean } = {}) {
  let failing = !!opts.blendFails;
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const realGet = base.owox.getJson.bind(base.owox);
  const ctx: Ctx = {
    ...base,
    owox: {
      ...base.owox,
      dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); return real(id, o); } },
      getJson: (<T,>(path: string, query?: Record<string, string>) => (path.endsWith('/blendable-schema') && failing ? Promise.reject(new Error('blendable boom')) : realGet<T>(path, query))) as Mock['owox']['getJson'],
    },
  };
  const live: { state: ReturnType<typeof useStore>[0] | null; dispatch: ReturnType<typeof useStore>[1] | null } = { state: null, dispatch: null };
  function Probe() {
    const [s, dispatch] = useStore();
    live.state = s;
    live.dispatch = dispatch;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries, live, heal: () => { failing = false; }, saved: () => live.state!.grids.orders! };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const slice = { field: 'customers__country_code', op: 'eq' as const, value: 'PL' };
const parkedFilter = { field: 'customers__city', op: 'contains' as const, value: 'a' };
const appliedFilter = { field: 'status', op: 'eq' as const, value: 'paid' };
const mixed: GridState = {
  columns: ['id', 'status', 'customers__city'], filters: { status: appliedFilter, customers__city: parkedFilter }, slices: { customers__country_code: slice }, sorts: null, limit: 200,
};

test('rules on fields that are not offered are not sent, and are saved with the applied ones', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.some((q) => q.filter?.length === 1)).toBe(true));
  expect(t.queries.at(-1)!.filter).toEqual([{ column: 'status', operator: 'eq', value: 'paid' }]);
  expect(t.saved().filters).toEqual({ status: appliedFilter, customers__city: parkedFilter });
  expect(t.saved().slices).toEqual({ customers__country_code: slice });
});

test('Reset clears the parked filters and slices with the applied ones, and Undo brings all of them back', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  const reset = within(data()).getByRole('button', { name: 'Reset' });
  await waitFor(() => expect(reset).toBeEnabled());
  await userEvent.click(reset);
  await waitFor(() => expect(t.saved().filters).toEqual({}));
  expect(t.saved().slices).toBeUndefined();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(t.saved().filters).toEqual({ status: appliedFilter, customers__city: parkedFilter }));
  expect(t.saved().slices).toEqual({ customers__country_code: slice });
});

test('a followed link replaces the applied and the parked rules, and the slices', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  act(() => { t.live.dispatch!({ type: 'follow', target: { kind: 'mart', martId: 'orders', filters: [{ field: 'id', op: 'eq', value: '1' }] }, sourceOf: () => null }); });
  await waitFor(() => expect(t.queries.at(-1)!.filter).toEqual([{ column: 'id', operator: 'eq', value: 1 }]));
  await waitFor(() => expect(t.saved().filters).toEqual({ id: { field: 'id', op: 'eq', value: '1' } }));
  expect(t.saved().slices).toBeUndefined();
});

test('an edit made while rules are parked keeps them, and Undo of that edit keeps them too', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  const menu = await openColumnMenu(within(data()), 'status');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(t.saved().columns).toEqual(['id']));
  expect(t.saved().filters).toEqual({ status: appliedFilter, customers__city: parkedFilter });
  expect(t.saved().slices).toEqual({ customers__country_code: slice });
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(t.saved().columns).toEqual(['id', 'status']));
  expect(t.saved().filters).toEqual({ status: appliedFilter, customers__city: parkedFilter });
  expect(t.saved().slices).toEqual({ customers__country_code: slice });
});

test('a parked filter is applied once its field is offered, with no note about it', async () => {
  const t = setup(mixed);
  await waitFor(() => expect(headers()).toEqual(['id', 'status', 'city']));
  await waitFor(() => expect(t.queries.some((q) => q.filter?.length === 3)).toBe(true));
  expect(screen.queryByText(/is paused/)).toBeNull();
});

test('Redo of an edit made while rules are parked keeps them', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  const menu = await openColumnMenu(within(data()), 'status');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(t.saved().columns).toEqual(['id']));
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(t.saved().columns).toEqual(['id', 'status']));
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(t.saved().columns).toEqual(['id']));
  expect(t.saved().filters).toEqual({ status: appliedFilter, customers__city: parkedFilter });
  expect(t.saved().slices).toEqual({ customers__country_code: slice });
});

test('a view link that seeds the grid keeps the parked rules it names and sends only the offered ones', async () => {
  const t = setup(mixed, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  const other = { field: 'status', op: 'eq' as const, value: 'refunded' };
  const parkedOther = { field: 'customers__city', op: 'contains' as const, value: 'z' };
  act(() => {
    t.live.dispatch!({ type: 'applyView', selection: { sourceKey: null, martId: 'orders', record: null }, search: '', contextIds: [], storageIds: null, grid: { columns: ['id', 'status', 'customers__city'], filters: { status: other, customers__city: parkedOther }, sorts: null, limit: 200 } });
  });
  await waitFor(() => expect(t.queries.at(-1)!.filter).toEqual([{ column: 'status', operator: 'eq', value: 'refunded' }]));
  expect(t.saved().filters).toEqual({ status: other, customers__city: parkedOther });
  expect(t.saved().slices).toBeUndefined();
});
