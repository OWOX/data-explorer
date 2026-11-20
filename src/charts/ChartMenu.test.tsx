import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { HOVER_MS } from '../ui/explorer/MenuParts';

afterEach(cleanup);

const items: MenuItem[] = [
  { kind: 'check', label: 'Totals', checked: false, onToggle: () => undefined },
  { kind: 'radio', label: 'Bucket', value: 'day', options: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }], onPick: () => undefined },
];
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));

test('hovering a submenu row opens it only after the pointer has rested, and Escape closes just the submenu', async () => {
  render(<ChartMenu name="Sales" items={items} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  const root = screen.getByRole('menu', { name: 'Sales menu' });
  expect(screen.queryByRole('menu', { name: 'Bucket' })).toBeNull();
  // With nothing open yet the first hover opens at once.
  fireEvent.mouseEnter(screen.getByRole('menuitem', { name: 'Bucket' }));
  await wait(0);
  const sub = await screen.findByRole('menu', { name: 'Bucket' });
  // Moving to another row waits HOVER_MS before the open submenu goes.
  fireEvent.mouseEnter(screen.getByRole('menuitemcheckbox', { name: 'Totals' }));
  await wait(HOVER_MS / 2);
  expect(screen.getByRole('menu', { name: 'Bucket' })).toBe(sub);
  await wait(HOVER_MS + 60);
  expect(screen.queryByRole('menu', { name: 'Bucket' })).toBeNull();
  // Escape: the submenu first, the menu stays.
  await userEvent.click(screen.getByRole('menuitem', { name: 'Bucket' }));
  await screen.findByRole('menu', { name: 'Bucket' });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('menu', { name: 'Bucket' })).toBeNull();
  expect(root).toBeInTheDocument();
  expect(screen.getByRole('menu', { name: 'Sales menu' })).toBeInTheDocument();
});
