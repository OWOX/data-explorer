import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { App } from '../App';

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
const remove = (title: string) => fireEvent.click(within(data()).getByRole('button', { name: `Remove ${title} from the grid` }));

test('two adjacent paths of one mart are two column groups, each titled with its path', async () => {
  await setup(both);
  expect(paths()).toEqual(['', 'customers', 'customers.countries', 'stores.countries']);
  expect(titles()).toEqual(['Orders', 'Customers', 'Countries (customers.countries)', 'Countries (stores.countries)']);
});

test('a mart reached through one path is titled without it', async () => {
  await setup(['customers__name', 'customers__countries__name']);
  expect(titles()).toEqual(['Orders', 'Customers', 'Countries']);
});

test('the x on one Countries group leaves the other', async () => {
  await setup(both);
  remove('Countries (stores.countries)');
  await waitFor(() => expect(paths()).toEqual(['', 'customers', 'customers.countries']));
  expect(titles()).toEqual(['Orders', 'Customers', 'Countries']);
});

test('the x on Customers takes customers.countries with it and keeps stores.countries', async () => {
  await setup(both);
  remove('Customers');
  await waitFor(() => expect(paths()).toEqual(['', 'stores.countries']));
  expect(titles()).toEqual(['Orders', 'Countries']);
  expect(probe.state.grids.orders!.columns).not.toContain('customers__countries__name');
});

test('ticking a field on one Countries group keeps two Countries groups, with the field in its own group', async () => {
  await setup(both);
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Countries (customers.countries)' }));
  const dialog = await screen.findByRole('dialog');
  // Only this path's fields are listed.
  expect(within(dialog).getAllByRole('option')).toHaveLength(2);
  await userEvent.click(within(dialog).getByRole('option', { name: /code/i }));
  await waitFor(() => expect(probe.state.grids.orders!.columns).toContain('customers__countries__code'));
  await userEvent.keyboard('{Escape}');
  expect(paths()).toEqual(['', 'customers', 'customers.countries', 'stores.countries']);
  const cols = probe.state.grids.orders!.columns;
  expect(cols.indexOf('customers__countries__code')).toBe(cols.indexOf('customers__countries__name') + 1);
});

test('a group header lists the description hint before the Fields button, then the remove cross', async () => {
  await setup(['customers__name']);
  const head = data().querySelector<HTMLElement>('th[data-group-path=""]')!;
  const hint = within(head).getByRole('note', { name: 'About Orders' });
  const fields = within(head).getByRole('button', { name: 'Fields of Orders' });
  expect(hint.compareDocumentPosition(fields) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});
