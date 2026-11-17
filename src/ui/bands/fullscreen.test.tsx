import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from '../explorer/menu-test-utils';

const data = () => document.getElementById('band-data')!;
const page = () => document.querySelector('.dm-page')!;

async function mount() {
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(document.getElementById('band-data')).not.toBeNull());
  await waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());
  await waitFor(() => expect(within(data()).getAllByRole('row').length).toBeGreaterThan(5));
}
const enter = () => userEvent.click(within(data()).getByRole('button', { name: 'Full screen' }));
const exitButton = () => within(data()).queryByRole('button', { name: 'Exit full screen' });

test('the icon toggles full screen and says which state it is in', async () => {
  await mount();
  const button = within(data()).getByRole('button', { name: 'Full screen' });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(page()).not.toHaveClass('dm-full');
  await userEvent.click(button);
  expect(page()).toHaveClass('dm-full');
  expect(exitButton()).toHaveAttribute('aria-pressed', 'true');
  // The band cannot be folded while it fills the screen.
  expect(within(data()).queryByRole('button', { name: 'Hide Data' })).toBeNull();
  await userEvent.click(exitButton()!);
  expect(page()).not.toHaveClass('dm-full');
  expect(within(data()).getByRole('button', { name: 'Hide Data' })).toBeInTheDocument();
});

test('Escape leaves full screen', async () => {
  await mount();
  await enter();
  await userEvent.keyboard('{Escape}');
  expect(page()).not.toHaveClass('dm-full');
});

test('the grid is not remounted: a selected cell stays selected through entering and leaving', async () => {
  await mount();
  const cell = data().querySelectorAll('tbody td')[1] as HTMLElement;
  await userEvent.click(cell);
  expect(cell).toHaveAttribute('data-selected');
  await enter();
  expect(data().contains(cell)).toBe(true);
  expect(cell).toHaveAttribute('data-selected');
  await userEvent.click(exitButton()!);
  expect(data().contains(cell)).toBe(true);
  expect(cell).toHaveAttribute('data-selected');
});

test('Escape inside an open column menu closes the menu and stays in full screen; a second Escape leaves', async () => {
  await mount();
  await enter();
  await openColumnMenu(within(data()), 'status');
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(document.querySelector('[data-column-menu]')).toBeNull());
  expect(page()).toHaveClass('dm-full');
  await userEvent.keyboard('{Escape}');
  expect(page()).not.toHaveClass('dm-full');
});

test('full screen is not saved: a new page opens in the normal layout', async () => {
  await mount();
  await enter();
  document.body.innerHTML = '';
  await mount();
  expect(page()).not.toHaveClass('dm-full');
});
