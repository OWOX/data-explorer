import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { ContextBadges } from './ContextBadges';

const contexts = ['Alpha', 'Bravo', 'Charlie', 'Delta'].map((name) => ({ id: name.toLowerCase(), name, icon: null }));

/** Every badge is 50px wide and the chip 44px; the row is `width` wide. */
function layout(width: number) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(width);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const w = this.textContent?.startsWith('+') ? 44 : 50;
    return { width: w, height: 18, top: 0, left: 0, right: w, bottom: 18, x: 0, y: 0, toJSON() {} };
  });
}
afterEach(() => vi.restoreAllMocks());

test('when the row is wide enough every badge shows and there is no chip', () => {
  layout(400);
  render(<ContextBadges contexts={contexts} selectedIds={[]} onToggle={() => {}} />);
  const group = screen.getByRole('group', { name: 'Contexts' });
  expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta']);
  expect(group.querySelector('[data-context-more]')).toBeNull();
});

test('a row that fits the badges on two lines has no chip', () => {
  layout(110);
  render(<ContextBadges contexts={contexts} selectedIds={[]} onToggle={() => {}} />);
  const group = screen.getByRole('group', { name: 'Contexts' });
  // 50 + 4 + 50 = 104 per line: two lines hold all four.
  expect(within(group).getAllByRole('button')).toHaveLength(4);
  expect(group.querySelector('[data-context-more]')).toBeNull();
});

test('a narrow row keeps what fits on two lines and puts the rest behind a "+N more" chip', async () => {
  layout(100);
  const toggled: string[] = [];
  render(<ContextBadges contexts={contexts} selectedIds={[]} onToggle={(id) => toggled.push(id)} />);
  const group = screen.getByRole('group', { name: 'Contexts' });
  // One badge per line, and the chip shares the second line with Bravo: 50 + 4 + 44 = 98 <= 100.
  expect(within(group).getByRole('button', { name: 'Alpha' })).toBeInTheDocument();
  expect(within(group).getByRole('button', { name: 'Bravo' })).toBeInTheDocument();
  expect(within(group).queryByRole('button', { name: 'Charlie' })).toBeNull();
  const chip = within(group).getByRole('button', { name: '2 more contexts' });
  expect(chip).toHaveTextContent('+2');
  expect(chip).not.toHaveAttribute('data-on');
  await userEvent.click(chip);
  const list = await screen.findByRole('group', { name: 'Hidden contexts' });
  await userEvent.click(within(list).getByRole('button', { name: 'Charlie' }));
  expect(toggled).toEqual(['charlie']);
});

test('a selected context behind the chip lights it', () => {
  layout(100);
  render(<ContextBadges contexts={contexts} selectedIds={['delta']} onToggle={() => {}} />);
  expect(screen.getByRole('button', { name: '2 more contexts, 1 selected' })).toHaveAttribute('data-on');
});

test('the list behind the chip is a dialog named "More contexts": a second press on the chip, Escape and a press outside close it, and Escape returns focus to the chip', async () => {
  layout(100);
  render(<ContextBadges contexts={contexts} selectedIds={[]} onToggle={() => {}} />);
  const chip = screen.getByRole('button', { name: '2 more contexts' });
  await userEvent.click(chip);
  expect(await screen.findByRole('dialog', { name: 'More contexts' })).toBeInTheDocument();
  await userEvent.click(chip);
  expect(screen.queryByRole('dialog')).toBeNull();
  await userEvent.click(chip);
  await screen.findByRole('dialog', { name: 'More contexts' });
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(chip).toHaveFocus();
  await userEvent.click(chip);
  await screen.findByRole('dialog', { name: 'More contexts' });
  fireEvent.pointerDown(document.body);
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});

test('toggling a badge in the list leaves it open, and opening it puts focus on its first badge', async () => {
  layout(100);
  render(<ContextBadges contexts={contexts} selectedIds={[]} onToggle={() => {}} />);
  await userEvent.click(screen.getByRole('button', { name: '2 more contexts' }));
  const list = await screen.findByRole('group', { name: 'Hidden contexts' });
  expect(within(list).getByRole('button', { name: 'Charlie' })).toHaveFocus();
  await userEvent.click(within(list).getByRole('button', { name: 'Delta' }));
  expect(screen.getByRole('dialog', { name: 'More contexts' })).toBeInTheDocument();
});
