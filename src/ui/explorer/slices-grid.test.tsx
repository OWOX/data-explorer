import { useEffect } from 'react';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from './menu-test-utils';

type Mock = ReturnType<typeof createMockCtx>;

function setup(grid: GridState, opts: { blendFails?: boolean; empty?: boolean; calculated?: boolean } = {}) {
  let failing = !!opts.blendFails;
  const fixtures = demoFixtures();
  // A calculated field of Orders (no warehouse column; the mock reads it as null).
  if (opts.calculated) {
    const orders = fixtures.marts.find((m) => m.id === 'orders')!;
    orders.fields = [...orders.fields, { name: 'margin', type: 'NUMERIC', alias: 'Margin', calculated: { level: 'metric' } }];
  }
  const base = createMockCtx(fixtures, { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const realGet = base.owox.getJson.bind(base.owox);
  const ctx: Ctx = {
    ...base,
    owox: {
      ...base.owox,
      dataMarts: { ...base.owox.dataMarts, traverseData: async (id, o) => { if (id === 'orders') queries.push(o); const t = await real(id, o); return opts.empty ? { ...t, rowChunks: async function* () {} } : t; } },
      getJson: (<T,>(path: string, query?: Record<string, string>) => (path.endsWith('/blendable-schema') && failing ? Promise.reject(new Error('blendable boom')) : realGet<T>(path, query))) as Mock['owox']['getJson'],
    },
  };
  const state: { current: ReturnType<typeof useStore>[0] | null } = { current: null };
  const send: { current: ReturnType<typeof useStore>[1] | null } = { current: null };
  function Probe() {
    const [s, dispatch] = useStore();
    state.current = s;
    send.current = dispatch;
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries, state, send, heal: () => { failing = false; } };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const slice = { field: 'customers__country_code', op: 'eq' as const, value: 'PL' };
const sliced: GridState = { columns: ['id', 'status', 'customers__city'], filters: {}, slices: { customers__country_code: slice }, sorts: null, limit: 200 };
// Two group keys: the charts cannot follow its HAVING filter exactly.
const havingTwoKeys: GridState = { ...({} as GridState), columns: ['id', 'status', 'net_revenue'], filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: 100, fn: 'SUM' } }, aggregations: [{ column: 'net_revenue', function: 'SUM' }], sorts: null, limit: 200 };
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

test('a parked slice comes back when its field is offered again, and is sent', async () => {
  const t = setup(sliced, { blendFails: true });
  await waitFor(() => expect(headers()).toEqual(['id', 'status']));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  expect(t.queries.every((q) => !q.filter)).toBe(true);
  t.heal();
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(t.queries.some((q) => q.filter?.some((f) => f.placement === 'pre-join'))).toBe(true));
  expect(t.state.current!.grids.orders!.slices).toEqual({ customers__country_code: slice });
});

test('with two group keys the charts get no HAVING filter and say they cannot apply it', async () => {
  const t = setup({ ...havingTwoKeys, view: 'charts' });
  await waitFor(() => expect(data().querySelector('[data-chart-strip]')).not.toBeNull(), { timeout: 3000 });
  expect(await within(data()).findByText("Charts can't apply filters on aggregates for this grouping.")).toBeInTheDocument();
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  expect(t.queries.every((q) => !q.filter?.some((f) => f.function))).toBe(true);
});

test('no note under the charts without a HAVING filter', async () => {
  setup({ columns: ['id', 'status', 'amount'], filters: {}, sorts: null, limit: 200, view: 'charts' });
  await waitFor(() => expect(data().querySelector('[data-chart-strip]')).not.toBeNull());
  expect(within(data()).queryByText("Charts can't apply filters on aggregates for this grouping.")).toBeNull();
});

test('the charts of an empty mart with only a HAVING filter say the mart has no rows, not that the filters match none', async () => {
  setup({ ...havingTwoKeys, view: 'charts' }, { empty: true });
  expect((await screen.findAllByText('This data mart has no rows.', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
  expect(within(data()).queryByText('No rows match the filters.')).toBeNull();
});

test('the charts of an empty mart with a plain filter say no rows match the filters', async () => {
  setup({ columns: ['id', 'status', 'amount'], filters: { status: { field: 'status', op: 'eq', value: 'zzz' } }, sorts: null, limit: 200, view: 'charts' }, { empty: true });
  expect((await screen.findAllByText('No rows match the filters.', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
});

// The expected numbers come from the mock's own rows: a group passes when its SUM is over the cut, and the charts roll up every row of the passing groups.
async function passing() {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const t = await base.owox.dataMarts.traverseData('orders', { column: ['status', 'net_revenue'] });
  const rows: { status: string; net_revenue: number }[] = [];
  for await (const chunk of t.rowChunks()) rows.push(...(chunk as typeof rows));
  const sums = new Map<string, number>();
  for (const r of rows) sums.set(r.status, (sums.get(r.status) ?? 0) + Number(r.net_revenue));
  const ordered = [...sums.values()].sort((a, b) => a - b);
  const cut = (ordered[0]! + ordered[ordered.length - 1]!) / 2;
  const keys = [...sums].filter(([, v]) => v > cut).map(([k]) => k);
  return { cut, keys, total: rows.filter((r) => keys.includes(r.status)).reduce((n, r) => n + Number(r.net_revenue), 0), all: rows.reduce((n, r) => n + Number(r.net_revenue), 0) };
}

test('the charts get the passing group keys as an in rule, and the scorecard totals only those groups', async () => {
  const exp = await passing();
  expect(exp.keys.length).toBeGreaterThan(0);
  expect(exp.total).not.toBeCloseTo(exp.all);
  const t = setup({ ...having, filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: exp.cut, fn: 'SUM' } }, aggregations: [{ column: 'net_revenue', function: 'SUM' }], view: 'charts' });
  await waitFor(() => expect(data().querySelector('[data-card="net_revenue"] [data-card-value]')).not.toBeNull(), { timeout: 3000 });
  const card = () => data().querySelector<HTMLElement>('[data-card="net_revenue"] [data-card-value]')!;
  const shown = () => Number((card().getAttribute('data-exact') ?? card().textContent ?? '').replace(/[^0-9.-]/g, ''));
  await waitFor(() => expect(shown()).toBeCloseTo(exp.total, 0));
  // The queries of this grid's charts: they aggregate net_revenue. (The mart's row counter, a bare unique count from src/api/row-counts.ts, is not a chart query.)
  const charted = t.queries.filter((q) => q.aggregation?.some((a) => a.column === 'net_revenue') && q.limit !== 501);
  // The one read that does carry the HAVING rule is the keys read (limit 501); no chart query has it.
  expect(charted.every((q) => !q.filter?.some((f) => f.function))).toBe(true);
  expect(t.queries.filter((q) => q.limit === 501)).toHaveLength(1);
  expect(charted.length).toBeGreaterThan(0);
  const everyChart = t.queries.filter((q) => q.limit !== 501 && !(q.uniqueCount?.length === 1 && q.uniqueCount[0] === '' && !q.column));
  expect(everyChart.every((q) => q.filter?.some((f) => f.column === 'status' && f.operator === 'in')) ).toBe(true);
  expect(charted.every((q) => q.filter?.some((f) => f.column === 'status' && f.operator === 'in' && JSON.stringify([...(f.value as string[])].sort()) === JSON.stringify([...exp.keys].sort())))).toBe(true);
  expect(within(data()).queryByText(/Charts can.t apply/)).toBeNull();
});

test('no group passes the HAVING filter: the charts say no rows match the filters', async () => {
  setup({ ...having, filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: 1e12, fn: 'SUM' } }, view: 'charts' });
  expect((await screen.findAllByText('No rows match the filters.', {}, { timeout: 3000 })).length).toBeGreaterThan(0);
});

test('the sparkline buckets only the rows of the passing groups', async () => {
  const exp = await passing();
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const t0 = await base.owox.dataMarts.traverseData('orders', { column: ['status', 'net_revenue', 'created_at'] });
  const all: { status: string; net_revenue: number; created_at: string }[] = [];
  for await (const chunk of t0.rowChunks()) all.push(...(chunk as typeof all));
  setup({
    columns: ['status', 'created_at', 'net_revenue'], filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: exp.cut, fn: 'SUM' } },
    aggregations: [{ column: 'net_revenue', function: 'SUM' }, { column: 'created_at', function: 'MIN' }], sorts: null, limit: 200, view: 'charts',
  });
  const table = () => [...data().querySelectorAll('[data-card="net_revenue"] .dm-sparkline table tbody tr')].map((tr) => [...tr.children].map((c) => c.textContent ?? ''));
  await waitFor(() => expect(table().length).toBeGreaterThan(0), { timeout: 5000 });
  const values = () => table().map(([, v]) => Number(v!.replace(/[^0-9.-]/g, '')));
  const sum = (xs: number[]) => xs.reduce((n, x) => n + x, 0);
  // Every bucket holds passing rows only, so the buckets add up to the passing total and not to the whole mart.
  expect(sum(values())).toBeCloseTo(exp.total, 0);
  expect(sum(values())).not.toBeCloseTo(exp.all, 0);
  // Bucket by bucket: the chart's bucket (a day, a week or a month) is not fixed here, so the rows are bucketed by each unit and one of them must match.
  const mine = all.filter((x) => exp.keys.includes(x.status));
  const by = (cut: (iso: string) => string) => { const m = new Map<string, number>(); for (const r of mine) m.set(cut(r.created_at), (m.get(cut(r.created_at)) ?? 0) + Number(r.net_revenue)); return [...m.values()].map((v) => Math.round(v * 100)).sort((a, b) => a - b); };
  const got = values().map((v) => Math.round(v * 100)).sort((a, b) => a - b);
  const week = (iso: string) => { const d = new Date(iso.slice(0, 10) + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
  expect([by((i) => i.slice(0, 10)), by(week), by((i) => i.slice(0, 7))]).toContainEqual(got);
});

describe('the data mart title row', () => {
  // The status filter and the country slice are both on fields that are not columns.
  const hidden: GridState = { columns: ['id', 'customers__city'], filters: { status: { field: 'status', op: 'eq', value: 'paid' } }, slices: { customers__country_code: slice }, sorts: null, limit: 200 };

  test('the slice and filter badges follow the Fields button, list the rules on click, and their x removes them in one Undo step', async () => {
    setup(hidden);
    const groupOf = (el: HTMLElement) => el.closest<HTMLElement>('th[data-group-path]')!;
    // The filter is on the main mart's field, the slice on the joined mart's: each badge sits in its own mart's title cell, after the Fields button.
    const filterBadge = await screen.findByRole('button', { name: /^1 filter in / });
    const sliceBadge = await screen.findByRole('button', { name: /^1 slice in / });
    expect(filterBadge).toHaveTextContent('1 filter');
    expect(sliceBadge).toHaveTextContent('1 slice');
    for (const badge of [filterBadge, sliceBadge]) {
      const fields = within(groupOf(badge)).getByRole('button', { name: /^Fields of / });
      expect(fields.compareDocumentPosition(badge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    await userEvent.click(filterBadge);
    const list = await screen.findByRole('menu', { name: /^Filters in / });
    expect(within(list).getByRole('menuitem', { name: /paid/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: /^Filters in / })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /^Remove all filters in / }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^1 filter in / })).toBeNull());
    expect(screen.getByRole('button', { name: /^1 slice in / })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: /^Remove all slices in / }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^1 slice in / })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByRole('button', { name: /^1 slice in / })).toBeVisible();
  });

  test('a click on a rule badge lists its fields; hovering a row opens the edit form, and Apply saves the rule', async () => {
    const t = setup(hidden);
    await userEvent.click(await screen.findByRole('button', { name: /^1 filter in / }));
    const list = await screen.findByRole('menu', { name: /^Filters in / });
    await userEvent.hover(within(list).getByRole('menuitem', { name: /paid/ }));
    const form = await screen.findByRole('dialog', { name: /^Filter of / });
    const input = within(form).getByDisplayValue('paid');
    await userEvent.clear(input);
    await userEvent.type(input, 'refunded');
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters.status?.value).toBe('refunded'));
    expect(screen.queryByRole('menu', { name: /^Filters in / })).toBeNull();
    expect(screen.getByRole('button', { name: /^1 filter in / })).toHaveFocus();
  });

  test('the slice badge list edits a slice the same way, and Clear in the form removes that one rule', async () => {
    const t = setup(hidden);
    await userEvent.click(await screen.findByRole('button', { name: /^1 slice in / }));
    const list = await screen.findByRole('menu', { name: /^Slices in / });
    await userEvent.hover(within(list).getByRole('menuitem'));
    const form = await screen.findByRole('dialog', { name: /^Slice of / });
    expect(within(form).getByDisplayValue('PL')).toBeVisible();
    await userEvent.click(within(form).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices?.customers__country_code).toBeUndefined());
    expect(screen.queryByRole('menu', { name: /^Slices in / })).toBeNull();
    // The filter badge is untouched.
    expect(screen.getByRole('button', { name: /^1 filter in / })).toBeVisible();
  });

  test('a list open while its last rule goes (Undo) stays closed when Redo brings the badge back', async () => {
    const t = setup(hidden);
    // A click on Undo or Redo is blocked while a list is open, so the step comes from outside it (as a shortcut or another view would).
    await userEvent.click(await screen.findByRole('button', { name: /^Remove all filters in / }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^1 filter in / })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(await screen.findByRole('button', { name: /^1 filter in / }));
    await screen.findByRole('menu', { name: /^Filters in / });
    act(() => t.send.current!({ type: 'redo' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^1 filter in / })).toBeNull());
    act(() => t.send.current!({ type: 'undo' }));
    const back = await screen.findByRole('button', { name: /^1 filter in / });
    expect(back).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu', { name: /^Filters in / })).toBeNull();
  });

  test('Escape closes the edit form first, then the list', async () => {
    setup(hidden);
    await userEvent.click(await screen.findByRole('button', { name: /^1 filter in / }));
    const list = await screen.findByRole('menu', { name: /^Filters in / });
    await userEvent.hover(within(list).getByRole('menuitem', { name: /paid/ }));
    await screen.findByRole('dialog', { name: /^Filter of / });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Filter of / })).toBeNull());
    expect(screen.getByRole('menu', { name: /^Filters in / })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: /^Filters in / })).toBeNull();
  });

  test('after the x on a badge, focus is on the Fields button of its cell', async () => {
    setup(hidden);
    const badge = await screen.findByRole('button', { name: /^1 filter in / });
    const cell = badge.closest('th')!;
    await userEvent.click(screen.getByRole('button', { name: /^Remove all filters in / }));
    await waitFor(() => expect(document.activeElement).toBe(within(cell).getByRole('button', { name: /^Fields of / })));
  });

  test('no rules, no marks; the Fields button shows no tooltip', async () => {
    setup({ columns: ['id', 'status'], filters: {}, sorts: null, limit: 200 });
    const button = (await screen.findAllByRole('button', { name: /^Fields of / }))[0]!;
    expect(screen.queryByRole('button', { name: /^\d+ (filter|slice)s? in / })).toBeNull();
    await userEvent.hover(button);
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('the (i) description hint of the data mart sits right after its title, before the rule badges, and shows with hover or focus only', async () => {
    setup(hidden);
    const group = await waitFor(() => { const g = document.querySelector<HTMLElement>('th[data-group-path=""]'); if (!g) throw new Error('no group'); return g; });
    const hint = within(group).getByRole('note', { name: /^About / });
    expect(hint.parentElement).toHaveClass('dm-reveal');
    // It sits right after the title, before the rule badges.
    const mark = await within(group).findByRole('button', { name: /^1 filter in / });
    expect(hint.compareDocumentPosition(mark) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('the total row count asks again after a hide only when OWOX would count another result', () => {
  const grid = (extra: Partial<GridState>): GridState => ({ columns: ['id', 'status', 'amount'], filters: {}, slices: {}, sorts: null, limit: 200, ...extra });
  /** Hide Status, press Load more, and return the options of the read that followed. */
  async function hideThenLoadMore(t: ReturnType<typeof setup>) {
    await waitFor(() => expect(within(data()).getByRole('button', { name: 'Load more' })).toBeEnabled());
    await waitFor(() => expect(headers().some((h) => h?.startsWith('status'))).toBe(true));
    const first = t.queries.length;
    expect(t.queries[first - 1]!.includeTotalRowCount).toBe(true);
    await userEvent.click(within(await openColumnMenu(within(data()), 'status')).getByRole('menuitem', { name: 'Hide column' }));
    await waitFor(() => expect(headers().some((h) => h?.startsWith('status'))).toBe(false));
    expect(t.queries).toHaveLength(first); // hiding alone reads nothing
    await userEvent.click(within(data()).getByRole('button', { name: 'Load more' }));
    await waitFor(() => expect(t.queries).toHaveLength(first + 1));
    return t.queries[first]!;
  }

  test('with a calculated field among the columns, Load more after a hide asks', async () => {
    const q = await hideThenLoadMore(setup(grid({ columns: ['id', 'status', 'margin'] }), { calculated: true }));
    expect(q.includeTotalRowCount).toBe(true);
  });

  test('with a calculated field only in a filter, Load more after a hide asks', async () => {
    const q = await hideThenLoadMore(setup(grid({ filters: { margin: { field: 'margin', op: 'is_blank', value: '' } } }), { calculated: true }));
    expect(q.filter?.some((f) => f.column === 'margin')).toBe(true);
    expect(q.includeTotalRowCount).toBe(true);
  });

  test('without a calculated field, Load more after a hide does not ask', async () => {
    const q = await hideThenLoadMore(setup(grid({}), { calculated: true }));
    expect(q.includeTotalRowCount).toBeUndefined();
  });
});

test('the calculated field of the tests above is not left in the shared fixtures', () => {
  setup({ columns: ['id', 'status', 'margin'], filters: {}, slices: {}, sorts: null, limit: 200 }, { calculated: true });
  expect(demoFixtures().marts.find((m) => m.id === 'orders')!.fields.map((x) => x.name)).not.toContain('margin');
});
