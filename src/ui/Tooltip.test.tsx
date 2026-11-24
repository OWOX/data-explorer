import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test } from 'vitest';
import { Tooltip, TooltipProvider } from './Tooltip';

const tip = (content: string) => <TooltipProvider><Tooltip content={content}><button type="button">Badge</button></Tooltip></TooltipProvider>;

test('a tooltip with no content stays shut and gives its trigger no aria-describedby', async () => {
  render(tip(''));
  await userEvent.hover(screen.getByRole('button', { name: 'Badge' }));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
  expect(screen.getByRole('button', { name: 'Badge' })).not.toHaveAttribute('aria-describedby');
});

test('content that arrives while the trigger is hovered shows at once; content that goes and comes back does not reopen it unhovered', async () => {
  const { rerender } = render(tip(''));
  const button = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(button);
  rerender(tip('3 filters'));
  expect((await screen.findAllByText('3 filters')).length).toBeGreaterThan(0);
  rerender(tip(''));
  await userEvent.unhover(button);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  rerender(tip('3 filters'));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});
