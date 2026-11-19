import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { martElementId } from './cards';

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const marts = () => document.getElementById('band-marts')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const groupTitles = () => within(data()).queryAllByRole('columnheader').filter((h) => h.getAttribute('scope') === 'colgroup').map((h) => h.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true)); };
const cards = () => [...marts().querySelectorAll<HTMLElement>('article')];
const el = (id: string, path?: string) => cards().find((a) => a.id === martElementId(id, path) && !a.hasAttribute('data-ghost')) ?? null;
const ghost = (id: string, path?: string) => cards().find((a) => a.id === martElementId(id, path) && a.hasAttribute('data-ghost')) ?? null;
const bandCard = (id: string) => within(marts()).findByText(new RegExp(`^${id}$`)).then((t) => t.closest('article')!);

/** Orders, Customers (customers), Stores (stores). */
async function joinCustomersAndStores() {
  await ready();
  fireEvent.click(await bandCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  fireEvent.click(await bandCard('Stores'));
  await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
}
async function joinCountriesTwice() {
  await joinCustomersAndStores();
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(ghost('countries', 'stores.countries')).not.toBeNull());
  fireEvent.click(ghost('countries', 'stores.countries')!);
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
}

test('a mart joined twice is a card per path, each titled with its path', async () => {
  setup();
  await joinCountriesTwice();
  expect(within(el('countries', 'customers.countries')!).getByText('Countries (customers.countries)')).toBeInTheDocument();
  expect(within(el('countries', 'stores.countries')!).getByText('Countries (stores.countries)')).toBeInTheDocument();
  expect(cards().filter((a) => a.dataset.martId === 'countries' && !a.hasAttribute('data-ghost'))).toHaveLength(2);
});

test('a click on a joined card removes nothing and shows what joins under it', async () => {
  setup();
  await joinCustomersAndStores();
  const before = headers();
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
  expect(headers()).toEqual(before);
  expect(el('customers', 'customers')).toHaveAttribute('aria-pressed', 'true');
  // Countries is joinable under Customers and keeps its look; Products is not and is dimmed.
  expect(el('countries')).not.toHaveClass('dm-unjoinable');
  expect(el('products')).toHaveClass('dm-unjoinable');
  // The report cards are never dimmed.
  expect(el('stores', 'stores')).not.toHaveClass('dm-unjoinable');
  expect(el('orders')).not.toHaveClass('dm-unjoinable');
});

test('a click on the main card focuses it and does not deselect', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Customers');
  fireEvent.click(el('orders')!);
  await waitFor(() => expect(el('orders')).toHaveAttribute('data-focused'));
  expect(el('orders')).toHaveAttribute('aria-pressed', 'true');
  expect(groupTitles()).toEqual(['Orders']);
  expect(headers()).toHaveLength(5);
  expect(el('customers')).not.toHaveClass('dm-unjoinable');
});

test('a click on a ghost while a card is focused adds it under that path', async () => {
  setup();
  await joinCustomersAndStores();
  // Countries joins under Customers first, so under Stores it is a ghost: no band card is left for it.
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(ghost('countries', 'stores.countries')).not.toBeNull());
  fireEvent.click(ghost('countries', 'stores.countries')!);
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
});

test('a click on a joinable card that is in the band adds it under the focused path', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('stores', 'stores')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  expect(el('countries', 'customers.countries')).toBeNull();
});

test('clicking the focused card again, the empty band or Escape clears the focus', async () => {
  setup();
  await joinCustomersAndStores();
  const focused = () => marts().querySelector('[data-focused]');
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(focused()).not.toBeNull());
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(focused()).toBeNull());
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(focused()).not.toBeNull());
  fireEvent.click(marts().querySelector('.dm-band-body')!);
  await waitFor(() => expect(focused()).toBeNull());
  fireEvent.click(el('orders')!);
  await waitFor(() => expect(focused()).not.toBeNull());
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(focused()).toBeNull());
  expect(el('products')).not.toHaveClass('dm-unjoinable');
});

test('the × takes a joined card and the paths under it out in one step', async () => {
  setup();
  await joinCountriesTwice();
  await userEvent.click(within(el('customers', 'customers')!).getByRole('button', { name: 'Remove Customers from the report' }));
  await waitFor(() => expect(el('customers', 'customers')).toBeNull());
  expect(el('countries', 'customers.countries')).toBeNull();
  expect(el('countries', 'stores.countries')).not.toBeNull();
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Stores', 'Countries']));
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  expect(el('countries', 'customers.countries')).not.toBeNull();
});

test('with a card focused, the hint on a dimmed card names the focused card but the drag goes to the main card', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(el('products')).toHaveClass('dm-unjoinable'));
  fireEvent.click(el('products')!);
  expect(await within(el('products')!).findByRole('status')).toHaveTextContent("Can't join Stores. Drag it onto Orders to make it the main data mart.");
});
