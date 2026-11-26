import { useEffect } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CHARTS_COLLECTION } from '../../api/chart-settings';
import type { ChartSettings } from '../../charts/settings';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { closeConfigMenu, openFields, openSubmenu } from './menu-test-utils';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';

// A scorecard-shaped read: counts and sums with no group key, row limit, sort or date bucket (the sparklines and the charts have them).
// The plain card counts ({ uniqueCount: [''] }, or one COUNT of a text column, with no rule) and the grid's reads are not it.
const isScore = (q: TraverseOptions) => !!(q.uniqueCount?.length || q.aggregation?.some((a) => a.function === 'SUM' || a.function === 'AVG')) && q.limit === undefined && !q.sort && !q.dateTrunc
  && (q.column ?? []).every((c) => c === 'margin' || q.aggregation?.some((a) => a.column === c)) && !(Object.keys(q).length === 1 && q.uniqueCount?.length === 1 && q.uniqueCount[0] === '')
  && !(!q.filter && !q.uniqueCount && q.aggregation?.length === 1 && q.aggregation[0]!.function === 'COUNT');

// Every traverseData call is a billed warehouse run: the match badge on the cards has no query of its own, it rides on the scorecard read.
function setup(grid: GridState, opts: { /** How long a slow read waits (ms). */ slowMs?: number; charts?: ChartSettings; fail?: (o: TraverseOptions) => boolean; /** Marts that lose their primary key. */ noKey?: string[]; /** Adds a JSON field to Orders, which cannot be grouped. */ json?: boolean; /** Adds a calculated metric `margin` to Orders. */ calc?: boolean; /** Replaces the total row count of a read of Orders. */ total?: (o: TraverseOptions) => number | undefined; /** Reads that answer after this many ms. */ slow?: (o: TraverseOptions) => boolean } = {}) {
  const fixtures = structuredClone(demoFixtures());
  for (const m of fixtures.marts) if (opts.noKey?.includes(m.id)) for (const f of m.fields) f.isPrimaryKey = false;
  if (opts.calc) fixtures.marts.find((m) => m.id === 'orders')!.fields.push({ name: 'margin', type: 'NUMERIC', alias: 'Margin', calculated: { level: 'metric' } } as never);
  if (opts.json) fixtures.marts.find((m) => m.id === 'orders')!.fields.push({ name: 'tags', type: 'JSON', alias: 'Tags' } as never);
  const base = createMockCtx(fixtures, { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); if (id === 'orders' && opts.fail?.(o)) return Promise.reject(new Error('read failed')); const n = id === 'orders' ? opts.total?.(o) : undefined; const done = n !== undefined && o.includeTotalRowCount ? real(id, o).then((r) => ({ ...r, totalRowCount: n })) : real(id, o); return id === 'orders' && opts.slow?.(o) ? new Promise((res) => setTimeout(res, opts.slowMs ?? 250)).then(() => done) : done; } } },
  };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  const seeded = opts.charts ? ctx.collections<ChartSettings>(CHARTS_COLLECTION).put('orders', opts.charts) : Promise.resolve();
  const mount = async () => { await seeded; render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>); };
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
  const t = setup(withProducts, { charts: { scorecards: { hidden: ['amount', 'records:products'] } } });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

const havingGrid: GridState = {
  columns: ['status', 'amount'], filters: { ...paid, amount: { field: 'amount', op: 'gt', value: 1, fn: 'SUM' } },
  aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200,
};

test('a HAVING filter beside a filter: no badge in either view, and Table sends neither the keys read nor a scorecard read', async () => {
  const t = setup(havingGrid);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(badge('orders')).toBeNull();
  expect(t.scoreReads()).toHaveLength(0);
  expect(t.queries.filter((q) => q.limit === 501)).toHaveLength(0);
  // Charts read what they always read; the badge still has no number.
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.queries.filter((q) => q.limit === 501)).toHaveLength(1);
  expect(t.scoreReads()).toHaveLength(1);
  expect(badge('orders')).toBeNull();
});

test('only HAVING filters: no badge and no scorecard read in Table (nothing to count)', async () => {
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

test('a mart reached at two paths: each path\'s card shows its own number, on the Grid and on the Graph', async () => {
  const t = setup({ columns: ['id', 'status', 'customers__countries__name', 'stores__countries__name'], filters: few, sorts: null, limit: 200 });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  expect(t.scoreReads()[0]!.uniqueCount).toEqual(['', 'customers.countries', 'stores.countries']);
  await waitFor(() => expect(badge('countries', 'customers.countries')).toMatch(/^\d+% match$/));
  expect(badge('countries', 'stores.countries')).toMatch(/^\d+% match$/);
  await toGraph();
  await waitFor(() => expect(badge('countries', 'customers.countries')).toMatch(/^\d+% match$/));
  expect(badge('countries', 'stores.countries')).toMatch(/^\d+% match$/);
  expect(t.scoreReads()).toHaveLength(1);
});

test('Reset takes the filter off and the badges go with it', async () => {
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

test('no usable key on any mart: Table sends no scorecard read, since it would count nothing', async () => {
  const t = setup(withProducts, { noKey: ['orders', 'products'] });
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
  expect(badge('orders')).toBeNull();
  expect(badge('products', 'products')).toBeNull();
});

test('a main mart with no key and a joined mart with one: one read, a badge on the joined card only', async () => {
  const t = setup({ ...withProducts, filters: few }, { noKey: ['orders'] });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  expect(t.scoreReads()[0]!.uniqueCount).toEqual(['products']);
  await waitFor(() => expect(badge('products', 'products')).toMatch(/^\d+% match$/));
  expect(badge('orders')).toBeNull();
});

test('a main mart with no key and nothing joined still has its badge, from the grid total', async () => {
  const t = setup(mainOnly, { noKey: ['orders'] });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
});

test('a mart kept with no column joins the read only while a filter or a slice applies', async () => {
  const t = setup({ ...mainOnly, filters: {}, emptyPaths: ['products'], view: 'charts' });
  await t.mount();
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await waitFor(() => expect(t.scoreReads().length).toBeGreaterThan(0));
  await calm();
  expect(t.scoreReads().every((q) => !q.uniqueCount?.includes('products'))).toBe(true);
});

test('an incomplete filter and a parked one are no rule: no read, no badge', async () => {
  const t = setup({ ...withProducts, filters: { status: { field: 'status', op: 'eq' }, gone_field: { field: 'gone_field', op: 'eq', value: 'x' } } });
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
  expect(badge('orders')).toBeNull();
});

test('a filter edit sends one read and its Undo none (the earlier answer is kept)', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await openSubmenu(within(data()), 'status', 'Filter');
  const dialog = await screen.findByRole('dialog');
  const value = within(dialog).getByLabelText('Value');
  await userEvent.clear(value);
  await userEvent.type(value, 'refunded');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.scoreReads()).toHaveLength(2));
  await calm();
  expect(t.scoreReads()).toHaveLength(2);
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await calm();
  expect(t.scoreReads()).toHaveLength(2);
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
});

test('showing another number column, or changing a function, sends no second scorecard read in Table', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await openFields('Orders');
  await userEvent.click((await screen.findAllByLabelText(/^net revenue$/i))[0]!);
  await closeConfigMenu();
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => /net revenue/i.test(h.textContent ?? ''))).toBe(true));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Average'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => /Amount · Average/i.test(h.textContent ?? ''))).toBe(true));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('the main-only badge stays through Load more, with no scorecard read', async () => {
  const t = setup({ ...mainOnly, limit: 5 });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  const was = badge('orders');
  await userEvent.click(await within(data()).findByRole('button', { name: 'Load more' }));
  expect(badge('orders')).toBe(was);
  await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(6));
  expect(badge('orders')).toBe(was);
  expect(t.scoreReads()).toHaveLength(0);
});

test('a folded Data band reads no more and shows no badge; opening it again reads nothing new', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await userEvent.click(screen.getByRole('button', { name: 'Hide Data' }));
  await calm();
  expect(badge('orders')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Show Data' }));
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  expect(t.scoreReads()).toHaveLength(1);
});

test('a blocked grid (a JSON column with a function on another) reads nothing for the badge', async () => {
  const t = setup({ columns: ['id', 'status', 'amount', 'tags', 'products__price'], filters: paid, aggregations: [{ column: 'amount', function: 'SUM' }], sorts: null, limit: 200 }, { json: true });
  await t.mount();
  await waitFor(() => expect(data().textContent).toMatch(/can't be grouped/));
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
  expect(badge('orders')).toBeNull();
});

test('Refresh sends one new scorecard read', async () => {
  const t = setup(withProducts);
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(t.scoreReads()).toHaveLength(2));
  await calm();
  expect(t.scoreReads()).toHaveLength(2);
});

test('after the grid\'s own read failed, Table sends no scorecard read', async () => {
  const t = setup(mainOnly, { fail: (o) => o.limit === 201 });
  await t.mount();
  await waitFor(() => expect(within(data()).getByRole('alert')).toBeInTheDocument());
  await calm();
  await calm();
  expect(t.scoreReads()).toHaveLength(0);
});

test('showing another number column or hiding a calculated metric reads no count again', async () => {
  const t = setup({ ...withProducts, columns: ['id', 'status', 'amount', 'margin', 'products__price'] }, { calc: true });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await openFields('Orders');
  await userEvent.click((await screen.findAllByLabelText(/^net revenue$/i))[0]!);
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => /net revenue/i.test(h.textContent ?? ''))).toBe(true));
  await userEvent.click(await screen.findByLabelText('Margin'));
  await closeConfigMenu();
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => /margin/i.test(h.textContent ?? ''))).toBe(false));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('a keyed main mart alone with a calculated metric: hiding the metric reads the known count again no more', async () => {
  const t = setup({ ...mainOnly, columns: ['id', 'status', 'amount', 'margin'] }, { calc: true });
  await t.mount();
  await waitFor(() => expect(t.scoreReads()).toHaveLength(1));
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText('Margin'));
  await closeConfigMenu();
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => /margin/i.test(h.textContent ?? ''))).toBe(false));
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
  expect(badge('orders')).toMatch(/% match$/);
});

test('Charts with a filter, a HAVING filter and a mart kept with no column: the kept mart adds nothing to the read', async () => {
  const t = setup({ ...havingGrid, emptyPaths: ['products'], view: 'charts' });
  await t.mount();
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await waitFor(() => expect(t.scoreReads().length).toBeGreaterThan(0));
  await calm();
  expect(t.scoreReads().every((q) => !q.uniqueCount?.includes('products'))).toBe(true);
});

const twoJoined: GridState = { ...withProducts, columns: [...withProducts.columns, 'customers__city'] };
const alert = () => within(data()).getByRole('alert');
const retry = () => userEvent.click(within(alert()).getByRole('button', { name: 'Retry' }));

test('two joined marts, the grid and the score both fail: removing one sends no new score read, and clearing the error sends exactly one', async () => {
  let broken = true;
  const t = setup(twoJoined, { fail: (o) => broken && (o.limit === 201 || isScore(o)) });
  await t.mount();
  await waitFor(() => expect(alert()).toBeInTheDocument());
  await calm();
  const before = t.scoreReads().length;
  expect(before).toBeLessThanOrEqual(1);
  await openFields('Products');
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from report' }));
  await closeConfigMenu();
  await waitFor(() => expect(alert()).toBeInTheDocument());
  await calm();
  await calm();
  expect(t.scoreReads()).toHaveLength(before);
  broken = false;
  await retry();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await calm();
  expect(t.scoreReads()).toHaveLength(before + 1);
});

test('a slow score and a grid that fails first: one score read, the badge appears, and Charts adds none', async () => {
  const t = setup(withProducts, { fail: (o) => o.limit === 201, slow: isScore });
  await t.mount();
  await waitFor(() => expect(alert()).toBeInTheDocument());
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  expect(t.scoreReads()).toHaveLength(1);
  await userEvent.click(radio('Charts'));
  await waitFor(() => expect(data().querySelector('td[data-chart-group="orders"]')).not.toBeNull());
  await calm();
  expect(t.scoreReads()).toHaveLength(1);
});

test('a known badge survives a grid failure, and Retry adds no score read', async () => {
  let broken = false;
  const t = setup(withProducts, { fail: (o) => broken && o.limit === 201 });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  const known = badge('orders');
  expect(t.scoreReads()).toHaveLength(1);
  broken = true;
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by id,/ }));
  await waitFor(() => expect(alert()).toBeInTheDocument());
  await calm();
  expect(badge('orders')).toBe(known);
  expect(t.scoreReads()).toHaveLength(1);
  broken = false;
  await retry();
  await waitFor(rowsShown);
  await calm();
  expect(badge('orders')).toBe(known);
  expect(t.scoreReads()).toHaveLength(1);
});

test('the grid and the score both failed: Retry brings rows and sends exactly one more score read, and the badge appears', async () => {
  let broken = true;
  const t = setup(withProducts, { fail: (o) => broken && (o.limit === 201 || isScore(o)) });
  await t.mount();
  await waitFor(() => expect(alert()).toBeInTheDocument());
  await calm();
  const before = t.scoreReads().length;
  expect(before).toBeLessThanOrEqual(1);
  broken = false;
  await retry();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  await calm();
  expect(t.scoreReads()).toHaveLength(before + 1);
});

test('Remove from report: a total counted by a read that joined the removed mart is not the main mart\'s count', async () => {
  const t = setup(withProducts, { total: (o) => (o.column?.some((c) => c.startsWith('products__')) ? 400 : undefined) });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/^\d+% match$/));
  const before = badge('orders');
  await openFields('Products');
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from report' }));
  await closeConfigMenu();
  await calm();
  await calm();
  expect(badge('orders')).toMatch(/^\d+% match$/);
  expect(badge('orders')).toBe(before);
  // The joined read's count is not the main mart's: one scorecard read answers it.
  expect(t.scoreReads()).toHaveLength(2);
});

test('on Refresh the badge keeps its previous number, dimmed and busy, until the new count lands, and adds no read of its own', async () => {
  // The score read is held long enough that a slow runner still checks the dimmed badge before the count lands.
  const t = setup(withProducts, { slow: isScore, slowMs: 1500 });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/), { timeout: 4000 });
  const match = () => card('orders')!.querySelector('[data-match]');
  expect(match()).not.toHaveClass('dm-stale');
  expect(match()).not.toHaveAttribute('aria-busy');
  const before = t.scoreReads().length;
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(t.scoreReads().length).toBe(before + 1));
  expect(match()).toHaveClass('dm-stale');
  expect(match()).toHaveAttribute('aria-busy', 'true');
  await waitFor(() => expect(match()).not.toHaveClass('dm-stale'), { timeout: 4000 });
  expect(match()).toHaveTextContent(/% match$/);
  expect(t.scoreReads()).toHaveLength(before + 1);
});

/** Edits the status filter to another value through the column menu. */
async function changeStatus(value: string) {
  await openSubmenu(within(data()), 'status', 'Filter');
  const dialog = await screen.findByRole('dialog');
  const input = within(dialog).getByLabelText('Value');
  await userEvent.clear(input);
  await userEvent.type(input, value);
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
}

test('a filter change keeps the badge with the previous number, dimmed and busy, until the new count lands (no Refresh)', async () => {
  const t = setup(withProducts, { slow: isScore });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  const match = () => card('orders')!.querySelector('[data-match]');
  expect(match()).not.toHaveClass('dm-stale');
  const before = t.scoreReads().length;
  await changeStatus('shipped');
  await waitFor(() => expect(t.scoreReads().length).toBe(before + 1));
  expect(match()).toHaveClass('dm-stale');
  expect(match()).toHaveAttribute('aria-busy', 'true');
  await waitFor(() => expect(match()).not.toHaveClass('dm-stale'), { timeout: 2000 });
  expect(match()).not.toHaveAttribute('aria-busy');
  expect(t.scoreReads()).toHaveLength(before + 1);
});

const shippedRows = (q: TraverseOptions) => q.limit === 201 && JSON.stringify(q.filter ?? []).includes('shipped');

test('a rows read that fails while the score read still runs keeps the badge dimmed, with no vanish, until the score lands', async () => {
  const t = setup(withProducts, { fail: shippedRows, slow: isScore });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/));
  const match = () => card('orders')!.querySelector('[data-match]');
  await changeStatus('shipped');
  await waitFor(() => expect(t.queries.some(shippedRows)).toBe(true));
  await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
  expect(match()).not.toBeNull();
  expect(match()).toHaveClass('dm-stale');
  expect(match()).toHaveAttribute('aria-busy', 'true');
  await waitFor(() => expect(match()).not.toHaveClass('dm-stale'), { timeout: 2000 });
  expect(match()).not.toHaveAttribute('aria-busy');
});

test('a rows read that failed while the score read ran, then a column hidden (new score key held): no dimmed or busy badge is left and no read is added', async () => {
  const t = setup(withProducts, { fail: shippedRows, slow: isScore, slowMs: 1500 });
  await t.mount();
  await waitFor(() => expect(badge('orders')).toMatch(/% match$/), { timeout: 4000 });
  const match = () => card('orders')!.querySelector('[data-match]');
  await changeStatus('shipped');
  await waitFor(() => expect(t.queries.some(shippedRows)).toBe(true));
  await waitFor(() => expect(within(data()).queryByRole('progressbar', { name: 'Loading rows' })).toBeNull());
  const reads = t.scoreReads().length;
  await openFields('Orders');
  await userEvent.click(await screen.findByLabelText('Amount'));
  await calm();
  await act(async () => { await new Promise((r) => setTimeout(r, 1800)); });
  expect(match()?.classList.contains('dm-stale') ?? false).toBe(false);
  expect(match()?.hasAttribute('aria-busy') ?? false).toBe(false);
  expect(t.scoreReads().length).toBe(reads);
}, 20000);
