import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx } from '../sdk/types';
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

function ctxFailingAfterFirstLoad() {
  const base = createMockCtx(demoFixtures());
  const fail = { current: false };
  const ctx: Ctx = {
    ...base,
    owox: {
      ...base.owox,
      storages: { list: async () => { if (fail.current) throw new Error('boom'); return base.owox.storages.list(); } },
    },
  };
  return { ctx, fail };
}

test('a failed refresh keeps the canvas and open tabs and shows a retry in the header', async () => {
  const { ctx, fail } = ctxFailingAfterFirstLoad();
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  fireEvent.click(await screen.findByText('Customers'));
  await screen.findByTestId('explorer');
  fail.current = true;
  await userEvent.click(screen.getByLabelText('Refresh model'));
  expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  expect(screen.getByTestId('explorer')).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(screen.getByLabelText('Search data marts')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

test('a failed first load shows the full-screen error', async () => {
  const base = createMockCtx(demoFixtures());
  const ctx: Ctx = { ...base, owox: { ...base.owox, storages: { list: async () => { throw new Error('down'); } } } };
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  expect(await screen.findByRole('alert')).toHaveTextContent('down');
  expect(screen.queryByLabelText('Search data marts')).toBeNull();
});

test('a tab whose mart disappears after a refresh falls back to its id', async () => {
  const base = createMockCtx(demoFixtures());
  const hide = { current: false };
  const ctx: Ctx = {
    ...base,
    owox: {
      ...base.owox,
      getJson: async <T,>(path: string, query?: Record<string, string>) => {
        const r = await base.owox.getJson<T>(path, query);
        if (hide.current && path === '/api/model-canvas/data-marts') {
          const page = r as unknown as { items: { id: string }[] };
          return { ...page, items: page.items.filter((i) => i.id !== 'customers') } as T;
        }
        return r;
      },
    },
  };
  render(<AppServices ctx={ctx}><StoreProvider><App /></StoreProvider></AppServices>);
  fireEvent.click(await screen.findByText('Customers'));
  await screen.findByTestId('explorer');
  hide.current = true;
  await userEvent.click(screen.getByLabelText('Refresh model'));
  await waitFor(() => expect(screen.getByRole('tab')).toHaveTextContent('customers'));
  expect(within(screen.getByTestId('explorer')).getByRole('tabpanel')).toBeInTheDocument();
});
