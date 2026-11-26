import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { vi } from 'vitest';
import type { Mart, Model } from '../../model/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useServices, useStore, type State } from '../../state/store';
import { TooltipProvider } from '../Tooltip';
import { MartCard, martElementId } from './cards';
import { useCardClick } from './useCardClick';

afterEach(cleanup);

const mart: Mart = { id: 'm1', title: 'Orders', description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null };
const props = (over: Partial<React.ComponentProps<typeof MartCard>> = {}) => ({
  mart, contexts: [], count: { state: 'ok', value: 1 } as const, quality: undefined, selected: false, lit: false,
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

test('the remove button works from the keyboard and does not select the card', async () => {
  const p = props({ onRemove: vi.fn() });
  renderCard(p);
  screen.getByRole('button', { name: 'Remove Orders from the report' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(p.onRemove).toHaveBeenCalledTimes(1);
  expect(p.onSelect).not.toHaveBeenCalled();
});

const mk = (id: string) => [id, { id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null }] as const;
const model = { marts: new Map(['orders', 'customers', 'stores', 'countries'].map(mk)), sources: [], edges: [], contexts: [], storages: [], failedStorages: [] } as unknown as Model;

test('useCardClick with removePaths is one Undo step, and remembers only the removed path\'s fields', async () => {
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  let dispatch!: ReturnType<typeof useStore>[1];
  let columnStore!: ReturnType<typeof useServices>['columnStore'];
  const ctx = createMockCtx(demoFixtures(), { latencyMs: 0 });
  function Probe() {
    const [s, d] = useStore();
    state = s;
    dispatch = d;
    columnStore = useServices().columnStore;
    click = useCardClick(model);
    useEffect(() => { d({ type: 'init', focusId: 'orders' }); }, [d]);
    return null;
  }
  render(<AppServices ctx={ctx}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await waitFor(() => expect(state.selection.martId).toBe('orders'));
  await click('customers');
  await waitFor(() => expect(state.grids.orders?.columns.some((c) => c.startsWith('customers__'))).toBe(true));
  // Countries sits at two paths; the grid shows name under one and name and code under the other.
  const wide = [...state.grids.orders!.columns, 'customers__countries__name', 'stores__countries__name', 'stores__countries__code'];
  dispatch({ type: 'editGrid', martId: 'orders', grid: { ...state.grids.orders!, columns: wide } });
  await waitFor(() => expect(state.grids.orders!.columns).toEqual(wide));
  await click('countries', { removePaths: ['customers.countries'] });
  await waitFor(() => expect(state.grids.orders!.columns).not.toContain('customers__countries__name'));
  expect(state.grids.orders!.columns).toContain('stores__countries__code');
  expect(state.selection.martId).toBe('orders');
  expect(columnStore.lastShown('countries')).toEqual(['name']);
  dispatch({ type: 'undo', known: () => true });
  await waitFor(() => expect(state.grids.orders!.columns).toEqual(wide));
});

test('removePaths with no main mart does nothing', async () => {
  let click!: ReturnType<typeof useCardClick>;
  let state!: State;
  function Probe() {
    const [s] = useStore();
    state = s;
    click = useCardClick(model);
    return null;
  }
  render(<AppServices ctx={createMockCtx(demoFixtures(), { latencyMs: 0 })}><StoreProvider><Probe /></StoreProvider></AppServices>);
  await click('customers', { removePaths: ['customers'] });
  expect(state.selection.martId).toBeNull();
});
