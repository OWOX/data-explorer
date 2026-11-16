import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION } from '../../api/grid-columns';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const puts: { id: string; doc: unknown }[] = [];
  const col = ctx.collections;
  const spied = { ...ctx, collections: <T,>(name: string) => { const c = col<T>(name); return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { puts.push({ id, doc: d }); return c.put(id, d); } } : c; } };
  render(<AppServices ctx={spied}><StoreProvider><App /></StoreProvider></AppServices>);
  return { puts };
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const marts = () => document.getElementById('band-marts')!;
const card = (title: string) => within(marts()).getByText(title).closest('article')!;
const title = () => within(data()).getByRole('heading').textContent;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden')).map((h) => h.textContent!);
const ready = async () => { await waitFor(() => expect(headers()).toHaveLength(5)); await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(1)); };
const click = async (name: string) => { await within(marts()).findByText(name); fireEvent.click(card(name)); };
const undo = () => userEvent.click(screen.getByRole('button', { name: 'Undo' }));

test('selecting a joinable data mart adds its first text column, titles the grid "Orders + Customers" and styles the card as joined', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await waitFor(() => expect(headers().some((h) => /Customers · .*name/i.test(h))).toBe(true));
  expect(headers()).toHaveLength(6);
  expect(card('Customers')).toHaveClass('dm-joined');
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
  expect(card('Orders')).not.toHaveClass('dm-joined');
  expect(within(card('Customers')).getByRole('note', { name: 'Joined' })).toBeInTheDocument();
});

test('selecting it again takes its columns out, and a third time brings back the same fields', async () => {
  const t = setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  // choose another field of Customers in the picker
  await userEvent.click(within(data()).getByRole('button', { name: /^Columns/ }));
  await userEvent.click(await screen.findByRole('button', { name: /^Customers/ }));
  await userEvent.click(await screen.findByLabelText('email'));
  await waitFor(() => expect(headers()).toHaveLength(7));
  await userEvent.keyboard('{Escape}');
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(title()).toBe('Orders');
  expect(card('Customers')).not.toHaveClass('dm-joined');
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(7));
  expect(headers().filter((h) => /^Customers ·/.test(h)).length).toBe(2);
  await waitFor(() => expect(t.puts.some((p) => JSON.stringify(p.doc).includes('"picks"'))).toBe(true));
});

test('a joined mart\'s filters and sorts leave with it', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Customers · .*, currently not sorted/i }));
  await waitFor(() => expect(within(data()).getByRole('button', { name: /^Sort by Customers · .*ascending/i })).toBeInTheDocument());
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(within(data()).queryByRole('button', { name: /Customers ·/ })).toBeNull();
});

test('deselecting the main data mart promotes the next joined one, which brings the others it can join', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await click('Stores');
  await waitFor(() => expect(title()).toBe('Orders + Customers + Stores'));
  await click('Orders');
  // Customers cannot join Stores (it has only Countries), so only Customers is left.
  await waitFor(() => expect(title()).toBe('Customers'));
  expect(card('Customers')).toHaveAttribute('aria-pressed', 'true');
});

test('clicking a data mart the main one cannot join makes it the main one, alone', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await click('Order Items');
  await waitFor(() => expect(title()).toBe('Order Items'));
  expect(within(marts()).queryByRole('note', { name: 'Joined' })).toBeNull();
});

test('with no joined mart, deselecting the main one leaves nothing selected', async () => {
  setup();
  await ready();
  await userEvent.click(within(data()).getAllByRole('row')[1]!);
  await within(row()).findByRole('heading', { name: /^Orders · / });
  await click('Orders');
  expect(await within(data()).findByText('Select a data mart.')).toBeInTheDocument();
  expect(within(row()).getByText('Select a row.')).toBeInTheDocument();
  expect(within(row()).getByRole('heading').textContent).toBe('Row');
  await new Promise((r) => setTimeout(r, 200));
  expect(within(data()).getByText('Select a data mart.')).toBeInTheDocument();
});

test('Undo takes back the join, and Redo applies it again', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await undo();
  await waitFor(() => expect(headers()).toHaveLength(5));
  expect(title()).toBe('Orders');
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(headers()).toHaveLength(6));
  expect(title()).toBe('Orders + Customers');
});

test('unticking the last field of a joined mart in the picker deselects it; ticking a field of another mart selects it', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(headers()).toHaveLength(6));
  await userEvent.click(within(data()).getByRole('button', { name: /^Columns/ }));
  await userEvent.click(await screen.findByRole('button', { name: /^Customers/ }));
  const group = await screen.findByRole('group', { name: 'Customers' });
  await userEvent.click(within(group).getByRole('checkbox', { checked: true }));
  await waitFor(() => expect(title()).toBe('Orders'));
  expect(card('Customers')).not.toHaveClass('dm-joined');
  await userEvent.click(await screen.findByRole('button', { name: /^Stores/ }));
  const stores = await screen.findByRole('group', { name: 'Stores' });
  await userEvent.click(within(stores).getAllByRole('checkbox')[0]!);
  await waitFor(() => expect(title()).toBe('Orders + Stores'));
});

test('a joined mart that is not a neighbour is still shown, and the main card stays first', async () => {
  setup();
  await ready();
  await click('Products');
  await waitFor(() => expect(title()).toBe('Orders + Products'));
  const names = [...marts().querySelectorAll('article .dm-node-title')].map((e) => e.textContent);
  expect(names.slice(0, 2)).toEqual(['Orders', 'Products']);
  vi.useRealTimers();
});
