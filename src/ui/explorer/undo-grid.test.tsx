import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { openColumnMenu, openSubmenu } from './menu-test-utils';

// Grid edits are Undo steps: Cmd/Ctrl+Z puts the grid back, Cmd/Ctrl+Shift+Z re-applies the edit.
function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const ready = () => waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));
const filterButton = () => within(data()).queryByRole('button', { name: /^Filter Store/ });

async function applyStoreFilter() {
  await openSubmenu(within(data()), 'Store', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.type(within(dialog).getByLabelText('Value'), '1');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(await within(data()).findByRole('button', { name: /^Filter Store/ })).toBeInTheDocument();
}

test('a filter is one step: Cmd+Z removes it, Cmd+Shift+Z applies it again', async () => {
  setup(); await ready();
  await applyStoreFilter();
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(filterButton()).toBeNull());
  await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
  await waitFor(() => expect(filterButton()).not.toBeNull());
});

test('Ctrl+Z undoes the filter and the header buttons do the same', async () => {
  setup(); await ready();
  await applyStoreFilter();
  await userEvent.keyboard('{Control>}z{/Control}');
  await waitFor(() => expect(filterButton()).toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Redo' }));
  await waitFor(() => expect(filterButton()).not.toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(filterButton()).toBeNull());
});

test('hiding a column is a step: Undo brings the column back', async () => {
  setup(); await ready();
  const headers = () => within(data()).getAllByRole('columnheader').map((h) => h.textContent ?? '');
  expect(headers().some((h) => h.startsWith('Store'))).toBe(true);
  const menu = await openColumnMenu(within(data()), 'Store');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Hide column' }));
  await waitFor(() => expect(headers().some((h) => h.startsWith('Store'))).toBe(false));
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(headers().some((h) => h.startsWith('Store'))).toBe(true));
  await userEvent.keyboard('{Meta>}{Shift>}z{/Shift}{/Meta}');
  await waitFor(() => expect(headers().some((h) => h.startsWith('Store'))).toBe(false));
});

test('opening the grid and seeding it is not a step', async () => {
  setup(); await ready();
  expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
});
