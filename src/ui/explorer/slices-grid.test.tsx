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
  const everyChart = t.queries.filter((q) => q.limit !== 501 && !((q.limit === 1 && q.includeTotalRowCount && !q.filter) || (q.uniqueCount?.length === 1 && q.uniqueCount[0] === '' && Object.keys(q).length === 1)));
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

/** The badge in the toolbar by its name ("1 filter", "2 slices"). */
const badge = (name: RegExp | string) => screen.findByRole('button', { name });
/** Opens a badge's list. */
async function openList(name: RegExp | string, list: RegExp | string) {
  await userEvent.click(await badge(name));
  return screen.findByRole('menu', { name: list });
}

describe('the rule badges next to the config button', () => {
  // The status filter and the country slice are both on fields that are not columns.
  const hidden: GridState = { columns: ['id', 'customers__city'], filters: { status: { field: 'status', op: 'eq', value: 'paid' } }, slices: { customers__country_code: slice }, sorts: null, limit: 200 };

  test('the filter and slice badges sit beside the config button with their labels, and the title cell has none', async () => {
    setup(hidden);
    const filterBadge = await badge('1 filter');
    const sliceBadge = await badge('1 slice');
    const slot = data().querySelector<HTMLElement>('[data-chart-list-slot]')!;
    expect(slot).toContainElement(filterBadge);
    expect(slot).toContainElement(sliceBadge);
    expect(filterBadge).toHaveTextContent('1 filter');
    expect(filterBadge).toHaveAttribute('aria-haspopup', 'menu');
    expect(filterBadge).toHaveAttribute('aria-expanded', 'false');
    expect(within(slot).getByRole('button', { name: 'Configure data' }).compareDocumentPosition(filterBadge) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(data().querySelector('th[data-group-path] .dm-rule-badge')).toBeNull();
    expect(data().querySelector('th[data-group-path] [aria-haspopup]')).toBeNull();
  });

  test('a click lists one row per field as "mart · field", with the mart icon, then a separator and Remove filters', async () => {
    setup(hidden);
    const list = await openList('1 filter', 'Filters');
    expect(screen.getByRole('button', { name: '1 filter' })).toHaveAttribute('aria-expanded', 'true');
    const items = within(list).getAllByRole('menuitem');
    expect(items.map((i) => i.textContent)).toEqual(['Orders · status', 'Remove filters']);
    expect(items[0]!.nextElementSibling).toHaveAttribute('role', 'separator');
    expect(items[0]!.querySelector('.dm-menu-glyph svg')).not.toBeNull();
    expect(items[1]!.querySelector('.dm-menu-glyph svg')).not.toBeNull();
    // A row says no more than the field: the rule is read in the editor.
    expect(items[0]).not.toHaveTextContent('paid');
    // A press outside only closes a list, so the other badge is opened after it.
    await userEvent.keyboard('{Escape}');
    const slices = await openList('1 slice', 'Slices');
    expect(within(slices).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Customers · Country', 'Remove slices']);
  });

  test('hovering a badge shows its rules in a tooltip, one per line', async () => {
    setup({ ...hidden, filters: { status: hidden.filters.status!, customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' } } });
    await userEvent.hover(await badge('2 filters'));
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Orders · status: equals paid');
    expect(tip).toHaveTextContent('Customers · city: equals Kyiv');
    await userEvent.hover(await badge('1 slice'));
    await waitFor(() => expect(screen.getByRole('tooltip')).toHaveTextContent(/^Customers · Country: /));
  });

  test('the tooltip stays shut while the list is open, and focus handed back when it closes does not open it', async () => {
    setup(hidden);
    const list = await openList('1 filter', 'Filters');
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(within(list).getByRole('menuitem', { name: /status/ })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.getByRole('button', { name: '1 filter' })).toHaveFocus());
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole('tooltip')).toBeNull();
    // A pointer arriving later waits out the open delay, as on any hover (the click that opened the list left it on the badge).
    await userEvent.unhover(screen.getByRole('button', { name: '1 filter' }));
    await userEvent.hover(screen.getByRole('button', { name: '1 filter' }));
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Orders · status: equals paid');
    // Focus that later arrives from Tab opens it as before.
    await userEvent.unhover(screen.getByRole('button', { name: '1 filter' }));
    await userEvent.tab();
    await userEvent.tab({ shift: true });
    expect(screen.getByRole('button', { name: '1 filter' })).toHaveFocus();
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Orders · status');
  });

  test('Remove filters takes every filter in one Undo step, closes the list and focuses the next badge, else the config button', async () => {
    const t = setup({ ...hidden, filters: { status: hidden.filters.status!, customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' } } });
    const list = await openList('2 filters', 'Filters');
    expect(within(list).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders · status', 'Customers · city', 'Remove filters']);
    await userEvent.click(within(list).getByRole('menuitem', { name: 'Remove filters' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters).toEqual({}));
    expect(t.state.current!.grids['orders']?.slices?.customers__country_code).toBeDefined();
    expect(screen.queryByRole('menu', { name: 'Filters' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(within(data()).getByRole('button', { name: '1 slice' })));
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.keys(t.state.current!.grids['orders']?.filters ?? {}).sort()).toEqual(['customers__city', 'status']));
    // With no badge left, focus goes to the config button.
    await userEvent.click(within(data()).getByRole('button', { name: '1 slice' }));
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Slices' })).getByRole('menuitem', { name: 'Remove slices' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices ?? {}).toEqual({}));
    await userEvent.click(within(data()).getByRole('button', { name: '2 filters' }));
    await userEvent.click(within(await screen.findByRole('menu', { name: 'Filters' })).getByRole('menuitem', { name: 'Remove filters' }));
    await waitFor(() => expect(document.activeElement).toBe(within(data()).getByRole('button', { name: 'Configure data' })));
    expect(within(data()).queryByRole('button', { name: /^\d+ (filter|slice|aggregation)s?$/ })).toBeNull();
  });

  test('hovering a row opens the filter editor, and Apply saves the rule, closes the list and focuses the badge', async () => {
    const t = setup(hidden);
    const list = await openList('1 filter', 'Filters');
    await userEvent.hover(within(list).getByRole('menuitem', { name: /status/ }));
    const form = await screen.findByRole('dialog', { name: /^Filter of / });
    const input = within(form).getByDisplayValue('paid');
    await userEvent.clear(input);
    await userEvent.type(input, 'refunded');
    await userEvent.click(within(form).getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters.status?.value).toBe('refunded'));
    expect(screen.queryByRole('menu', { name: 'Filters' })).toBeNull();
    expect(screen.getByRole('button', { name: '1 filter' })).toHaveFocus();
  });

  test('a slice row opens the slice editor, and Clear in the form removes that one rule', async () => {
    const t = setup(hidden);
    const list = await openList('1 slice', 'Slices');
    await userEvent.hover(within(list).getByRole('menuitem', { name: /Country/ }));
    const form = await screen.findByRole('dialog', { name: /^Slice of / });
    expect(within(form).getByDisplayValue('PL')).toBeVisible();
    await userEvent.click(within(form).getByRole('button', { name: 'Clear' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices?.customers__country_code).toBeUndefined());
    expect(screen.queryByRole('menu', { name: 'Slices' })).toBeNull();
    expect(screen.getByRole('button', { name: '1 filter' })).toBeVisible();
  });

  test('a list open while its last rule goes (Undo) closes and stays closed when Redo brings the badge back', async () => {
    const t = setup(hidden);
    await userEvent.click(await openList('1 filter', 'Filters').then((l) => within(l).getByRole('menuitem', { name: 'Remove filters' })));
    await waitFor(() => expect(screen.queryByRole('button', { name: '1 filter' })).toBeNull());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await userEvent.click(await badge('1 filter'));
    await screen.findByRole('menu', { name: 'Filters' });
    act(() => t.send.current!({ type: 'redo', known: () => true }));
    await waitFor(() => expect(screen.queryByRole('button', { name: '1 filter' })).toBeNull());
    act(() => t.send.current!({ type: 'undo', known: () => true }));
    const back = await badge('1 filter');
    expect(back).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu', { name: 'Filters' })).toBeNull();
  });

  test('Escape closes the editor first, then the list, and focus returns to the badge', async () => {
    setup(hidden);
    const list = await openList('1 filter', 'Filters');
    await userEvent.hover(within(list).getByRole('menuitem', { name: /status/ }));
    await screen.findByRole('dialog', { name: /^Filter of / });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Filter of / })).toBeNull());
    expect(screen.getByRole('menu', { name: 'Filters' })).toBeVisible();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Filters' })).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: '1 filter' })).toHaveFocus());
  });

  test('the keyboard opens the list on the field row, Arrow Down reaches Remove, Arrow Right on the field opens its editor', async () => {
    setup(hidden);
    (await badge('1 filter')).focus();
    await userEvent.keyboard('{Enter}');
    const list = await screen.findByRole('menu', { name: 'Filters' });
    expect(within(list).getByRole('menuitem', { name: /status/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowDown}');
    expect(within(list).getByRole('menuitem', { name: 'Remove filters' })).toHaveFocus();
    await userEvent.keyboard('{ArrowUp}');
    expect(within(list).getByRole('menuitem', { name: /status/ })).toHaveFocus();
    await userEvent.keyboard('{ArrowRight}');
    await screen.findByRole('dialog', { name: /^Filter of / });
  });

  test('Enter on the Remove row removes the rules', async () => {
    const t = setup(hidden);
    (await badge('1 filter')).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('menuitem', { name: /status/ })).toHaveFocus());
    await userEvent.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Remove filters' })).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters).toEqual({}));
    expect(screen.queryByRole('menu', { name: 'Filters' })).toBeNull();
  });

  test('Remove slices is one Undo step, and Redo takes the slices off again', async () => {
    const two: GridState = { columns: ['id', 'customers__city'], filters: {}, slices: { customers__country_code: slice, customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' } }, sorts: null, limit: 200 };
    const t = setup(two);
    const list = await openList('2 slices', 'Slices');
    await userEvent.click(within(list).getByRole('menuitem', { name: 'Remove slices' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices).toBeUndefined());
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(Object.keys(t.state.current!.grids['orders']?.slices ?? {}).sort()).toEqual(['customers__city', 'customers__country_code']));
    await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices).toBeUndefined());
  });

  test('Remove aggregations leaves a Unique Count alone', async () => {
    const t = setup({ ...having, uniqueCount: [''] });
    await userEvent.click(within(await openList('1 aggregation', 'Aggregations')).getByRole('menuitem', { name: 'Remove aggregations' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.aggregations).toBeUndefined());
    expect(t.state.current!.grids['orders']?.uniqueCount).toEqual(['']);
  });

  test('hovering Remove closes an open edit form, and a half-typed edit is not applied by Remove', async () => {
    const t = setup(hidden);
    const list = await openList('1 filter', 'Filters');
    await userEvent.hover(within(list).getByRole('menuitem', { name: /status/ }));
    await screen.findByRole('dialog', { name: /^Filter of / });
    await userEvent.hover(within(list).getByRole('menuitem', { name: 'Remove filters' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /^Filter of / })).toBeNull());
    await userEvent.hover(within(list).getByRole('menuitem', { name: /status/ }));
    const input = within(await screen.findByRole('dialog', { name: /^Filter of / })).getByDisplayValue('paid');
    await userEvent.type(input, 'xyz');
    await userEvent.click(within(list).getByRole('menuitem', { name: 'Remove filters' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters.status).toBeUndefined());
    await new Promise((r) => setTimeout(r, 300));
    expect(t.state.current!.grids['orders']?.filters.status).toBeUndefined();
  });

  test('a HAVING filter counts as a filter, and Remove filters takes it too', async () => {
    const t = setup(having);
    const list = await openList('1 filter', 'Filters');
    expect(within(list).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders · Net Revenue', 'Remove filters']);
    await userEvent.click(within(list).getByRole('menuitem', { name: 'Remove filters' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.filters).toEqual({}));
    expect(t.state.current!.grids['orders']?.aggregations).toEqual([{ column: 'net_revenue', function: 'SUM' }]);
  });

  test('aggregations: the badge counts fields, a row opens the aggregation editor, and Remove aggregations drops the HAVING filters on them in one step', async () => {
    const t = setup(having);
    const list = await openList('1 aggregation', 'Aggregations');
    expect(within(list).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders · Net Revenue', 'Remove aggregations']);
    await userEvent.hover(within(list).getByRole('menuitem', { name: /Net Revenue/ }));
    await screen.findByRole('dialog', { name: /^Aggregation of / });
    await userEvent.hover(within(list).getByRole('menuitem', { name: 'Remove aggregations' }));
    await userEvent.click(within(list).getByRole('menuitem', { name: 'Remove aggregations' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.aggregations).toBeUndefined());
    expect(t.state.current!.grids['orders']?.filters).toEqual({});
    expect(screen.queryByRole('menu', { name: 'Aggregations' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(t.state.current!.grids['orders']?.aggregations).toEqual([{ column: 'net_revenue', function: 'SUM' }]));
    expect(t.state.current!.grids['orders']?.filters.net_revenue?.fn).toBe('SUM');
  });

  test('a mart kept with no column lists its slice', async () => {
    // Customers is in the report with no column (emptyPaths) and holds a slice; Orders holds a filter.
    setup({ columns: ['id', 'status'], filters: { status: { field: 'status', op: 'eq', value: 'paid' } }, slices: { customers__country_code: slice }, sorts: null, limit: 200, emptyPaths: ['customers'] });
    const slices = await openList('1 slice', 'Slices');
    expect(within(slices).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Customers · Country', 'Remove slices']);
  });

  test('a leftover rule on a joined mart that is not in the report is listed after the report\'s marts', async () => {
    setup({ columns: ['id', 'status'], filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' }, status: { field: 'status', op: 'eq', value: 'paid' } }, sorts: null, limit: 200 });
    const list = await openList('2 filters', 'Filters');
    expect(within(list).getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders · status', 'Customers · city', 'Remove filters']);
  });

  test('a rule on a field the grid does not offer (parked) is counted and listed by its name, and Remove takes it', async () => {
    const t = setup(sliced, { blendFails: true });
    const list = await openList('1 slice', 'Slices');
    const rows = within(list).getAllByRole('menuitem');
    expect(rows.map((i) => i.textContent)).toEqual(['customers__country_code', 'Remove slices']);
    expect(rows[0]).not.toHaveAttribute('aria-haspopup');
    await userEvent.click(rows[1]!);
    await waitFor(() => expect(t.state.current!.grids['orders']?.slices).toBeUndefined());
  });

  test('Charts has the same badges next to its config button', async () => {
    setup({ ...hidden, view: 'charts' });
    expect(await badge('1 filter')).toBeVisible();
    expect(await badge('1 slice')).toBeVisible();
  });

  test('the config menu marks the data marts whose fields carry a rule, in their description', async () => {
    setup(hidden);
    await badge('1 filter');
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    const menu = await screen.findByRole('menu', { name: 'Configure data' });
    expect(within(menu).getByRole('menuitem', { name: 'Orders' }).getAttribute('aria-description')).toContain('Filtered');
    expect(within(menu).getByRole('menuitem', { name: 'Customers' }).getAttribute('aria-description')).toContain('Sliced');
  });

  test('the config menu marks a mart kept with no column with its filter and slice', async () => {
    setup({ columns: ['id', 'status'], filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' } }, slices: { customers__country_code: slice }, sorts: null, limit: 200, emptyPaths: ['customers'] });
    await badge('1 slice');
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    const menu = await screen.findByRole('menu', { name: 'Configure data' });
    const kept = within(menu).getByRole('menuitem', { name: 'Customers' });
    expect(kept.getAttribute('aria-description')).toContain('Filtered. Sliced');
    expect(within(menu).getByRole('menuitem', { name: 'Orders' }).getAttribute('aria-description') ?? '').not.toMatch(/Filtered|Sliced/);
  });

  test('a joinable mart (not in the report) with a leftover rule is marked in its parent\'s panel', async () => {
    setup({ columns: ['id', 'status'], filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'Kyiv' } }, sorts: null, limit: 200 });
    await badge('1 filter');
    await userEvent.click(screen.getByRole('button', { name: 'Configure data' }));
    const menu = await screen.findByRole('menu', { name: 'Configure data' });
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Orders' }));
    const panel = await screen.findByRole('dialog', { name: 'Orders' });
    expect(within(panel).getByRole('menuitem', { name: 'Customers' }).getAttribute('aria-description')).toContain('Filtered');
  });

  test('no rules, no badges; the config button shows no tooltip', async () => {
    setup({ columns: ['id', 'status'], filters: {}, sorts: null, limit: 200 });
    const button = await screen.findByRole('button', { name: 'Configure data' });
    expect(screen.queryByRole('button', { name: /^\d+ (filter|slice|aggregation)s?$/ })).toBeNull();
    await userEvent.hover(button);
    await new Promise((r) => setTimeout(r, 350));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  test('the (i) description hint of the data mart sits right after its title, and the title cell holds no badge', async () => {
    setup(hidden);
    const group = await waitFor(() => { const g = document.querySelector<HTMLElement>('th[data-group-path=""]'); if (!g) throw new Error('no group'); return g; });
    const hint = within(group).getByRole('note', { name: /^About / });
    expect(hint.parentElement).toHaveClass('dm-reveal');
    expect(within(group).queryByRole('button', { name: /filter|slice/ })).toBeNull();
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
