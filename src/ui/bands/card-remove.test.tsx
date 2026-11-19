import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { vi } from 'vitest';
import type { Mart, Model } from '../../model/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type State } from '../../state/store';
import { TooltipProvider } from '../Tooltip';
import { waitFor } from '@testing-library/react';
import { MartCard, martElementId } from './cards';
import { useCardClick } from './useCardClick';

afterEach(cleanup);

const mart: Mart = { id: 'm1', title: 'Orders', description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null };
const props = (over: Partial<React.ComponentProps<typeof MartCard>> = {}) => ({
  mart, contexts: [], count: { state: 'ok', value: 1 } as const, quality: undefined, freshness: null, selected: false, lit: false,
  onSelect: vi.fn(), onOpenApp: vi.fn(), onRetryCount: vi.fn(), onNeedCount: vi.fn(), ...over,
});
const renderCard = (p: ReturnType<typeof props>) => render(<TooltipProvider><MartCard {...p} /></TooltipProvider>);

test('the remove button renders only with onRemove, and carries the label', () => {
  renderCard(props());
  expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
  cleanup();
  renderCard(props({ onRemove: vi.fn() }));
  expect(screen.getByRole('button', { name: 'Remove Orders from the report' })).toBeTruthy();
});

test('clicking the remove button calls onRemove and does not select the card', async () => {
  const p = props({ onRemove: vi.fn() });
  renderCard(p);
  await userEvent.click(screen.getByRole('button', { name: 'Remove Orders from the report' }));
  expect(p.onRemove).toHaveBeenCalledTimes(1);
  expect(p.onSelect).not.toHaveBeenCalled();
});

test('a card with a path has a per-path element id and data-path', () => {
  const { container } = renderCard(props({ path: 'customers' }));
  const el = container.querySelector('article')!;
  expect(el.id).toBe('dm-m1@customers');
  expect(el.getAttribute('data-path')).toBe('customers');
  expect(martElementId('m1')).toBe('dm-m1');
  expect(martElementId('m1', 'a.b')).toBe('dm-m1@a.b');
});

const mk = (id: string) => [id, { id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null }] as const;
const model = { marts: new Map(['orders', 'customers'].map(mk)), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] } as unknown as Model;

test('useCardClick with removePaths drops the path fields in one setMarts and remembers them', async () => {
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  function Probe() {
    const [s, dispatch] = useStore();
    state = s;
    click = useCardClick(model);
    useEffect(() => { dispatch({ type: 'init', focusId: 'orders' }); }, [dispatch]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  await click('customers');
  await waitFor(() => expect(state.grids.orders?.columns.some((c) => c.startsWith('customers__'))).toBe(true));
  await click('customers', { removePaths: ['customers'] });
  await waitFor(() => expect(state.grids.orders!.columns.some((c) => c.startsWith('customers__'))).toBe(false));
  expect(state.grids.orders!.columns.length).toBeGreaterThan(0);
  expect(state.selection.martId).toBe('orders');
});
