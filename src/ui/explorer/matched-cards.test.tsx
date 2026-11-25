import { useEffect } from 'react';
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHARTS_COLLECTION } from '../../api/chart-settings';
import type { ChartSettings } from '../../charts/settings';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';

const isScore = (q: TraverseOptions) => !!q.uniqueCount?.includes('') && !!q.filter?.length && q.limit === undefined && !q.sort && !q.dateTrunc;

// Every traverseData call is a billed warehouse run: the match badge on the cards has no query of its own, it rides on the scorecard read.
function setup(grid: GridState, opts: { charts?: ChartSettings; fail?: (o: TraverseOptions) => boolean } = {}) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); return id === 'orders' && opts.fail?.(o) ? Promise.reject(new Error('read failed')) : real(id, o); } } },
  };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  const seeded = opts.charts ? ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', opts.charts) : Promise.resolve();
  const mount = async () => { await seeded; render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>); };
  // The scorecard read: a unique count of the main mart next to a rule, with no sort, limit or date bucket (the sparklines and the charts have them).
  // The card counts ({ uniqueCount: [''] }, no rule) and the grid's reads are not it.
  const scoreReads = () => queries.filter((q) => isScore(q));
  return { queries, mount, scoreReads };
}

const data = () => document.getElementById('band-data')!;
const radio = (name: string) => within(data()).getByRole('radio', { name });
const card = (id: string, path?: string) => document.querySelector<HTMLElement>(path ? `[data-mart-id="${id}"][data-path="${path}"]` : `[data-mart-id="${id}"]:not([data-path])`);
const badge = (id: string, path?: string) => card(id, path)?.querySelector('[data-match]')?.textContent ?? null;
const calm = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });
const rowsShown = () => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true);

const paid = { status: { field: 'status', op: 'eq' as const, value: 'paid' } };
const mainOnly: GridState = { columns: ['id', 'status', 'amount', 'created_at'], filters: paid, sorts: null, limit: 200 };
const withProducts: GridState = { ...mainOnly, columns: [...mainOnly.columns, 'products__price'] };

test('Table, only the main mart: the badge is the grid total and no scorecard is read', async () => {
  const t = setup(mainOnly);
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
});

test('Table with no filter and no slice: no badge and no scorecard read', async () => {
  const t = setup({ ...withProducts, filters: {} });
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(badge('orders')).toBeNull();
  expect(t.scoreReads()).toHaveLength(0);
});

test('Table with a joined mart: one scorecard read gives every mart its badge, and Charts then reads none', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  expect(badge('orders')).toMatch(/^\d+% match$/);
  await userEvent.click(radio('Table'));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('Charts first, then Table: still one scorecard read', async () => {
  const t = setup({ ...withProducts, view: 'charts' });
  await t.mount();
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  expect(t.scoreReads()).toHaveLength(1);
  await userEvent.click(radio('Table'));
  await waitFor(rowsShown);
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  expect(badge('orders')).toMatch(/^\d+% match$/);
});

test('a slice shares the one read between Table and Charts', async () => {
  const t = setup({ columns: ['id', 'status', 'customers__city'], filters: {}, slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'PL' } }, sorts: null, limit: 200 });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  expect(t.scoreReads()[0]!.filter).toEqual([expect.objectContaining({ placement: 'pre-join' })]);
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  await userEvent.click(radio('Table'));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('a mart kept with no column rides on the same read in both views and draws no scorecard', async () => {
  const t = setup({ ...mainOnly, emptyPaths: ['products'] });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  expect(t.scoreReads()[0]!.uniqueCount).toEqual(['', 'products']);
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  expect(data().querySelector('td[data-chart-group="products"]')).toBeNull();
  expect(data().querySelector('[data-card="records:products"]')).toBeNull();
});

test('a hidden scorecard does not change the read', async () => {
  const t = setup(withProducts, { charts: { version: 2, scorecards: { hidden: ['amount', 'records:products'] } } });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('a HAVING filter beside a filter: Table reads the keys and the scorecards once, and Charts adds neither', async () => {
  const grid: GridState = {
    columns: ['status', 'amount'], filters: { ...paid, amount: { field: 'amount', op: 'gt', value: 1, fn: 'SUM' } },
    aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200,
  };
  const t = setup(grid);
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  const keyReads = () => t.queries.filter((q) => q.limit === 501);
  await calm();
  const keys = keyReads().length;
  expect(keys).toBe(1);
  expect(t.scoreReads()[0]!.filter?.some((f) => f.operator === 'in')).toBe(true);
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  expect(keyReads()).toHaveLength(keys);
});

test('only HAVING filters: no badge and no scorecard read in Table', async () => {
  const t = setup({ columns: ['status', 'amount'], filters: { amount: { field: 'amount', op: 'gt', value: 1, fn: 'SUM' } }, aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200 });
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(badge('orders')).toBeNull();
  expect(t.scoreReads()).toHaveLength(0);
  expect(t.queries.filter((q) => q.limit === 501)).toHaveLength(0);
});

test('a grouped Table reads the scorecards once, since its total counts groups', async () => {
  const t = setup({ columns: ['status', 'amount'], filters: { id: { field: 'id', op: 'gt', value: 100 } }, aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200 });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
});

test('a failed scorecard read shows no badge', async () => {
  const t = setup(withProducts, { fail: isScore });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await calm();
  expect(badge('orders')).toBeNull();
});

const marts = () => document.getElementById('band-marts')!;
const toGraph = async () => userEvent.click(within(within(marts()).getByRole('radiogroup', { name: 'Show data marts as' })).getByRole('radio', { name: 'Graph' }));
const few = { id: { field: 'id', op: 'lt' as const, value: 4 } };

test('each mart of the report gets its own badge, on the Grid cards and on the Graph', async () => {
  const t = setup({ ...withProducts, filters: few });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toBe('<1% match'));
  await waitFor(() => expect(badge('products', 'products')).toMatch(/^\d+% match$/));
  expect(t.scoreReads()).toHaveLength(1);
  await toGraph();
  await waitFor(() => expect(marts().querySelector('[data-testid="marts-canvas"]')).not.toBeNull());
  await waitFor(() => expect(badge('orders')).toBe('<1% match'));
  expect(badge('products', 'products')).toMatch(/^\d+% match$/);
  expect(t.scoreReads()).toHaveLength(1);
});

test('a mart reached at two paths: the Graph shows each path its own number, the Grid card none', async () => {
  const t = setup({ columns: ['id', 'status', 'customers__countries__name', 'stores__countries__name'], filters: few, sorts: null, limit: 200 });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  expect(t.scoreReads()[0]!.uniqueCount).toEqual(['', 'customers.countries', 'stores.countries']);
  await waitFor(() => expect(badge('orders')).toBe('<1% match'));
  expect(badge('countries', 'customers.countries')).toBeNull();
  expect(badge('countries', 'stores.countries')).toBeNull();
  await toGraph();
  await waitFor(() => expect(badge('countries', 'customers.countries')).toMatch(/^\d+% match$/));
  expect(badge('countries', 'stores.countries')).toMatch(/^\d+% match$/);
  expect(t.scoreReads()).toHaveLength(1);
});

test('a filter taken off, or another main mart, leaves no badge behind', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await userEvent.click(within(data()).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(badge('orders')).toBeNull());
  expect(badge('products', 'products')).toBeNull();
});

test('a rule on a joined field with the main mart alone in the report is counted by the scorecard read, not by the grid total', async () => {
  const t = setup({ ...mainOnly, filters: { products__price: { field: 'products__price', op: 'gt', value: 0 } } });
  await t.mount();
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  await calm();
  expect(t.queries.some((q) => q.filter?.some((f) => f.column === 'products__price'))).toBe(true);
  expect(t.scoreReads()).toHaveLength(1);
});
