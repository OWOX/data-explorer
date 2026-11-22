import { vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartPie, ChartLine, Calendar, Hash, Trash2 } from 'lucide-react';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { HOVER_MS } from '../ui/explorer/MenuParts';

afterEach(cleanup);

const items: MenuItem[] = [
  { kind: 'check', label: 'Totals', icon: Hash, checked: false, onToggle: () => undefined },
  { kind: 'radio', label: 'Bucket', icon: Calendar, value: 'day', options: [{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }], onPick: () => undefined },
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

test('an action row closes the menu and runs', async () => {
  const onPick = vi.fn();
  render(<ChartMenu name="Sales" items={[{ kind: 'action', label: 'Remove', icon: Trash2, onPick }]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
  expect(onPick).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});

test('a row and a submenu option show their icon before the label, hidden from screen readers', async () => {
  render(<ChartMenu name="Sales" items={[
    { kind: 'check', label: 'Orders by date', icon: ChartLine, checked: true, onToggle: () => undefined },
    { kind: 'check', label: 'Sparklines', icon: Hash, checked: true, onToggle: () => undefined },
    { kind: 'radio', label: 'Chart type', icon: Calendar, value: 'pie', options: [{ value: 'pie', label: 'Pie', icon: ChartPie }, { value: 'x', label: 'Plain' }], onPick: () => undefined },
  ]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  const withIcon = screen.getByRole('menuitemcheckbox', { name: 'Orders by date' });
  const glyph = withIcon.querySelector('.dm-menu-glyph svg.lucide-chart-line');
  expect(glyph).toHaveAttribute('aria-hidden', 'true');
  // After the tick column, before the label.
  expect(withIcon.querySelector('.dm-menu-check')!.nextElementSibling).toBe(glyph!.parentElement);
  expect(glyph!.parentElement!.nextElementSibling).toHaveClass('dm-menu-label');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Sparklines' }).querySelector('.dm-menu-glyph svg.lucide-hash')).not.toBeNull();
  // A submenu row has the tick column's room, so its icon sits in the same column.
  expect(screen.getByRole('menuitem', { name: 'Chart type' }).querySelector('.dm-menu-check')!.nextElementSibling).toHaveClass('dm-menu-glyph');
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  expect((await screen.findByRole('menuitemradio', { name: 'Pie' })).querySelector('.dm-menu-glyph svg.lucide-chart-pie')).not.toBeNull();
  expect(screen.getByRole('menuitemradio', { name: 'Plain' }).querySelector('.dm-menu-glyph')).toBeNull();
});

test('the ResizeObserver callback that fires on observe does not shield a real scroll right after opening', async () => {
  const Real = globalThis.ResizeObserver;
  class Eager {
    constructor(private cb: () => void) {}
    observe() { this.cb(); }
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = Eager as unknown as typeof ResizeObserver;
  try {
    render(<div data-chart-kind="bar"><ChartMenu name="Sales" items={items} /></div>);
    await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
    expect(screen.getByRole('menu', { name: 'Sales menu' })).toBeInTheDocument();
    Object.defineProperty(window, 'scrollY', { value: 120, configurable: true });
    fireEvent.scroll(document);
    expect(screen.queryByRole('menu', { name: 'Sales menu' })).toBeNull();
  } finally {
    globalThis.ResizeObserver = Real;
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  }
});
