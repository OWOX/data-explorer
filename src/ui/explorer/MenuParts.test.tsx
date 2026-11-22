import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
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
