import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState } from '../../state/store';
import { App } from '../App';
import { openColumnMenu, openSubmenu } from './menu-test-utils';

function setup(grid: GridState) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const ctx = { ...base, owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id: string, o: TraverseOptions) => { if (id === 'orders') queries.push(o); return real(id, o); } } } };
  function Probe() {
    const [, dispatch] = useStore();
    useEffect(() => { dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const plain: GridState = { columns: ['id', 'status', 'customers__city'], filters: {}, sorts: null, limit: 200 };
const sliced: GridState = { ...plain, slices: { customers__country_code: { field: 'customers__country_code', op: 'eq', value: 'PL' } }, columns: ['id', 'status', 'customers__country_code'] };
const having: GridState = {
  columns: ['status', 'net_revenue'], filters: { net_revenue: { field: 'net_revenue', op: 'gt', value: 100, fn: 'SUM' } }, aggregations: [{ column: 'net_revenue', function: 'SUM' }], sorts: null, limit: 200,
};

test('the Slice row sits under Filter on a joined column only', async () => {
  setup(plain);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const joined = await openColumnMenu(within(data()), 'Customers · city');
  const names = within(joined).getAllByRole('menuitem').map((r) => r.textContent);
  expect(names.indexOf('Slice')).toBe(names.indexOf('Filter') + 1);
  expect(joined.querySelector('svg.lucide-layers')).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  const main = await openColumnMenu(within(data()), 'status');
  expect(within(main).queryByRole('menuitem', { name: 'Slice' })).toBeNull();
});

test('Slice opens "Slice of {title}" with the banner; Apply sets the slice and Clear removes it', async () => {
  const t = setup(plain);
  await waitFor(() => expect(headers()).toHaveLength(3));
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const dialog = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  expect(within(dialog).getByText('Slices filter the joined data mart before it is joined, reducing the rows pulled in.')).toBeInTheDocument();
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'eq');
  await userEvent.type(within(dialog).getByLabelText('Value'), 'Kyiv');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)?.filter).toEqual([{ column: 'customers__city', operator: 'eq', value: 'Kyiv', placement: 'pre-join' }]));
  expect(await within(data()).findByRole('button', { name: /^Slice Customers · city/ })).toBeInTheDocument();
  await openSubmenu(within(data()), 'Customers · city', 'Slice');
  const again = await screen.findByRole('dialog', { name: 'Slice of Customers · city' });
  await userEvent.click(within(again).getByRole('button', { name: 'Clear' }));
  await waitFor(() => expect(within(data()).queryByRole('button', { name: /^Slice Customers · city/ })).toBeNull());
});

test('the header shows a Layers button for an active slice and it opens the Slice submenu', async () => {
  setup(sliced);
  await waitFor(() => expect(headers()).toHaveLength(3));
  const button = await within(data()).findByRole('button', { name: 'Slice Customers · Country' });
  expect(button.querySelector('svg.lucide-layers')).not.toBeNull();
  await userEvent.click(button);
  expect(await screen.findByRole('dialog', { name: 'Slice of Customers · Country' })).toBeInTheDocument();
});

test('a HAVING filter says what it filters, takes a number and keeps its function on apply', async () => {
  const t = setup(having);
  await waitFor(() => expect(headers().some((h) => h?.includes('Sum'))).toBe(true));
  const button = await within(data()).findByRole('button', { name: /^Filter Net Revenue/ });
  await userEvent.click(button);
  const dialog = await screen.findByRole('dialog', { name: /^Filter of Net Revenue/ });
  expect(within(dialog).getByText('Filters the SUM after grouping')).toBeInTheDocument();
  expect(within(dialog).queryByText('Filters rows before they are aggregated')).toBeNull();
  expect(within(dialog).getByLabelText('Value')).toHaveAttribute('type', 'number');
  const value = within(dialog).getByLabelText('Value');
  await userEvent.clear(value);
  await userEvent.type(value, '250');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(t.queries.at(-1)?.filter).toEqual([{ column: 'net_revenue', operator: 'gt', value: 250, function: 'SUM' }]));
});

test('the Funnel tooltip of a HAVING filter names the function', async () => {
  setup(having);
  await waitFor(() => expect(headers().some((h) => h?.includes('Sum'))).toBe(true));
  const button = await within(data()).findByRole('button', { name: /^Filter Net Revenue/ });
  await userEvent.hover(button);
  expect((await screen.findAllByText('Filter: SUM > 100')).length).toBeGreaterThan(0);
});
