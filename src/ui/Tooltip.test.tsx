import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
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
  // Past the open delay: the tip is open in state, with nothing to show yet.
  await new Promise((r) => setTimeout(r, 300));
  rerender(tip('3 filters'));
  expect((await screen.findAllByText('3 filters')).length).toBeGreaterThan(0);
  rerender(tip(''));
  await userEvent.unhover(button);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  rerender(tip('3 filters'));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

test('a press while the tip has no content keeps it shut when content arrives', async () => {
  const { rerender } = render(tip(''));
  const button = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(button);
  await new Promise((r) => setTimeout(r, 300));
  await userEvent.click(button);
  rerender(tip('3 filters'));
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByRole('tooltip')).toBeNull();
});

// A tooltip with `copyText`: a bubble the pointer can enter, with a copy button in its corner.
const copyTip = (text = 'Paid: $9,299 (23%)', props: { side?: 'right' | 'top'; onClick?: () => void } = {}) => (
  <TooltipProvider><div onClick={props.onClick}><Tooltip content={text} copyText={text} side={props.side}><button type="button">Node</button></Tooltip><button type="button">Other</button></div></TooltipProvider>
);
const copyButton = () => screen.getByRole('button', { name: 'Copy to clipboard' });
const writeText = vi.fn<(t: string) => Promise<void>>();
const withClipboard = () => { writeText.mockReset(); writeText.mockResolvedValue(undefined); Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); };
afterEach(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); });

test('a tooltip with no copyText has no copy button and opens on top', async () => {
  render(tip('Hello'));
  await userEvent.hover(screen.getByRole('button', { name: 'Badge' }));
  expect(await screen.findByRole('tooltip')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  expect(document.querySelector('.dm-hint-body')).toHaveAttribute('data-side', 'top');
});

test('side opens the bubble on that side', async () => {
  render(copyTip('Paid: $9,299', { side: 'right' }));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  expect(document.querySelector('.dm-hint-body')).toHaveAttribute('data-side', 'right');
});

test('nothing of the copy button is mounted while the tooltip is shut', async () => {
  render(copyTip());
  expect(screen.queryByRole('button', { name: 'Copy to clipboard' })).toBeNull();
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  expect(copyButton()).toBeInTheDocument();
});

test('the hidden tooltip is the plain text with no button in it; the visible bubble holds the button', async () => {
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  const hidden = await screen.findByRole('tooltip');
  expect(hidden.textContent).toBe('Paid: $9,299 (23%)');
  expect(hidden.querySelector('button')).toBeNull();
  expect(document.querySelector('.dm-hint-body')).toContainElement(copyButton());
});

test('keyboard focus on the trigger opens it with its text', async () => {
  render(copyTip());
  await userEvent.tab();
  expect(await screen.findByRole('tooltip')).toHaveTextContent('Paid: $9,299 (23%)');
});

test('the pointer can move from the trigger into the bubble and the bubble stays (jsdom has no layout: the e2e covers leaving it)', async () => {
  render(copyTip());
  const node = screen.getByRole('button', { name: 'Node' });
  await userEvent.hover(node);
  await screen.findByRole('tooltip');
  await userEvent.unhover(node);
  const bubble = document.querySelector<HTMLElement>('.dm-hint-body')!;
  await userEvent.hover(bubble);
  await new Promise((r) => setTimeout(r, 400));
  expect(document.querySelector('.dm-hint-body')).not.toBeNull();
});

test('a tooltip with no copyText still closes the moment the pointer leaves the trigger', async () => {
  render(tip('Hello'));
  const badge = screen.getByRole('button', { name: 'Badge' });
  await userEvent.hover(badge);
  await screen.findByRole('tooltip');
  await userEvent.unhover(badge);
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('Escape closes it', async () => {
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
});

test('Copy writes exactly the text, keeps the bubble open, turns into a check, and does not reach what is under the bubble', async () => {
  withClipboard();
  const outer = vi.fn();
  render(copyTip('Pürblack 30 grams: $9,299 (23%)', { onClick: outer }));
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(writeText).toHaveBeenCalledWith('Pürblack 30 grams: $9,299 (23%)');
  expect(outer).not.toHaveBeenCalled();
  await waitFor(() => expect(copyButton()).toHaveAttribute('data-copied'));
  expect(screen.getByRole('tooltip')).toBeInTheDocument();
  // About 1.5 s later the check goes back to the copy icon.
  await waitFor(() => expect(copyButton()).not.toHaveAttribute('data-copied'), { timeout: 3000 });
});

test('when neither way of copying works the bubble says so', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn().mockRejectedValue(new Error('blocked')) }, configurable: true });
  const exec = vi.fn().mockReturnValue(false);
  Object.defineProperty(document, 'execCommand', { value: exec, configurable: true });
  render(copyTip());
  await userEvent.hover(screen.getByRole('button', { name: 'Node' }));
  await screen.findByRole('tooltip');
  await userEvent.click(copyButton());
  expect(await screen.findByText('Copy failed')).toBeInTheDocument();
  expect(exec).toHaveBeenCalledWith('copy');
});
