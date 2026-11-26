import { render, waitFor } from '@testing-library/react';
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

// The store holds settings the Charts body is not mounted to see (an Undo landed in the table view): the body takes them over what is saved.
function Seeded({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useStore();
  useEffect(() => { dispatch({ type: 'saveCharts', martId: 'orders', settings: undone }); }, [dispatch]);
  return state.charts.orders ? <>{children}</> : null;
}

test('the store holds settings from an Undo made in the table view: Charts shows them and saves them', async () => {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const puts = vi.fn();
  const ctx: Ctx = { ...base, collections: <T,>(name: string) => { const c = base.collections<T>(name); return name === CHARTS_COLLECTION ? { get: (id: string) => c.get(id), put: (id: string, d: T) => { puts(id, d); return c.put(id, d); } } : c; } };
  await ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', saved);
  const props = {
    martId: 'orders', schema: [f('amount')], shown: ['amount'], agg: { aggregations: [], dateTrunc: [] }, filter: [], groups: [{ id: 'orders', path: '', span: 1, title: 'Orders' }],
    version: 0, paused: true, hasFilters: false, sources: [], formatOf: () => ({ kind: 'auto' }) as never, onFilter: () => {}, onShowColumns: () => {}, renderConfig: () => null, scrollerWidth: 500,
  };
  render(<AppServices ctx={ctx}><StoreProvider><Seeded><table><ChartsBody {...props} /></table></Seeded></StoreProvider></AppServices>);
  await waitFor(() => expect(puts).toHaveBeenCalledWith('orders', undone));
});
