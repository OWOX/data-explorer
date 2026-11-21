import { vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { keyShown } from '../../sdk/mock/key-shown';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { openColumnMenu, openSubmenu } from './menu-test-utils';

const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const undo = () => screen.getByRole('button', { name: 'Undo' });

// Grid edits are Undo steps: Cmd/Ctrl+Z puts the grid back, Cmd/Ctrl+Shift+Z re-applies the edit.
function setup() {
  const ctx = keyShown(createMockCtx(demoFixtures(), { latencyMs: 0 }));
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

test('a sort is exactly one step', async () => {
  setup(); await ready();
  await userEvent.click(within(data()).getByRole('button', { name: /^Sort by Store/ }));
  await waitFor(() => expect(undo()).toBeEnabled());
  await userEvent.click(undo());
  expect(undo()).toBeDisabled();
});

test('an aggregation is exactly one step: Undo takes the Sum off and nothing more', async () => {
  setup(); await ready();
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
  await userEvent.click(await screen.findByLabelText('Amount'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(headers()).toContain('Amount'));
  await openSubmenu(within(data()), 'Amount', 'Aggregate');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Sum'));
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(true));
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(headers()).toContain('Amount'));
  expect(headers().some((h) => h.startsWith('Amount · Sum'))).toBe(false);
});

test('Reset is exactly one step: Undo brings the filter back', async () => {
  setup(); await ready();
  await applyStoreFilter();
  await userEvent.click(within(data()).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(filterButton()).toBeNull());
  await userEvent.click(undo());
  await waitFor(() => expect(filterButton()).not.toBeNull());
});

test('Load more is not a step', async () => {
  setup(); await ready();
  await userEvent.click(within(data()).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(201));
  expect(undo()).toBeDisabled();
});

test('Ctrl+Y redoes on a platform that is not a Mac', async () => {
  const platform = vi.spyOn(navigator, 'platform', 'get').mockReturnValue('Win32');
  try {
    setup(); await ready();
    await applyStoreFilter();
    await userEvent.keyboard('{Control>}z{/Control}');
    await waitFor(() => expect(filterButton()).toBeNull());
    await userEvent.keyboard('{Control>}y{/Control}');
    await waitFor(() => expect(filterButton()).not.toBeNull());
  } finally { platform.mockRestore(); }
});

test('Cmd+Z is left to the filter Value input while it has focus', async () => {
  setup(); await ready();
  await applyStoreFilter();
  await openSubmenu(within(data()), 'Store', 'Filter');
  const dialog = await screen.findByRole('dialog');
  await userEvent.click(within(dialog).getByLabelText('Value'));
  await userEvent.keyboard('{Meta>}z{/Meta}');
  expect(filterButton()).not.toBeNull();
  expect(undo()).toBeEnabled();
});

test('Cmd+Z works with focus inside the grid', async () => {
  setup(); await ready();
  await applyStoreFilter();
  // The column letter selects the column in the grid without opening a record (a row click would be a selection step of its own).
  await userEvent.click(within(data()).getAllByText('A')[0]!.closest('th')!);
  expect(data().contains(document.activeElement) && document.activeElement !== data()).toBe(true);
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(filterButton()).toBeNull());
});

test('Cmd+Z does nothing while a column menu or the Fields picker is open', async () => {
  setup(); await ready();
  await applyStoreFilter();
  await openSubmenu(within(data()), 'Store', 'Filter');
  const dialog = await screen.findByRole('dialog');
  // Focus on the dialog itself, not on an input: the shortcut is still left alone.
  await userEvent.keyboard('{Meta>}z{/Meta}');
  expect(filterButton()).not.toBeNull();
  expect(undo()).toBeEnabled();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(dialog).not.toBeInTheDocument());
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
  await screen.findByRole('dialog');
  await userEvent.keyboard('{Meta>}z{/Meta}');
  expect(filterButton()).not.toBeNull();
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await userEvent.keyboard('{Meta>}z{/Meta}');
  await waitFor(() => expect(filterButton()).toBeNull());
});
