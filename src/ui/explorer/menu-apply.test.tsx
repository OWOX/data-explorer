import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { openSubmenu } from './menu-test-utils';

// Every Apply in the column menu, pressed through the real menu: the form must apply and the menu must close.
function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));
const ready = () => waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));
async function show(label: string) {
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
  await userEvent.click(await screen.findByLabelText(label));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}
const closed = () => waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

test('Aggregate Apply: a numeric column with the nine governed functions ticks Sum and applies', async () => {
  setup(); await ready(); await show('Net Revenue');
  await openSubmenu(within(data()), 'Net Revenue', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).getAllByRole('option')).toHaveLength(9);
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await closed();
  await waitFor(() => expect(within(data()).getAllByRole('columnheader').some((h) => h.textContent?.startsWith('Net Revenue · Sum'))).toBe(true));
});

test('Filter Apply: the operator form applies a value', async () => {
  setup(); await ready();
  await openSubmenu(within(data()), 'Store', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await closed();
  expect(await within(data()).findByRole('button', { name: /^Filter Store/ })).toBeInTheDocument();
});

test('Filter Apply: Last N days applies', async () => {
  setup(); await ready(); await show('created_at');
  await openSubmenu(within(data()), 'created_at', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('menuitemradio', { name: 'Last…' }));
  const last = await screen.findByRole('menu', { name: 'Last…' });
  const n = within(last).getByLabelText('N');
  await userEvent.clear(n);
  await userEvent.type(n, '5');
  await userEvent.click(within(last).getByRole('button', { name: 'Apply' }));
  await closed();
  expect(screen.queryByRole('menu', { name: 'Last…' })).toBeNull();
  expect(await within(data()).findByRole('button', { name: /^Filter created_at/ })).toBeInTheDocument();
});

test('Filter Apply: a custom date range applies', async () => {
  setup(); await ready(); await show('created_at');
  await openSubmenu(within(data()), 'created_at', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByRole('menuitem', { name: 'Custom range…' }));
  fireEvent.change(within(dialog).getByLabelText('From'), { target: { value: '2026-01-01T00:00' } });
  fireEvent.change(within(dialog).getByLabelText('To'), { target: { value: '2026-12-31T00:00' } });
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await closed();
  expect(await within(data()).findByRole('button', { name: /^Filter created_at/ })).toBeInTheDocument();
});
