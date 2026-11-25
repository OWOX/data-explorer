import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

type Scope = { findByLabelText: (label: string) => Promise<HTMLElement> };

/** Clicks a column's menu icon and returns its open menu. */
export async function openColumnMenu(scope: Scope, title: string): Promise<HTMLElement> {
  await userEvent.click(await scope.findByLabelText(`Column menu ${title}`));
  return screen.findByRole('menu', { name: `Menu of ${title}` });
}

/** Opens a column's menu and clicks one of its first-level rows (Filter, Slice, Aggregate, Format, Sort). */
export async function openSubmenu(scope: Scope, title: string, row: 'Filter' | 'Slice' | 'Aggregate' | 'Format' | 'Sort'): Promise<void> {
  const menu = await openColumnMenu(scope, title);
  await userEvent.click(within(menu).getByRole('menuitem', { name: row }));
}

/** The config menu's root menu, opened (a click on the config button when it is closed). */
export async function openConfigMenu(): Promise<HTMLElement> {
  // The Data band's own (looked up each time: the band is rebuilt when the page has loaded): a page test may mount two apps, and the first band is the one the tests read.
  const button = await waitFor(() => within(document.getElementById('band-data') ?? document.body).getByRole('button', { name: 'Configure data' }));
  if (button.getAttribute('aria-expanded') !== 'true') await userEvent.click(button);
  return screen.findByRole('menu', { name: 'Configure data' });
}

/** Opens the config menu, clicks the data mart's row and returns its dialog: its fields, its joinable data marts, Remove from report. */
export async function openFields(martTitle: string): Promise<HTMLElement> {
  const menu = await openConfigMenu();
  await userEvent.click(await within(menu).findByRole('menuitem', { name: martTitle }));
  return screen.findByRole('dialog', { name: martTitle });
}

/** Closes the config menu with whatever panels it has open (Escape closes one level at a time). */
export async function closeConfigMenu(): Promise<void> {
  for (let i = 0; i < 4 && screen.queryByRole('menu', { name: 'Configure data' }); i++) await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('menu', { name: 'Configure data' })).toBeNull());
}
