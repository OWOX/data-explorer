import { useEffect } from 'react';
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Dispatch } from 'react';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type Action, type GridState } from '../../state/store';
import { App } from '../App';

// Every traverseData call is a billed warehouse run. The card's own count is one column, `limit: 1` and `includeTotalRowCount`, and nothing else.
const isCardCount = (q: TraverseOptions) => Object.keys(q).length === 3 && q.column?.length === 1 && q.limit === 1 && q.includeTotalRowCount === true;

function setup(grid: GridState, opts: { noKey?: boolean; calc?: boolean; hiddenKey?: boolean } = {}) {
  const fixtures = structuredClone(demoFixtures());
  if (opts.hiddenKey) fixtures.marts.find((m) => m.id === 'orders')!.fields.find((f) => f.name === 'id')!.isHiddenForReporting = true;
  if (opts.noKey) for (const f of fixtures.marts.find((m) => m.id === 'orders')!.fields) f.isPrimaryKey = false;
  if (opts.calc) fixtures.marts.find((m) => m.id === 'orders')!.fields.push({ name: 'margin', type: 'NUMERIC', alias: 'Margin', calculated: { level: 'metric' } } as never);
  const base = createMockCtx(fixtures, { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const state: { total: number; gate: Promise<void> | null; fail: boolean } = { total: 123, gate: null, fail: false };
  const store: { dispatch?: Dispatch<Action>; selection?: unknown } = {};
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => {
      if (id === 'orders') queries.push(o);
      if (id === 'orders' && o.includeTotalRowCount && !isCardCount(o) && state.fail) return Promise.reject(new Error('read failed'));
      const done = id === 'orders' && o.includeTotalRowCount && !isCardCount(o) ? real(id, o).then((r) => ({ ...r, totalRowCount: state.total })) : real(id, o);
      return id === 'orders' && o.includeTotalRowCount && !isCardCount(o) && state.gate ? state.gate.then(() => done) : done;
    } } },
  };
  function Probe() {
    const [{ selection }, dispatch] = useStore();
    store.dispatch = dispatch;
    store.selection = selection;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  const mount = async () => { render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>); };
  /** A view link opens: the grid takes this state wherever it is, folded or reading. */
  const apply = (g: GridState) => act(async () => { store.dispatch!({ type: 'applyView', selection: store.selection as never, grid: g, search: '', contextIds: [], storageIds: null }); });
  /** Holds every total read that starts from now until the returned release runs. */
  const hold = () => {
    let release!: () => void;
    state.gate = new Promise<void>((res) => { release = () => { state.gate = null; res(); }; });
    return release;
  };
  return { queries, state, hold, mount, apply, countReads: () => queries.filter(isCardCount) };
}

const data = () => document.getElementById('band-data')!;
const card = () => document.querySelector<HTMLElement>('[data-mart-id="orders"]:not([data-path])');
const shown = () => card()?.textContent ?? '';
const calm = () => act(async () => { await new Promise((r) => setTimeout(r, 150)); });
const rowsShown = () => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true);
const refresh = () => userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));

const plain: GridState = { columns: ['id', 'status', 'amount', 'created_at'], filters: {}, sorts: null, limit: 200 };
const filtered: GridState = { ...plain, filters: { status: { field: 'status', op: 'eq', value: 'paid' } } };

test('a plain unfiltered grid of a mart with a key gives its total to the card', async () => {
  const t = setup(plain);
  await t.mount();
  await waitFor(rowsShown);
  await waitFor(() => expect(shown()).toMatch(/123 records/));
});

test('a key hidden for reporting, which the grid reads to open rows by, still gives the total to the card, and Refresh adds no count read', async () => {
  const t = setup({ ...plain, columns: ['status', 'amount', 'created_at'] }, { hiddenKey: true });
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
  expect(t.queries.some((q) => q.column?.includes('id'))).toBe(true);
  await calm();
  const before = t.countReads().length;
  t.state.total = 456;
  await refresh();
  await waitFor(() => expect(shown()).toMatch(/456 records/));
  await calm();
  expect(t.countReads()).toHaveLength(before);
});

test.each([
  ['a filter', filtered, {}],
  ['a calculated column', { ...plain, columns: [...plain.columns, 'margin'] }, { calc: true }],
  ['a Unique Count column', { ...plain, uniqueCount: [''] } as GridState, {}],
])('with %s the card does not take the grid total', async (_n, grid, opts) => {
  const t = setup(grid, opts);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(shown()).not.toMatch(/123 records/);
});

test.each([
  ['a joined column', { ...plain, columns: [...plain.columns, 'products__price'] }, {}],
  ['a slice', { ...plain, slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'PL' } } } as GridState, {}],
  ['no primary key', plain, { noKey: true }],
])('with %s the card still takes the grid total (COUNT(*) needs no key, and joined marts never change the main row count)', async (_n, grid, opts) => {
  const t = setup(grid, opts);
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
});

test('Refresh on a plain grid adds no count read, and the card shows the new total', async () => {
  const t = setup(plain);
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
  await calm();
  const before = t.countReads().length;
  t.state.total = 456;
  await refresh();
  await waitFor(() => expect(shown()).toMatch(/456 records/));
  await calm();
  expect(t.countReads()).toHaveLength(before);
});

test('Refresh with a filter set recounts the card with exactly one count read', async () => {
  const t = setup(filtered);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  const before = t.countReads().length;
  await refresh();
  await calm();
  expect(t.countReads()).toHaveLength(before + 1);
});

test('Refresh in Charts recounts the card with exactly one count read', async () => {
  const t = setup({ ...plain, view: 'charts' });
  await t.mount();
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  const before = t.countReads().length;
  await refresh();
  await calm();
  expect(t.countReads()).toHaveLength(before + 1);
});

const dimmed = () => card()?.querySelector('.dm-badge.dm-stale') !== null && card()?.querySelector('.dm-badge[aria-busy]') !== null;

test('Refresh on a plain grid dims the card while the grid reads, then shows the new total', async () => {
  const t = setup(plain);
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
  await calm();
  t.state.total = 456;
  const release = t.hold();
  await refresh();
  await waitFor(() => expect(dimmed()).toBe(true));
  expect(shown()).toMatch(/123 records/);
  release();
  await waitFor(() => expect(shown()).toMatch(/456 records/));
  expect(dimmed()).toBe(false);
});

test('a plain Refresh whose read fails counts the card once', async () => {
  const t = setup(plain);
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
  await calm();
  const before = t.countReads().length;
  t.state.fail = true;
  await refresh();
  await calm();
  expect(t.countReads()).toHaveLength(before + 1);
});

test('a filter added while a plain Refresh reads counts the card once', async () => {
  const t = setup(plain);
  await t.mount();
  await waitFor(() => expect(shown()).toMatch(/123 records/));
  await calm();
  const before = t.countReads().length;
  const release = t.hold();
  await refresh();
  await t.apply(filtered);
  release();
  await calm();
  await waitFor(() => expect(t.countReads()).toHaveLength(before + 1));
});

test('a grouped read left in a folded band is not given to the card when the grid goes back to plain rows', async () => {
  const grouped: GridState = { columns: ['status', 'amount'], filters: {}, aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200 };
  const t = setup(grouped);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  await userEvent.click(within(document.body).getByRole('button', { name: 'Hide Data' }));
  await t.apply(plain);
  await calm();
  expect(shown()).not.toMatch(/123 records/);
});

test.each([
  ['a filter on a calculated field', { ...plain, filters: { margin: { field: 'margin', op: 'gt', value: 1 } } } as GridState, { calc: true }],
])('with %s the card does not take the grid total', async (_n, grid, opts) => {
  const t = setup(grid, opts);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(shown()).not.toMatch(/123 records/);
});
