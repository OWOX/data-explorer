import { render, waitFor } from '@testing-library/react';
import { useEffect } from 'react';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { UNIQUE_SHOWN } from './join-plan';
import { useRememberLeaving } from './leaving';
import { AppServices, StoreProvider, useServices, useStore, type State } from './store';

function setup() {
  const h = {} as { state: State; leave: (next: string | null) => void; put: (columns: string[], extra: object) => void; columnStore: ReturnType<typeof useServices>['columnStore'] };
  function Probe() {
    const [s, dispatch] = useStore();
    h.state = s;
    h.columnStore = useServices().columnStore;
    h.leave = useRememberLeaving();
    h.put = (columns, extra) => dispatch({ type: 'saveGrid', martId: 'orders', grid: { columns, filters: {}, sorts: null, limit: 200, ...extra } });
    useEffect(() => { dispatch({ type: 'init', focusId: 'orders' }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><Probe /></StoreProvider></AppServices>);
  return h;
}

test('a mart left without a card click is remembered with its Unique Count', async () => {
  const h = setup();
  await waitFor(() => expect(h.state.selection.martId).toBe('orders'));
  h.put(['id', 'customers__email'], { uniqueCount: ['customers'] });
  await waitFor(() => expect(h.state.grids.orders?.uniqueCount).toEqual(['customers']));
  h.leave('customers');
  await waitFor(() => expect(h.columnStore.lastShown('customers')).toEqual(['email', UNIQUE_SHOWN]));
});

test('a mart kept with its count alone is remembered when the grid is left', async () => {
  const h = setup();
  await waitFor(() => expect(h.state.selection.martId).toBe('orders'));
  h.put(['id'], { uniqueCount: ['customers'], emptyPaths: ['customers'] });
  await waitFor(() => expect(h.state.grids.orders?.uniqueCount).toEqual(['customers']));
  h.leave('stores');
  await waitFor(() => expect(h.columnStore.lastShown('customers')).toEqual([UNIQUE_SHOWN]));
});
