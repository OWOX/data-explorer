import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useServices } from '../../state/store';
import { App } from '../App';
import { openColumnMenu } from './menu-test-utils';

const data = () => document.getElementById('band-data')!;
const order = () => [...data().querySelectorAll<HTMLElement>('th.dm-th[data-column]')].map((h) => h.dataset.column!);
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const ready = () => waitFor(() => expect(within(data()).getAllByRole('row').some((r) => r.querySelector('td')?.textContent)).toBe(true));

function setup() {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const services: { current: ReturnType<typeof useServices> | null } = { current: null };
  const Probe = () => { services.current = useServices(); return null; };
  render(<AppServices ctx={ctx}><Probe /><StoreProvider><App /></StoreProvider></AppServices>);
  return services;
}

test('Move right swaps the column with its neighbour, saves the order, and Undo puts it back', async () => {
  const services = setup(); await ready();
  const before = headers();
  const save = vi.spyOn(services.current!.columnStore, 'save');
  const menu = await openColumnMenu(within(data()), 'id');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
  await waitFor(() => expect(headers()).toEqual([before[1], before[0], ...before.slice(2)]));
  expect(save).toHaveBeenCalledTimes(1);
  expect(save.mock.calls[0]![0]).toBe('orders');
  expect(save.mock.calls[0]![1]!.slice(0, 2)).toEqual(['customer_id', 'id']);
  await userEvent.click(screen.getByRole('button', { name: 'Undo' }));
  await waitFor(() => expect(headers()).toEqual(before));
});

test('Move left is disabled on the first column, Move right on the last of its group', async () => {
  setup(); await ready();
  const first = await openColumnMenu(within(data()), 'id');
  expect(within(first).getByRole('menuitem', { name: 'Move left' })).toBeDisabled();
  expect(within(first).getByRole('menuitem', { name: 'Move right' })).toBeEnabled();
  await userEvent.keyboard('{Escape}');
  const lastTitle = headers()[headers().length - 1]!.trim();
  const last = await openColumnMenu(within(data()), lastTitle);
  expect(within(last).getByRole('menuitem', { name: 'Move right' })).toBeDisabled();
  expect(within(last).getByRole('menuitem', { name: 'Move left' })).toBeEnabled();
});

test('after Move right the focus is on the moved column\'s menu button', async () => {
  setup(); await ready();
  const menu = await openColumnMenu(within(data()), 'id');
  await userEvent.click(within(menu).getByRole('menuitem', { name: 'Move right' }));
  await waitFor(() => expect(order()[1]).toBe('id'));
  await waitFor(() => expect(document.activeElement).toBe(within(data()).getByLabelText('Column menu id')));
});
