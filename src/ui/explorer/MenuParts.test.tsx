import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
