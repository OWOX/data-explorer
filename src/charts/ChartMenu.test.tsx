import { vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChartPie, ChartLine, Calendar, Hash, EyeOff } from 'lucide-react';
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
  render(<ChartMenu name="Sales" items={[{ kind: 'action', label: 'Hide', icon: EyeOff, onPick }]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Hide' }));
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
  // The green tick sits in the left check column, then the glyph, then the label; there is no tick at the right end.
  expect(withIcon.firstElementChild).toHaveClass('dm-menu-check');
  expect(withIcon.firstElementChild!.querySelector('svg')).not.toBeNull();
  expect(withIcon.querySelector('.dm-menu-tick')).toBeNull();
  expect(withIcon.firstElementChild!.nextElementSibling).toBe(glyph!.parentElement);
  expect(withIcon).toHaveAttribute('aria-checked', 'true');
  expect(glyph!.parentElement!.nextElementSibling).toHaveClass('dm-menu-label');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Sparklines' }).querySelector('.dm-menu-glyph svg.lucide-hash')).not.toBeNull();
  // Beside check rows a submenu row keeps the empty check column, so its icon lines up with theirs.
  const sub = screen.getByRole('menuitem', { name: 'Chart type' });
  expect(sub.firstElementChild).toHaveClass('dm-menu-check');
  expect(sub.firstElementChild!.nextElementSibling).toHaveClass('dm-menu-glyph');
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

describe('a field menu over several data marts', () => {
  const groups = [
    { title: 'Orders', options: [{ value: 'a', label: 'Amount' }, { value: 'b', label: 'Tax' }] },
    { title: 'Products', options: [{ value: 'c', label: 'Price' }] },
  ];
  const radio = (g: typeof groups, onPick = vi.fn()): MenuItem[] => [{ kind: 'radio', label: 'Metric', icon: Hash, value: 'c', options: [{ value: '', label: 'Off' }], groups: g, onPick }];

  test('lists the marts first, ticks the one holding the choice, and opens its options on a third level', async () => {
    const onPick = vi.fn();
    render(<ChartMenu name="Sales" items={radio(groups, onPick)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Metric' }));
    const second = await screen.findByRole('menu', { name: 'Metric' });
    expect(second).toHaveTextContent('Off');
    expect(screen.queryByRole('menuitemradio', { name: 'Amount' })).toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Products' }).querySelector('.dm-menu-tick svg')).not.toBeNull();
    expect(screen.getByRole('menuitem', { name: 'Orders' }).querySelector('.dm-menu-tick svg')).toBeNull();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Orders' }));
    await screen.findByRole('menu', { name: 'Orders' });
    // Escape closes one level.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('menu', { name: 'Orders' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Metric' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitem', { name: 'Orders' }));
    await userEvent.click(await screen.findByRole('menuitemradio', { name: 'Tax' }));
    expect(onPick).toHaveBeenCalledWith('b');
    expect(screen.queryByRole('menu')).toBeNull();
  });

  test('ArrowRight opens a mart and ArrowLeft closes it', async () => {
    render(<ChartMenu name="Sales" items={radio(groups)} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Metric' }));
    await screen.findByRole('menu', { name: 'Metric' });
    screen.getByRole('menuitem', { name: 'Orders' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    await screen.findByRole('menu', { name: 'Orders' });
    await userEvent.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('menu', { name: 'Orders' })).toBeNull();
    expect(screen.getByRole('menu', { name: 'Metric' })).toBeInTheDocument();
  });

  test('a single mart is skipped: its options are listed directly', async () => {
    render(<ChartMenu name="Sales" items={radio(groups.slice(0, 1))} />);
    await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
    await userEvent.click(screen.getByRole('menuitem', { name: 'Metric' }));
    await screen.findByRole('menuitemradio', { name: 'Amount' });
    expect(screen.queryByRole('menuitem', { name: 'Orders' })).toBeNull();
  });
});

test('when a root row is a check row every root row has the check column, and none has it otherwise', async () => {
  const plain: MenuItem[] = [
    { kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => undefined },
    { kind: 'radio', label: 'Bucket', icon: Calendar, value: 'day', options: [{ value: 'day', label: 'Day' }], onPick: () => undefined },
  ];
  const { unmount } = render(<ChartMenu name="Sales" items={plain} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  const rootOf = () => screen.getByRole('menu', { name: 'Sales menu' });
  expect(rootOf().querySelectorAll('.dm-menu-check')).toHaveLength(0);
  unmount();
  render(<ChartMenu name="Sales" items={[{ kind: 'check', label: 'Area', icon: Hash, checked: true, onToggle: () => undefined }, ...plain]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  const rows = [...rootOf().querySelectorAll('.dm-menu-row')];
  expect(rows).toHaveLength(3);
  for (const r of rows) expect(r.querySelector('.dm-menu-check')).not.toBeNull();
});

test('a band above changing size (the Data Marts band unfolding) closes the menu; its own band and one below do not', async () => {
  const Real = globalThis.ResizeObserver;
  const live: { cb: ResizeObserverCallback; els: Element[] }[] = [];
  class Manual {
    els: Element[] = [];
    constructor(private cb: ResizeObserverCallback) { live.push(this as unknown as { cb: ResizeObserverCallback; els: Element[] }); }
    observe(el: Element) { this.els.push(el); this.cb([{ target: el } as ResizeObserverEntry], this as unknown as ResizeObserver); }
    unobserve() {}
    disconnect() { this.els = []; }
  }
  globalThis.ResizeObserver = Manual as unknown as typeof ResizeObserver;
  const resize = (el: Element) => act(() => { for (const o of live) if (o.els.includes(el)) o.cb([{ target: el } as ResizeObserverEntry], o as unknown as ResizeObserver); });
  try {
    render(<><section data-band="" id="marts" /><section data-band="" id="data"><div data-chart-kind="bar"><ChartMenu name="Sales" items={items} /></div></section><section data-band="" id="rows" /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
    resize(document.getElementById('data')!);
    // A band below the button can change size without moving it.
    resize(document.getElementById('rows')!);
    expect(screen.getByRole('menu', { name: 'Sales menu' })).toBeInTheDocument();
    resize(document.getElementById('marts')!);
    expect(screen.queryByRole('menu', { name: 'Sales menu' })).toBeNull();
  } finally {
    globalThis.ResizeObserver = Real;
  }
});

test('the third level of one submenu does not open by itself in the next one', async () => {
  const axis = (label: string, prefix: string): MenuItem => ({
    kind: 'radio', label, icon: Hash, value: '', onPick: () => undefined, options: [],
    groups: [{ title: `${prefix} Orders`, options: [{ value: 'a', label: 'A' }] }, { title: `${prefix} Customers`, options: [{ value: 'b', label: 'B' }] }],
  });
  render(<ChartMenu name="Sales" items={[axis('X axis', 'X'), axis('Y axis', 'Y')]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'X axis' }));
  await userEvent.click(await screen.findByRole('menuitem', { name: 'X Orders' }));
  await screen.findByRole('menu', { name: 'X Orders' });
  await userEvent.click(screen.getByRole('menuitem', { name: 'Y axis' }));
  await screen.findByRole('menu', { name: 'Y axis' });
  expect(screen.queryByRole('menu', { name: 'Y Orders' })).toBeNull();
  expect(screen.queryByRole('menu', { name: 'X Orders' })).toBeNull();
});
