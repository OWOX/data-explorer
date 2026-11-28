import { StrictMode, useEffect, useState } from 'react';
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useFilteredCounts } from '../useFilteredCounts';
import { loadModel } from '../../api/model';
import { filteredKey } from '../../api/filtered-counts';
import type { CardRules, GridRules } from '../../filters/card-rules';
import type { Model } from '../../model/types';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, sourceOfModel, StoreProvider, useStore, type GridState } from '../../state/store';
import { DataBand } from '../bands/DataBand';
import { TooltipProvider } from '../Tooltip';

// Every traverseData call is a billed warehouse run: the cards count their own rules, the grid reads no scorecard for them.
async function setup(grid: GridState, opts: { calc?: boolean; noKey?: boolean; failGrid?: boolean; strict?: boolean; wired?: boolean } = {}) {
  const fixtures = structuredClone(demoFixtures());
  if (opts.calc) fixtures.marts.find((m) => m.id === 'orders')!.fields.push({ name: 'margin', type: 'NUMERIC', alias: 'Margin', calculated: { level: 'column' } } as never);
  if (opts.noKey) for (const f of fixtures.marts.find((m) => m.id === 'orders')!.fields) f.isPrimaryKey = false;
  const base = createMockCtx(fixtures, { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders') queries.push(o); if (opts.failGrid && id === 'orders' && !isCardRead(o) && o.filter?.length) return Promise.reject(new Error('grid read failed')); return real(id, o); } } } };
  const model: Model = await loadModel(ctx);
  const rules: (Map<string, CardRules> | null)[] = [];
  const spies = {
    onCardRules: (r: { martId: string; byPath: ReadonlyMap<string, CardRules> } | null) => { rules.push(r && new Map(r.byPath)); },
    onCount: vi.fn(), onFilteredTotal: vi.fn(), onForgetFiltered: vi.fn(), onCardHold: vi.fn(), onRecount: vi.fn(),
  };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'selectMart', id: 'orders', sourceOf: sourceOfModel(model) }); dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  // With `wired`, the band is joined to the real hook, as App does.
  const counts: { current: ReturnType<typeof useFilteredCounts> | null } = { current: null };
  function Wired() {
    const [rulesOf, setRules] = useState<{ martId: string; byPath: ReadonlyMap<string, GridRules> } | null>(null);
    const c = useFilteredCounts(model, rulesOf?.byPath ?? null);
    counts.current = c;
    return <DataBand model={model} folded={false} onFold={() => undefined} {...spies} onCardRules={(r) => { spies.onCardRules(r); setRules(r); }} onFilteredTotal={c.seed} onForgetFiltered={c.forget} />;
  }
  const band = opts.wired ? <Wired /> : <DataBand model={model} folded={false} onFold={() => undefined} {...spies} />;
  const tree = <AppServices ctx={ctx}><StoreProvider><TooltipProvider><Probe />{band}</TooltipProvider></StoreProvider></AppServices>;
  const mount = () => render(opts.strict ? <StrictMode>{tree}</StrictMode> : tree);
  // A card's own count: one row and its total for a mart with no key, `uniqueCount: ['']` alone (and the filter) for a mart with a key.
  const filteredReads = () => queries.filter((q) => isCardRead(q) && q.filter?.length);
  const total = async (filter?: TraverseOptions['filter']) => (await real('orders', { column: ['id'], limit: 1, includeTotalRowCount: true, ...(filter ? { filter } : {}) })).totalRowCount as number;
  return { queries, rules, spies, mount, counts, filteredReads, model, total, scoreReads: () => queries.filter((q) => q.uniqueCount?.length) };
}

const isCardRead = (q: TraverseOptions) =>
  (q.limit === 1 && !!q.includeTotalRowCount) || (q.uniqueCount?.length === 1 && q.uniqueCount[0] === '' && Object.keys(q).every((k) => k === 'uniqueCount' || k === 'filter'));
const data = () => document.getElementById('band-data')!;
const calm = () => act(async () => { await new Promise((r) => setTimeout(r, 120)); });
const rowsShown = () => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true);
const last = (t: { rules: (Map<string, CardRules> | null)[] }) => t.rules[t.rules.length - 1]!;

const plain: GridState = { columns: ['id', 'status', 'amount', 'created_at'], filters: {}, sorts: null, limit: 200 };
const paid = { status: { field: 'status', op: 'eq' as const, value: 'paid' } };

test('a filter on a main field sends the rule at path "" and reads no scorecard', async () => {
  const t = await setup({ ...plain, filters: paid });
  t.mount();
  await waitFor(rowsShown);
  await calm();
  expect([...last(t).keys()]).toEqual(['']);
  expect(last(t).get('')).toEqual({ martId: 'orders', rules: [expect.objectContaining({ column: 'status', operator: 'eq', value: 'paid' })], partial: false });
  expect(t.scoreReads()).toHaveLength(0);
});

test('a main filter with a calculated-field filter is partial, and the grid total goes to no card', async () => {
  const t = await setup({ ...plain, filters: { ...paid, margin: { field: 'margin', op: 'gt', value: 1 } } }, { calc: true, wired: true });
  t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(last(t).get('')).toEqual(expect.objectContaining({ partial: true }));
  expect(t.spies.onFilteredTotal).not.toHaveBeenCalled();
  expect(t.spies.onCount).not.toHaveBeenCalled();
  expect(t.filteredReads()).toHaveLength(0);
  expect(t.counts.current!.filtered.get('')).toEqual({ partial: true });
});

test('a slice on a joined field sends its path with the renamed column', async () => {
  const t = await setup({ columns: ['id', 'status', 'customers__city'], filters: {}, slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'PL' } }, sorts: null, limit: 200 });
  t.mount();
  await waitFor(rowsShown);
  const joined = [...last(t)].filter(([path]) => path !== '');
  expect(joined).toHaveLength(1);
  expect(joined[0]![1].martId).not.toBe('orders');
  expect(joined[0]![1].rules).toEqual([expect.objectContaining({ column: 'country_code', operator: 'eq', value: 'PL' })]);
  expect(joined[0]![1].rules[0]).not.toHaveProperty('placement');
});

test('a post-join rule on a joined field sends no entry, and the grid total goes to no card', async () => {
  const t = await setup({ ...plain, columns: [...plain.columns, 'products__price'], filters: { products__price: { field: 'products__price', op: 'gt', value: 0 } } });
  t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(last(t).size).toBe(0);
  expect(t.spies.onCount).not.toHaveBeenCalled();
  expect(t.spies.onFilteredTotal).not.toHaveBeenCalled();
});

test('a plain Table with a main filter gives its total to the filtered count, not to the unfiltered one', async () => {
  const t = await setup({ ...plain, filters: paid });
  t.mount();
  await waitFor(() => expect(t.spies.onFilteredTotal).toHaveBeenCalled());
  const rule = last(t).get('')!.rules;
  const [key, n] = t.spies.onFilteredTotal.mock.calls[0]!;
  expect(key).toBe(filteredKey('orders', rule, t.model.marts.get('orders')?.dataLastUpdatedAt ?? null));
  expect(n).toBe(await t.total(rule));
  expect(t.spies.onCount).not.toHaveBeenCalled();
});

test('a plain Table with a joined column shown and no rule gives its total to the card', async () => {
  const t = await setup({ ...plain, columns: [...plain.columns, 'products__price'] });
  t.mount();
  await waitFor(() => expect(t.spies.onCount).toHaveBeenCalled());
  expect(t.spies.onCount).toHaveBeenCalledWith('orders', await t.total(), true);
  expect(t.spies.onFilteredTotal).not.toHaveBeenCalled();
});

test('a main mart with no primary key gives its total to the card', async () => {
  const t = await setup(plain, { noKey: true });
  t.mount();
  await waitFor(() => expect(t.spies.onCount).toHaveBeenCalled());
  expect(t.spies.onCount).toHaveBeenCalledWith('orders', await t.total(), false);
});

test('Refresh with a main filter forgets the filtered counts and does not hold the card', async () => {
  const t = await setup({ ...plain, filters: paid });
  t.mount();
  await waitFor(() => expect(t.spies.onFilteredTotal).toHaveBeenCalled());
  await calm();
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  expect(t.spies.onForgetFiltered).toHaveBeenCalledWith('orders', true);
  expect(t.spies.onCardHold).not.toHaveBeenCalled();
});

test('told again only when the rules change, and null when the grid goes away', async () => {
  const t = await setup({ ...plain, filters: paid });
  const view = t.mount();
  await waitFor(rowsShown);
  await calm();
  const told = t.rules.length;
  expect(told).toBeGreaterThan(0);
  expect(t.rules.slice(0, told).every((r) => r !== null)).toBe(true);
  view.unmount();
  expect(t.rules[t.rules.length - 1]).toBeNull();
});

test('under StrictMode the last onCardRules call holds the rules, not null', async () => {
  const t = await setup({ ...plain, filters: paid }, { strict: true });
  t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(last(t)).not.toBeNull();
  expect([...last(t).keys()]).toEqual(['']);
});

const mainCard = (t: { counts: { current: ReturnType<typeof useFilteredCounts> | null } }) => t.counts.current?.filtered.get('')?.state;

test('a main filter in a plain Table sends the grid read alone, and the card takes the grid total', async () => {
  const t = await setup({ ...plain, filters: paid }, { wired: true });
  t.mount();
  await waitFor(() => expect(mainCard(t)).toEqual({ state: 'ok', value: expect.any(Number), unique: true }));
  await calm();
  expect(t.filteredReads()).toHaveLength(0);
  expect(t.queries.filter((q) => q.filter?.length && !isCardRead(q))).toHaveLength(1);
  expect((mainCard(t) as { value: number }).value).toBe(await t.total(last(t).get('')!.rules));
});

test('when the grid read fails, one count read follows', async () => {
  const t = await setup({ ...plain, filters: paid }, { wired: true, failGrid: true });
  t.mount();
  await waitFor(() => expect(t.filteredReads()).toHaveLength(1));
  await waitFor(() => expect(mainCard(t)).toEqual({ state: 'ok', value: expect.any(Number), unique: true }));
});

test('Refresh with a main filter in a plain Table sends no filtered count read, and the card ends ok', async () => {
  const t = await setup({ ...plain, filters: paid }, { wired: true });
  t.mount();
  await waitFor(() => expect(mainCard(t)).toEqual({ state: 'ok', value: expect.any(Number), unique: true }));
  await calm();
  const before = t.queries.length;
  await userEvent.click(within(data()).getByRole('button', { name: 'Refresh' }));
  await calm();
  await waitFor(() => expect(mainCard(t)).toEqual({ state: 'ok', value: expect.any(Number), unique: true }));
  expect(t.queries.slice(before).filter(isCardRead)).toHaveLength(0);
  expect(t.queries.slice(before).filter((q) => q.filter?.length && !isCardRead(q))).toHaveLength(1);
});
