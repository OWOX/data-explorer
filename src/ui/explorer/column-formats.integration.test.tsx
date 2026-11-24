import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { keyShown } from '../../sdk/mock/key-shown';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function setup() {
  const fixtures = demoFixtures();
  const ctx = keyShown(createMockCtx(fixtures, { latencyMs: 0 }));
  void ctx.collections<Record<string, unknown>>('column-formats-member').put('orders', { amount: { kind: 'money', currency: 'USD' } });
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
}
const data = () => document.getElementById('band-data')!;
const row = () => document.getElementById('band-row')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent!);
const bodyRows = () => within(data()).getAllByRole('row').filter((r) => r.querySelector('td'));

async function showAmount() {
  await waitFor(() => expect(bodyRows().some((r) => r.querySelector('td')?.textContent)).toBe(true));
  await userEvent.click(within(data()).getByRole('button', { name: /^Fields of Orders:/ }));
  await userEvent.click(await screen.findByLabelText('Amount'));
  await userEvent.keyboard('{Escape}');
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

test('the Row band shows a column with the format the grid shows it in', async () => {
  setup();
  await showAmount();
  const at = headers().findIndex((h) => h.startsWith('Amount'));
  await waitFor(() => expect(bodyRows()[0]?.querySelectorAll('td')[at]?.textContent).toMatch(/^(US)?\$/));
  fireEvent.click(bodyRows()[0]!);
  const term = await within(row()).findByText('Amount');
  expect(term.closest('.contents')!.querySelector('dd')!.textContent).toMatch(/^(US)?\$[\d,]+\.\d\d$/);
});
