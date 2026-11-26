import { act, render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { vi } from 'vitest';
import { CHARTS_COLLECTION } from '../api/chart-settings';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import type { Ctx } from '../sdk/types';
import type { Field } from '../model/types';
import { AppServices, StoreProvider, useStore } from '../state/store';
import { ChartsBody } from './ChartsBody';
import type { ChartSettings } from './settings';

const f = (name: string): Field => ({ name, alias: null, type: 'FLOAT', category: 'number', description: null, isPrimaryKey: false });
const saved: ChartSettings = { version: 2, charts: [{ id: 'p', kind: 'pie', hidden: true }] };
const undone: ChartSettings = { version: 2, charts: [{ id: 'p', kind: 'pie' }] };

const props = {
  martId: 'orders', schema: [f('amount')], shown: ['amount'], agg: { aggregations: [], dateTrunc: [] }, filter: [], groups: [{ id: 'orders', path: '', span: 1, title: 'Orders' }],
  version: 0, paused: true, hasFilters: false, sources: [], formatOf: () => ({ kind: 'auto' }) as never, onFilter: () => {}, onShowColumns: () => {}, renderConfig: () => null, scrollerWidth: 500,
};
async function recording() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const puts = vi.fn();
  const ctx: Ctx = { ...base, collections: <T,>(name: string) => { const c = base.collections<T>(name); return name === CHARTS_COLLECTION ? { get: (id: string) => c.get(id), put: (id: string, d: T) => { puts(id, d); return c.put(id, d); } } : c; } };
  await ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', saved);
  puts.mockClear();
  return { ctx, puts };
}

// The store holds an older copy than the saved doc (another tab saved since): a mount shows the saved doc and never writes the old copy back.
function Seeded({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useStore();
  useEffect(() => { dispatch({ type: 'saveCharts', martId: 'orders', settings: undone }); }, [dispatch]);
  return state.charts.orders ? <>{children}</> : null;
}

test('on a mount the saved doc wins over the store copy and the copy is never written back', async () => {
  const { ctx, puts } = await recording();
  const seen: { v?: ChartSettings } = {};
  function Spy() { const [s] = useStore(); useEffect(() => { seen.v = s.charts.orders; }); return null; }
  render(<AppServices ctx={ctx}><StoreProvider><Seeded><Spy /><table><ChartsBody {...props} /></table></Seeded></StoreProvider></AppServices>);
  await waitFor(() => expect(seen.v).toEqual(saved));
  expect(puts).not.toHaveBeenCalled();
});

// An Undo in the table view, with no Charts body mounted: the store saves what it put back.
test('an Undo made while Charts is not mounted is saved', async () => {
  const { ctx, puts } = await recording();
  const grab: { dispatch?: ReturnType<typeof useStore>[1] } = {};
  function Grab() { const [, d] = useStore(); useEffect(() => { grab.dispatch = d; }, [d]); return null; }
  render(<AppServices ctx={ctx}><StoreProvider><Grab /></StoreProvider></AppServices>);
  const dispatch = ((a) => grab.dispatch!(a)) as ReturnType<typeof useStore>[1];
  act(() => { dispatch({ type: 'init', focusId: 'orders' }); dispatch({ type: 'saveCharts', martId: 'orders', settings: saved }); dispatch({ type: 'editCharts', martId: 'orders', settings: undone }); });
  expect(puts).not.toHaveBeenCalled();
  act(() => dispatch({ type: 'undo' }));
  await waitFor(() => expect(puts).toHaveBeenCalledWith('orders', saved));
  act(() => dispatch({ type: 'redo' }));
  await waitFor(() => expect(puts).toHaveBeenLastCalledWith('orders', undone));
  expect(puts).toHaveBeenCalledTimes(2);
});
