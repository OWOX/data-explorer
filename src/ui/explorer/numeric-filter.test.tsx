import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

const data = () => document.getElementById('band-data')!;
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));

test('applying "> 100" through the Amount filter popover filters the grid', async () => {
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  await waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(within(data()).getByRole('button', { name: 'Fields of Orders' }));
  await userEvent.click(await screen.findByLabelText('Amount'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const before = bodyRows().length;
  await userEvent.click(within(data()).getByRole('button', { name: 'Filter Amount' }));
  const dialog = await screen.findByRole('dialog');
  await userEvent.selectOptions(within(dialog).getByLabelText('Operator'), 'gt');
  await userEvent.type(within(dialog).getByLabelText('Value'), '400');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  await waitFor(() => expect(within(data()).getByRole('button', { name: 'Filter Amount' })).toHaveClass('dm-ctl-on'));
  await waitFor(() => expect(bodyRows().length).toBeLessThan(before));
});
