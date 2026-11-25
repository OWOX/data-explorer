import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { TooltipProvider } from '@radix-ui/react-tooltip';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Panel, Row } from './MenuParts';

test('ArrowDown moves onto a check row and ArrowUp back', async () => {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  render(
    <Panel anchor={anchor} mode="below" role="menu" label="Menu" onEscape={vi.fn()} focusSeq={1}>
      <Row label="Open" onActivate={vi.fn()} />
      <Row label="Area" check checkbox checked={false} onActivate={vi.fn()} />
      <Row label="Last" onActivate={vi.fn()} />
    </Panel>,
  );
  const open = await screen.findByRole('menuitem', { name: 'Open' });
  open.focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Area' })).toHaveFocus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('menuitem', { name: 'Last' })).toHaveFocus();
  await userEvent.keyboard('{ArrowUp}{ArrowUp}');
  expect(open).toHaveFocus();
});

test('a hint does not replace Active in the row description', () => {
  render(<TooltipProvider><Row label="Sales" icon={<span />} active hint="Totals by day" onActivate={vi.fn()} /></TooltipProvider>);
  const row = screen.getByRole('menuitem', { name: 'Sales' });
  expect(row.getAttribute('aria-description')).toContain('Active');
  expect(row.getAttribute('aria-description')).toContain('Totals by day');
});

test('marks sit after the (?) and before the arrow, are hidden from assistive tech and read in the row description', () => {
  render(<TooltipProvider><Row sub label="Orders" hint="All sales" marks={[{ icon: <svg data-testid="f" />, note: 'Filtered' }, { icon: <svg />, note: 'Sliced' }]} onActivate={vi.fn()} /></TooltipProvider>);
  const row = screen.getByRole('menuitem', { name: 'Orders' });
  expect(row.getAttribute('aria-description')).toBe('All sales. Filtered. Sliced');
  const marks = row.querySelector('.dm-menu-marks')!;
  expect(marks).toHaveAttribute('aria-hidden', 'true');
  const order = [row.querySelector('.dm-menu-label'), row.querySelector('.dm-hint-slot'), marks, row.querySelector('.dm-menu-arrow')];
  order.slice(1).forEach((el, i) => expect(order[i]!.compareDocumentPosition(el!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy());
});

test('a row with no marks has no marks slot', () => {
  render(<TooltipProvider><Row label="Orders" marks={[]} onActivate={vi.fn()} /></TooltipProvider>);
  expect(screen.getByRole('menuitem', { name: 'Orders' }).querySelector('.dm-menu-marks')).toBeNull();
});

test('the (?) of a row shows when the row itself holds focus', () => {
  const css = readFileSync(resolve(__dirname, '../bands/bands.css'), 'utf8');
  expect(css).toMatch(/\.dm-reveal-host:focus-visible \.dm-hint-slot/);
});

describe('where a panel sits while its anchor moves', () => {
  // The test setup gives every element an 800px height: the window must be taller for the panel to follow its anchor.
  const innerHeight = window.innerHeight;
  beforeAll(() => { window.innerHeight = 3000; });
  afterAll(() => { window.innerHeight = innerHeight; });
  const setup = (pinned: boolean) => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    let top = 100;
    anchor.getBoundingClientRect = () => ({ left: 10, right: 40, top, bottom: top + 28, width: 30, height: 28, x: 10, y: top, toJSON: () => ({}) });
    const tree = (n: number) => <Panel anchor={anchor} mode="below" role="menu" label={`Menu ${n}`} onEscape={vi.fn()} focusSeq={0} pinned={pinned}><Row label="Open" onActivate={vi.fn()} /></Panel>;
    const view = render(tree(1));
    return { moveTo: (y: number) => { top = y; view.rerender(tree(2)); }, panel: () => screen.getByRole('menu') };
  };

  test('a pinned panel keeps the place it opened at, and a window resize takes it afresh', () => {
    const { moveTo, panel } = setup(true);
    const opened = panel().style.top;
    moveTo(300);
    expect(panel().style.top).toBe(opened);
    act(() => { window.dispatchEvent(new Event('resize')); });
    expect(panel().style.top).not.toBe(opened);
  });

  test('a panel that is not pinned follows its anchor', () => {
    const { moveTo, panel } = setup(false);
    const opened = panel().style.top;
    moveTo(300);
    expect(panel().style.top).not.toBe(opened);
  });

  test('a submenu of a pinned panel follows it on a window resize', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    let top = 100;
    anchor.getBoundingClientRect = () => ({ left: 10, right: 40, top, bottom: top + 28, width: 30, height: 28, x: 10, y: top, toJSON: () => ({}) });
    const Both = () => {
      const [row, setRow] = useState<HTMLElement | null>(null);
      return (
        <>
          <Panel anchor={anchor} mode="below" role="menu" label="Root" onEscape={vi.fn()} focusSeq={0} pinned>
            <Row label="Open" rowRef={(el) => { if (el && el !== row) { setRow(el); } }} onActivate={vi.fn()} />
          </Panel>
          {row && <Panel anchor={row} mode="beside" role="menu" label="Sub" onEscape={vi.fn()} focusSeq={0}><Row label="Inner" onActivate={vi.fn()} /></Panel>}
        </>
      );
    };
    render(<Both />);
    const root = await screen.findByRole('menu', { name: 'Root' });
    const sub = await screen.findByRole('menu', { name: 'Sub' });
    // The row sits where its panel does, as in the page.
    const open = screen.getByRole('menuitem', { name: 'Open' });
    open.getBoundingClientRect = () => { const t = parseFloat(root.style.top); return { left: 0, right: 100, top: t + 8, bottom: t + 36, width: 100, height: 28, x: 0, y: t + 8, toJSON: () => ({}) }; };
    act(() => { window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(sub.style.top).toBe(root.style.top));
    const opened = sub.style.top;
    top = 400;
    act(() => { window.dispatchEvent(new Event('resize')); });
    await waitFor(() => expect(root.style.top).not.toBe(opened));
    await waitFor(() => expect(sub.style.top).toBe(`${parseFloat(root.style.top)}px`));
  });
});

test('a row with a hint puts the (?) right after its label, before a tick or an arrow', () => {
  render(<TooltipProvider><Row label="Sales" hint="Totals by day" sub tick checked onActivate={vi.fn()} /></TooltipProvider>);
  const label = screen.getByRole('menuitem', { name: 'Sales' }).querySelector('.dm-menu-label')!;
  expect(label.nextElementSibling).toHaveClass('dm-hint-slot');
  expect(label.nextElementSibling!.nextElementSibling).toHaveClass('dm-menu-tick');
});
