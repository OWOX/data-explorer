import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

function mountApp() {
  render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
}

// userEvent.click on a canvas card crashes d3-drag in jsdom (mousedown with view=null), so cards are clicked with fireEvent.
async function openOrders() {
  mountApp();
  fireEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  await within(panel).findByRole('table');
  return panel;
}

test('mart tab shows the first 5 columns and 200 rows with load more', async () => {
  const panel = await openOrders();
  const headers = within(panel).getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toHaveLength(5);
  expect(within(panel).getAllByRole('row')).toHaveLength(201); // header + 200
  await userEvent.click(within(panel).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(401));
});

test('relationship column shows the customer name and opens the customer record', async () => {
  const panel = await openOrders();
  const nameCell = await waitFor(() => {
    const c = within(panel).getAllByRole('cell').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
    expect(c).toBeDefined();
    return c!;
  });
  await userEvent.click(within(nameCell).getByRole('button'));
  const tabs = screen.getAllByRole('tab');
  expect(tabs.at(-1)!.textContent).toMatch(/^Customers: \d+/);
});

test('filter then reset', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByLabelText('Filter id'));
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
  await userEvent.type(screen.getByLabelText('Value'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(4));
  await userEvent.click(within(panel).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(201));
});

test('column picker adds a column', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByRole('button', { name: /Columns \(5\/8\)/ }));
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(within(panel).getAllByRole('columnheader')).toHaveLength(6));
});

test('a mart without a primary key is preview only', async () => {
  mountApp();
  await userEvent.type(await screen.findByLabelText('Search data marts'), 'daily');
  fireEvent.click(await screen.findByText('Daily KPIs'));
  expect(await screen.findByText('Preview only: this data mart has no primary key.')).toBeInTheDocument();
});

test('closing the last tab returns to the full canvas', async () => {
  await openOrders();
  await userEvent.click(screen.getByLabelText(/^Close Orders/));
  await waitFor(() => expect(screen.queryByTestId('explorer')).toBeNull());
});
