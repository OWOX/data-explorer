import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { App } from '../App';
import { openConfigMenu, openFields } from './menu-test-utils';

const data = () => document.getElementById('band-data')!;
const probe = {} as { state: State; dispatch: ReturnType<typeof useStore>[1] };
function Probe() { const [state, dispatch] = useStore(); Object.assign(probe, { state, dispatch }); return null; }
const columns = () => probe.state.grids.orders!.columns;
const rowNames = (menu: HTMLElement) => within(menu).getAllByRole('menuitem').map((r) => r.textContent);

/** The demo marts with Customers reachable a second way, through Stores (the fixtures' edge list is shared, so the list is copied). */
const storesJoinCustomers = () => ({ ...demoFixtures(), edges: [...demoFixtures().edges, { id: 'e-stores-customers', sourceDataMartId: 'stores', targetDataMartId: 'customers', joinConditions: [{ sourceFieldName: 'id', targetFieldName: 'id' }] }] });

async function setup(extra: string[], fixtures = demoFixtures()) {
  // The probe outlives a test: a stale state from the one before must not pass the wait below.
  probe.state = undefined as never;
  render(<AppServices ctx={createMockCtx(fixtures, { latencyMs: 0, maxJoinDepth: 3 })}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(probe.state.grids.orders).toBeTruthy());
  const grid = probe.state.grids.orders!;
  probe.dispatch({ type: 'editGrid', martId: 'orders', grid: { ...grid, columns: [...grid.columns, ...extra] } });
  await waitFor(() => expect(data().querySelectorAll('th[data-group-path]').length).toBeGreaterThan(extra.length ? 1 : 0));
}

test('the config button sits in the band header in Table, and the title cell has no column badge or ×', async () => {
  await setup(['customers__name']);
  const slot = data().querySelector<HTMLElement>('[data-chart-list-slot]')!;
  expect(within(slot).getByRole('button', { name: 'Configure data' })).toHaveAttribute('data-config-button');
  expect(data().querySelector('[data-mart-badge="column"]')).toBeNull();
  expect(within(data()).queryByRole('button', { name: /^Fields of / })).toBeNull();
  expect(within(data()).queryByRole('button', { name: /from the grid$/ })).toBeNull();
});

test('a data mart on a path with no column is listed after the shown ones, and ticking its field adds the column', async () => {
  await setup(['customers__countries__name']);
  const menu = await openConfigMenu();
  expect(rowNames(menu)).toEqual(['Orders', 'Countries', 'Customers']);
  const dialog = await openFields('Customers');
  await userEvent.click(within(dialog).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__name'));
  expect(columns()).toContain('customers__countries__name');
});

test('a joinable data mart is listed under its parent, and ticking its field joins it in one Undo step', async () => {
  await setup([]);
  const orders = await openFields('Orders');
  expect(within(orders).getByText('Joinable Data Marts')).toBeInTheDocument();
  const before = [...columns()];
  await userEvent.click(within(orders).getByRole('menuitem', { name: 'Customers' }));
  const customers = await screen.findByRole('dialog', { name: 'Customers' });
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__name'));
  await userEvent.keyboard('{Escape}{Escape}{Escape}');
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(columns()).toEqual(before));
});

test('two bare copies of one data mart have different titles in the config menu', async () => {
  const fixtures = storesJoinCustomers();
  await setup(['customers__countries__name', 'stores__customers__countries__name'], fixtures);
  const menu = await openConfigMenu();
  const titles = rowNames(menu).filter((t) => t!.startsWith('Customers'));
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

test('two bare copies of one data mart have different titles in a chart\'s menus', async () => {
  const fixtures = storesJoinCustomers();
  await setup(['customers__countries__name', 'stores__customers__countries__name'], fixtures);
  await userEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  await waitFor(() => expect(data().querySelector('section.dm-chart')).not.toBeNull());
  await userEvent.click(await screen.findByRole('button', { name: 'Pie options' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Dimension' }));
  const menu = await screen.findByRole('menu', { name: 'Dimension' });
  const titles = within(menu).getAllByRole('menuitem').map((r) => r.textContent).filter((t) => t!.startsWith('Customers'));
  expect(titles).toHaveLength(2);
  expect(new Set(titles).size).toBe(2);
});

test('untick an ancestor\'s last field, then Remove from report on the nested mart in the same menu: both leave, in at most two Undo steps', async () => {
  await setup(['customers__name']);
  const customers = await openFields('Customers');
  await userEvent.click(within(customers).getByRole('menuitem', { name: 'Countries' }));
  const countries = await screen.findByRole('dialog', { name: 'Countries' });
  await userEvent.click(within(countries).getByRole('option', { name: /^name/i }));
  await waitFor(() => expect(columns()).toContain('customers__countries__name'));
  const both = [...columns()];
  await userEvent.click(within(customers).getByRole('option', { name: /^name/i }));
  await userEvent.click(within(countries).getByRole('menuitem', { name: 'Remove from report' }));
  await waitFor(() => expect(columns().some((c) => c.startsWith('customers__'))).toBe(false));
  expect(data().querySelectorAll('th[data-group-path]')).toHaveLength(1);
  const undo = screen.getByRole('button', { name: 'Undo' });
  await userEvent.click(undo);
  if (columns().join() !== both.join()) await userEvent.click(undo);
  await waitFor(() => expect(columns()).toEqual(both));
});
