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
// A card just added is focused, so the other band cards are dimmed until the focus is let go.
const letGo = () => fireEvent.keyDown(document, { key: 'Escape' });
const bandCard = (id: string) => within(marts()).findByText(new RegExp(`^${id}$`)).then((t) => t.closest('article')!);

/** Orders, Customers (customers), Stores (stores). */
async function joinCustomersAndStores() {
  await ready();
  fireEvent.click(await bandCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  letGo();
  fireEvent.click(await bandCard('Stores'));
  await waitFor(() => expect(el('stores', 'stores')).not.toBeNull());
  letGo();
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

test('a mart joined twice is a card per path, each titled with its parent mart', async () => {
  setup();
  await joinCountriesTwice();
  expect(within(el('countries', 'customers.countries')!).getByText('Countries (Customers)')).toBeInTheDocument();
  expect(within(el('countries', 'stores.countries')!).getByText('Countries (Stores)')).toBeInTheDocument();
  expect(cards().filter((a) => a.dataset.martId === 'countries' && !a.hasAttribute('data-ghost'))).toHaveLength(2);
});

test('a mart joined through one path reads as its title, and a ghost for a second path carries its parent mart', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  expect(within(el('countries', 'customers.countries')!).getByText('Countries')).toBeInTheDocument();
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(ghost('countries', 'stores.countries')).not.toBeNull());
  expect(within(ghost('countries', 'stores.countries')!).getByText('Countries (Stores)')).toBeInTheDocument();
});

test('a click on a joined card removes nothing and shows what joins under it', async () => {
  setup();
  await joinCustomersAndStores();
  const before = headers();
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
  expect(headers()).toEqual(before);
  expect(el('customers', 'customers')).toHaveAttribute('aria-pressed', 'true');
  // Every mart outside the report has a dashed border; only the ones the focused card can join stay at full strength, the others are dimmed.
  for (const outside of [el('countries'), el('products')]) expect(outside).toHaveClass('dm-offpath');
  expect(el('countries')).not.toHaveClass('dm-faded');
  expect(el('products')).toHaveClass('dm-faded');
  for (const inReport of [el('stores', 'stores'), el('orders')]) {
    expect(inReport).not.toHaveClass('dm-offpath');
    expect(inReport).not.toHaveClass('dm-faded');
  }
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
  expect(el('customers')).not.toHaveClass('dm-faded');
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
  // Nothing is focused or hovered: the cards outside the report are dimmed.
  expect(el('products')).toHaveClass('dm-faded');
});

test('the × on a middle card takes only its own columns; on the bare card it takes the subtree, in one Undo step', async () => {
  setup();
  await joinCountriesTwice();
  await userEvent.click(within(el('customers', 'customers')!).getByRole('button', { name: 'Remove Customers from the report' }));
  await waitFor(() => expect(groupTitles()).toEqual(['Orders', 'Stores', 'Countries (Customers)', 'Countries (Stores)']));
  expect(el('customers', 'customers')).not.toBeNull();
  expect(el('countries', 'customers.countries')).not.toBeNull();
  expect(el('countries', 'stores.countries')).not.toBeNull();
  // The × on the now bare card takes its whole subtree, in one Undo step.
  await userEvent.click(within(el('customers', 'customers')!).getByRole('button', { name: 'Remove Customers from the report' }));
  await waitFor(() => expect(el('customers', 'customers')).toBeNull());
  expect(el('countries', 'customers.countries')).toBeNull();
  expect(el('countries', 'stores.countries')).not.toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  expect(el('customers', 'customers')).not.toBeNull();
});

test('with a card focused, a card it cannot take directly still adds on a click, by its shortest chain', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(el('stores', 'stores')).toHaveAttribute('data-focused'));
  expect(el('products')).toHaveClass('dm-offpath');
  fireEvent.click(el('products')!);
  await waitFor(() => expect(el('products', 'products')).not.toBeNull());
  expect(within(marts()).queryByRole('status')).toBeNull();
});

test('Enter on a joinable card adds it and focus lands on its new report card', async () => {
  setup();
  await ready();
  fireEvent.click(el('orders')!);
  await waitFor(() => expect(el('orders')).toHaveAttribute('data-focused'));
  const customers = await bandCard('Customers');
  customers.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(el('customers', 'customers')));
});

test('Enter on a ghost with a card focused adds it and focus lands on the new report card', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(ghost('countries', 'stores.countries')).not.toBeNull());
  ghost('countries', 'stores.countries')!.focus();
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(el('countries', 'stores.countries')).not.toBeNull());
  await waitFor(() => expect(document.activeElement).toBe(el('countries', 'stores.countries')));
});

test('the tree line from Orders to Customers carries the join fields', async () => {
  setup();
  await joinCustomersAndStores();
  await waitFor(() => expect(document.querySelector('#wires path[data-tip]')).not.toBeNull());
  const tips = [...document.querySelectorAll<SVGPathElement>('#wires path[data-tip]')].map((p) => p.dataset.tip);
  expect(tips).toContain('customer_id → id');
});

test('Charts: a mart joined twice is two cells with their own titles and fields', async () => {
  setup();
  await joinCountriesTwice();
  await userEvent.click(within(data()).getByRole('radio', { name: 'Charts' }));
  await waitFor(() => expect(data().querySelectorAll('td[data-chart-group="countries"]')).toHaveLength(2));
  const cell = (path: string) => data().querySelector<HTMLElement>(`td[data-chart-path="${path}"]`)!;
  expect(cell('customers.countries')).not.toBe(cell('stores.countries'));
  const names = (path: string) => [...cell(path).querySelectorAll('[data-card]')].map((c) => (c as HTMLElement).dataset.card);
  expect(names('customers.countries').every((n) => !n?.includes('stores'))).toBe(true);
  expect(names('stores.countries').every((n) => !n?.includes('customers'))).toBe(true);
});

test('a click on an outside card adds it and focuses it, its joinable marts show; a second click hides them', async () => {
  setup();
  await ready();
  fireEvent.click(await bandCard('Customers'));
  await waitFor(() => expect(el('customers', 'customers')).not.toBeNull());
  await waitFor(() => expect(el('customers', 'customers')).toHaveAttribute('data-focused'));
  // Countries joins under Customers, Products joins the report some other way: both are outside it, dashed and full strength.
  expect(el('countries')).toHaveClass('dm-offpath');
  expect(el('products')).toHaveClass('dm-offpath');
  expect(el('products')).toHaveClass('dm-faded');
  fireEvent.click(el('customers', 'customers')!);
  await waitFor(() => expect(marts().querySelector('[data-focused]')).toBeNull());
  expect(el('products')).toHaveClass('dm-offpath');
});

test('a click on a ghost deep in the focus chain adds it and focuses the new card', async () => {
  setup();
  await joinCustomersAndStores();
  fireEvent.click(el('customers', 'customers')!);
  fireEvent.click(await bandCard('Countries'));
  await waitFor(() => expect(el('countries', 'customers.countries')).not.toBeNull());
  await waitFor(() => expect(el('countries', 'customers.countries')).toHaveAttribute('data-focused'));
  fireEvent.click(el('stores', 'stores')!);
  await waitFor(() => expect(ghost('countries', 'stores.countries')).not.toBeNull());
  fireEvent.click(ghost('countries', 'stores.countries')!);
  await waitFor(() => expect(el('countries', 'stores.countries')).toHaveAttribute('data-focused'));
});
