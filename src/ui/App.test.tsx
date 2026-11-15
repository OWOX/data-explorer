import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../state/store';
import { App } from './App';

function renderApp() {
  return render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
}

test('default view centres on the mart with the most inbound relationships', async () => {
  renderApp();
  expect(await screen.findByText('Orders')).toBeInTheDocument();
  expect(screen.getByText('Customers')).toBeInTheDocument();
  expect((await screen.findAllByText(/^[\d.]+[KMB]?$/)).length).toBeGreaterThan(0); // count badges arrived
});

test('search narrows the canvas; no match shows the empty message; clearing restores', async () => {
  renderApp();
  await screen.findByText('Orders');
  await userEvent.type(screen.getByLabelText('Search data marts'), 'zzzz');
  expect(await screen.findByText('No data marts match.')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Clear search'));
  expect(await screen.findByText('Orders')).toBeInTheDocument();
});

test('a context chip filters to that context', async () => {
  renderApp();
  await screen.findByText('Orders');
  await userEvent.click(within(screen.getByRole('group', { name: 'Contexts' })).getByText('Marketing'));
  await waitFor(() => expect(screen.queryByText('Orders')).toBeNull());
  expect(screen.getByText('Campaigns')).toBeInTheDocument();
});

test('clicking a card enters explore mode', async () => {
  renderApp();
  // userEvent's mousedown has view=null, which d3-drag in xyflow dereferences; click alone fires onNodeClick
  fireEvent.click(await screen.findByText('Customers'));
  expect(await screen.findByTestId('explorer')).toBeInTheDocument();
});
