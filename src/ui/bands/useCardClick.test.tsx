import { render, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Model } from '../../model/types';
import { AppServices, StoreProvider, useServices, useStore, type State } from '../../state/store';
import { useCardClick } from './useCardClick';

const mart = (id: string) => [id, { id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null }] as const;
const model = { marts: new Map(['orders', 'customers'].map(mart)), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] } as unknown as Model;

test('two direct deselect clicks on one joined mart take it out once and never put it back', async () => {
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  function Probe() {
    const [s, dispatch] = useStore();
    state = s;
    click = useCardClick(model);
    useEffect(() => { dispatch({ type: 'init', focusId: 'orders' }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  await click('customers');
  await waitFor(() => expect(state.grids.orders?.columns.some((c) => c.startsWith('customers__'))).toBe(true));
  await Promise.all([click('customers', { only: 'deselect' }), click('customers', { only: 'deselect' })]);
  await new Promise((r) => setTimeout(r, 100));
  expect(state.grids.orders!.columns.some((c) => c.startsWith('customers__'))).toBe(false);
});

test('a failed joined-fields read keeps the saved joined-field rules instead of pruning them', async () => {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const ctx = { ...base, owox: { ...base.owox, getJson: (path: string, q?: never) => (path.endsWith('/blendable-schema') ? Promise.reject(new Error('down')) : base.owox.getJson(path, q)) } } as typeof base;
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  function Probe() {
    const [s, dispatch] = useStore();
    const { columnStore } = useServices();
    state = s;
    click = useCardClick(model);
    useEffect(() => {
      columnStore.saveView('customers', { filters: { orders__status: { field: 'orders__status', op: 'eq', value: 'Kyiv' } }, sorts: null, limit: 100 });
      columnStore.save('customers', ['id', 'orders__status']);
      dispatch({ type: 'init', focusId: 'orders' });
    }, [dispatch, columnStore]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  await click('customers', { mode: 'makeMain' });
  await waitFor(() => expect(state.selection.martId).toBe('customers'));
  expect(state.grids.customers!.columns).toContain('orders__status');
  expect(state.grids.customers!.filters.orders__status).toBeDefined();
});

test('a click is not over when another re-render of the bands runs its effects after the dispatch', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  let shown!: State;
  let tick!: (n: number) => void;
  let hold = false;
  let letGo: (() => void) | null = null;
  function Probe() {
    const [s, dispatch] = useStore();
    const { columnStore } = useServices();
    const [n, setN] = useState(0);
    state = s;
    tick = setN;
    click = useCardClick(model);
    useEffect(() => { dispatch({ type: 'init', focusId: 'orders' }); }, [dispatch]);
    // The state whose effects have run, as the bands' own `useLatest` sees it.
    useEffect(() => { shown = s; });
    // The click's last read ends in the commit of an unrelated re-render: it dispatches before that commit's effects have run.
    useLayoutEffect(() => { if (n > 0) letGo?.(); }, [n]);
    useEffect(() => {
      const load = columnStore.loadLastShown.bind(columnStore);
      columnStore.loadLastShown = (id) => (hold && id === 'customers' ? new Promise((r) => { letGo = () => { r(load(id)); }; }) : load(id));
    }, [columnStore]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
  const was = env.IS_REACT_ACT_ENVIRONMENT;
  env.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    hold = true;
    const joined = () => shown.grids.orders?.columns.some((c) => c.startsWith('customers__')) ?? false;
    const done = click('customers').then(joined);
    for (let i = 0; i < 200 && letGo === null; i++) await new Promise((r) => setTimeout(r, 5));
    expect(letGo).not.toBeNull();
    tick(1);
    expect(await done).toBe(true);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = was;
  }
});
