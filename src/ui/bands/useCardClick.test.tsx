import { render, waitFor } from '@testing-library/react';
import { useEffect, useLayoutEffect, useState } from 'react';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Model } from '../../model/types';
import { AppServices, StoreProvider, useServices, useStore, type GridState, type State } from '../../state/store';
import { useCardClick } from './useCardClick';

const mart = (id: string) => [id, { id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null }] as const;
// A mart added by a click joins with its Unique Count alone (no column), so it is in the report when its path is kept empty.
const hasCustomers = (g?: State['grids'][string]) => !!g && (g.emptyPaths?.includes('customers') || g.columns.some((c) => c.startsWith('customers__')));
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
  await waitFor(() => expect(hasCustomers(state.grids.orders)).toBe(true));
  await Promise.all([click('customers', { only: 'deselect' }), click('customers', { only: 'deselect' })]);
  await new Promise((r) => setTimeout(r, 100));
  expect(hasCustomers(state.grids.orders)).toBe(false);
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
    // The state on screen, as the bands' own `useLatest` sees it.
    useLayoutEffect(() => { shown = s; });
    // Slow effects: React yields between them and the render of the click's step, as on a slow machine.
    useEffect(() => { if (n > 0) { const end = performance.now() + 20; while (performance.now() < end); } }, [n]);
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
    const joined = () => hasCustomers(shown.grids.orders);
    const done = click('customers').then(joined);
    for (let i = 0; i < 200 && letGo === null; i++) await new Promise((r) => setTimeout(r, 5));
    expect(letGo).not.toBeNull();
    tick(1);
    expect(await done).toBe(true);
  } finally {
    env.IS_REACT_ACT_ENVIRONMENT = was;
  }
});

test('a second click that adds what the first already added does not hold up the clicks behind it', async () => {
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
  await click('customers', { addAt: 'customers' });
  const start = performance.now();
  await click('customers', { addAt: 'customers' });
  // It renders nothing, so it must end on the short pause, not on the wait for a render.
  expect(performance.now() - start).toBeLessThan(1000);
});

test('a ghost click (addAt) adds the mart with its Unique Count alone, and a mart added back keeps what it showed', async () => {
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  let put!: (g: GridState) => void;
  let columnStore!: ReturnType<typeof useServices>['columnStore'];
  function Probe() {
    const [s, dispatch] = useStore();
    state = s;
    put = (grid) => dispatch({ type: 'saveGrid', martId: 'orders', grid });
    columnStore = useServices().columnStore;
    click = useCardClick(model);
    useEffect(() => { dispatch({ type: 'init', focusId: 'orders' }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  put({ columns: ['id', 'status'], filters: {}, sorts: null, limit: 200 });
  await waitFor(() => expect(state.grids.orders).toBeDefined());
  const before = state.grids.orders!.columns;
  await click('customers', { addAt: 'customers' });
  await waitFor(() => expect(state.grids.orders?.emptyPaths).toEqual(['customers']));
  expect(state.grids.orders!.uniqueCount).toEqual(['customers']);
  expect(state.grids.orders!.columns).toEqual(before);
  // Back from the report with a remembered field: the new default does not replace it.
  await click('customers', { removePaths: ['customers'] });
  await waitFor(() => expect(state.grids.orders?.emptyPaths).toBeUndefined());
  columnStore.saveLastShown('customers', ['email']);
  await click('customers', { addAt: 'customers' });
  await waitFor(() => expect(state.grids.orders?.columns).toContain('customers__email'));
  expect(state.grids.orders!.uniqueCount).toBeUndefined();
  expect(state.grids.orders!.emptyPaths).toBeUndefined();
});
