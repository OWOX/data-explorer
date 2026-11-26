import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { App } from '../App';
import { closeConfigMenu, openConfigMenu, openFields } from './menu-test-utils';

const data = () => document.getElementById('band-data')!;
const titles = () => Array.from(data().querySelectorAll<HTMLElement>('th[data-group-path]')).map((h) => h.querySelector('.truncate')!.textContent);
const paths = () => Array.from(data().querySelectorAll<HTMLElement>('th[data-group-path]')).map((h) => h.dataset.groupPath);

const probe = {} as { state: State; dispatch: ReturnType<typeof useStore>[1] };
function Probe() { const [state, dispatch] = useStore(); Object.assign(probe, { state, dispatch }); return null; }

async function setup(extra: string[]) {
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(probe.state.grids.orders).toBeTruthy());
  const grid = probe.state.grids.orders!;
  probe.dispatch({ type: 'editGrid', martId: 'orders', grid: { ...grid, columns: [...grid.columns, ...extra] } });
  await waitFor(() => expect(paths().length).toBeGreaterThan(1));
}
const both = ['customers__name', 'customers__countries__name', 'stores__countries__name'];
const remove = async (title: string) => { const panel = await openFields(title); await userEvent.click(within(panel).getByRole('menuitem', { name: 'Remove from report' })); };

test('two adjacent paths of one mart are two column groups, each titled with its parent mart', async () => {
  await setup(both);
  expect(paths()).toEqual(['', 'customers', 'customers.countries', 'stores.countries']);
  expect(titles()).toEqual(['Orders', 'Customers', 'Customers > Countries', 'Stores > Countries']);
});

test('a mart reached through one path is titled without it', async () => {
  await setup(['customers__name', 'customers__countries__name']);
  expect(titles()).toEqual(['Orders', 'Customers', 'Countries']);
});

test('the x on one Countries group leaves the other', async () => {
  await setup(both);
  await remove('Stores > Countries');
  await waitFor(() => expect(paths()).toEqual(['', 'customers', 'customers.countries']));
  expect(titles()).toEqual(['Orders', 'Customers', 'Countries']);
});

test('the x on Customers takes only its own columns: the Countries behind it keep theirs and stay joined through it', async () => {
  await setup(both);
  await remove('Customers');
  await waitFor(() => expect(paths()).toEqual(['', 'customers.countries', 'stores.countries']));
  expect(titles()).toEqual(['Orders', 'Customers > Countries', 'Stores > Countries']);
  const cols = probe.state.grids.orders!.columns;
  expect(cols).toContain('customers__countries__name');
  expect(cols).not.toContain('customers__name');
});

test('ticking a field on one Countries group keeps two Countries groups, with the field in its own group', async () => {
  await setup(both);
  const dialog = await openFields('Customers > Countries');
  // Only this path's fields are listed, after the mart's Unique Count row.
  expect(within(dialog).getAllByRole('option')).toHaveLength(3);
  await userEvent.click(within(dialog).getByRole('option', { name: /code/i }));
  await waitFor(() => expect(probe.state.grids.orders!.columns).toContain('customers__countries__code'));
  await closeConfigMenu();
  expect(paths()).toEqual(['', 'customers', 'customers.countries', 'stores.countries']);
  const cols = probe.state.grids.orders!.columns;
  expect(cols.indexOf('customers__countries__code')).toBe(cols.indexOf('customers__countries__name') + 1);
});

test('a group header keeps the description hint and has no Fields button or remove cross; the config menu row of the mart carries the hint too', async () => {
  await setup(['customers__name']);
  const head = data().querySelector<HTMLElement>('th[data-group-path=""]')!;
  expect(within(head).getByRole('note', { name: 'About Orders' })).toBeInTheDocument();
  expect(within(head).queryByRole('button', { name: /^Fields of / })).toBeNull();
  expect(within(head).queryByRole('button', { name: /^Remove / })).toBeNull();
  const menu = await openConfigMenu();
  expect(within(menu).getByRole('menuitem', { name: 'Orders' }).querySelector('[aria-label="About Orders"]')).not.toBeNull();
  await closeConfigMenu();
});
