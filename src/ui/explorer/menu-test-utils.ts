import { screen, within } from '@testing-library/react';
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
