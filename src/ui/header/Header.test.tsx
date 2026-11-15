import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { stubCtx } from '../../api/test-ctx';
import { AppServices, StoreProvider, useStore } from '../../state/store';
import { TooltipProvider } from '../Tooltip';
import { Header } from './Header';

function Version() {
  const [s] = useStore();
  return <span data-testid="version">{s.modelVersion}</span>;
}

function mount(failedStorages: { id: string; title: string; message: string }[]) {
  render(
    <AppServices ctx={stubCtx()}><StoreProvider><TooltipProvider>
      <Header failedStorages={failedStorages} />
      <Version />
    </TooltipProvider></StoreProvider></AppServices>,
  );
}

test('failed storages show a compact warning with the messages in a tooltip and a Retry that refreshes', async () => {
  mount([{ id: 's1', title: 'Warehouse', message: 'connection refused' }, { id: 's2', title: 'Lake', message: 'timeout' }]);
  const warning = screen.getByText('2 storages failed to load');
  expect(screen.getByTestId('version').textContent).toBe('0');
  await userEvent.hover(warning);
  expect((await screen.findAllByText(/Warehouse: connection refused/)).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/Lake: timeout/).length).toBeGreaterThan(0);
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(screen.getByTestId('version').textContent).toBe('1');
});

test('one failure reads in the singular; none shows nothing', () => {
  mount([{ id: 's1', title: 'Warehouse', message: 'x' }]);
  expect(screen.getByText('1 storage failed to load')).toBeInTheDocument();
});

test('no failed storages, no warning', () => {
  mount([]);
  expect(screen.queryByText(/failed to load/)).toBeNull();
});
