import { useEffect } from 'react';
import { act, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';

// Every traverseData call is a billed warehouse run. The card's own count is `{ uniqueCount: [''] }` and nothing else.
const isCardCount = (q: TraverseOptions) => Object.keys(q).length === 1 && q.uniqueCount?.length === 1 && q.uniqueCount[0] === '';

function setup(grid: GridState, opts: { noKey?: boolean; calc?: boolean } = {}) {
  const fixtures = structuredClone(demoFixtures());
  if (opts.noKey) for (const f of fixtures.marts.find((m) => m.id === 'orders')!.fields) f.isPrimaryKey = false;
  if (opts.calc) fixtures.marts.find((m) => m.id === 'orders')!.fields.push({ name: 'margin', type: 'NUMERIC', alias: 'Margin', calculated: { level: 'metric' } } as never);
  const base = createMockCtx(fixtures, { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const state = { total: 123 };
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => {
      if (id === 'orders') queries.push(o);
      return id === 'orders' && o.includeTotalRowCount ? real(id, o).then((r) => ({ ...r, totalRowCount: state.total })) : real(id, o);
    } } },
  };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  const mount = async () => { render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>); };
  return { queries, state, mount, countReads: () => queries.filter(isCardCount) };
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

test.each([
  ['a filter', filtered, {}],
  ['a joined column', { ...plain, columns: [...plain.columns, 'products__price'] }, {}],
  ['a calculated column', { ...plain, columns: [...plain.columns, 'margin'] }, { calc: true }],
  ['a Unique Count column', { ...plain, uniqueCount: [''] } as GridState, {}],
  ['no primary key', plain, { noKey: true }],
])('with %s the card does not take the grid total', async (_n, grid, opts) => {
  const t = setup(grid, opts);
  await t.mount();
  await waitFor(rowsShown);
  await calm();
  expect(shown()).not.toMatch(/123 records/);
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
