import { act, render, screen } from '@testing-library/react';
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
});
