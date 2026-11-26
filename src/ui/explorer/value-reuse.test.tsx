import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';
import { traversalOf } from '../../api/test-ctx';
import { valueCache } from '../../filters/valueSuggest';
import { readValues } from '../../search/valueMatch';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import type { Ctx, Row, TraverseOptions } from '../../sdk/types';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openSubmenu } from './menu-test-utils';

const status = { name: 'status', alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false };
const data = () => document.getElementById('band-data')!;
const plain: GridState = { columns: ['id', 'status'], filters: {}, sorts: null, limit: 200 };
const withRule: GridState = { ...plain, filters: { customer_id: { field: 'customer_id', op: 'eq', value: 1 } } };

beforeEach(() => valueCache.clear());

/** The app on the demo mart, whose search-style read of `status` (limit 200) answers `searchRows`; the suggestion reads (limit 50) are listed. */
function setup(grid: GridState, searchRows: Row[]) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const suggests: TraverseOptions[] = [];
  const ctx: Ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => {
    if (id === 'orders' && o.limit === 200 && o.column?.[0] === 'status') return Promise.resolve(traversalOf(searchRows));
    if (id === 'orders' && o.limit === 50) suggests.push(o);
    return real(id, o);
  } } } };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { ctx, suggests };
}
const rowsOf = (n: number, blank = 0): Row[] => Array.from({ length: n }, (_, i) => ({ status: i < blank ? ' ' : `s${i}` }));
const openValue = async () => {
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').length).toBeGreaterThan(1));
  await openSubmenu(within(data()), 'status', 'Filter');
  const dialog = await screen.findByRole('dialog', { name: /^Filter of status$/i });
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.click(within(dialog).getByLabelText('Value'));
  return dialog;
};
// The rows on the grid add their own values; the kept read's are the ones named s<n>.
const options = () => screen.queryAllByRole('option').map((o) => o.textContent ?? '').filter((o) => /^s\d+$/.test(o));

test('a search read of 200 rows with 50 non-blank values answers the suggestion with no read', async () => {
  const t = setup(plain, rowsOf(200, 20));
  await readValues(t.ctx, 'orders', status, new AbortController().signal);
  await openValue();
  await waitFor(() => expect(options()).toHaveLength(50));
  expect(options()[0]).toBe('s20');
  expect(t.suggests).toEqual([]);
});

test('a complete search read answers the suggestion with its non-blank values', async () => {
  const t = setup(plain, rowsOf(12, 2));
  await readValues(t.ctx, 'orders', status, new AbortController().signal);
  await openValue();
  await waitFor(() => expect(options()).toHaveLength(10));
  expect(t.suggests).toEqual([]);
});

test('a full search read with fewer than 50 non-blank values leaves the suggestion to read', async () => {
  const t = setup(plain, rowsOf(200, 180));
  await readValues(t.ctx, 'orders', status, new AbortController().signal);
  await openValue();
  await waitFor(() => expect(t.suggests).toHaveLength(1));
});

test('a suggestion under another rule reads', async () => {
  const t = setup(withRule, rowsOf(12, 2));
  await readValues(t.ctx, 'orders', status, new AbortController().signal);
  await openValue();
  await waitFor(() => expect(t.suggests).toHaveLength(1));
});

test('Reload values reads again', async () => {
  const t = setup(plain, rowsOf(12, 2));
  await readValues(t.ctx, 'orders', status, new AbortController().signal);
  await openValue();
  await waitFor(() => expect(options()).toHaveLength(10));
  await userEvent.click(screen.getByRole('button', { name: /Reload values/ }));
  await waitFor(() => expect(t.suggests).toHaveLength(1));
});
