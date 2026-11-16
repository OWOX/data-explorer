import { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Ctx } from '../sdk/types';
import { SAVE_DEBOUNCE_MS } from '../api/grid-columns';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, type GridState, type State } from '../state/store';
import { decodeViewLink, encodeViewLink } from '../state/view-link';
import { App } from './App';

const box: { latest: State } = { latest: undefined as never };
function Probe() {
  const [s] = useStore();
  useEffect(() => { box.latest = s; });
  return null;
}

const grid: GridState = {
  columns: ['id', 'status', 'customers__name'],
  filters: { status: { field: 'status', op: 'eq', value: 'paid' } },
  sorts: [{ field: 'id', direction: 'desc' }],
  limit: 400,
};
const view = { sourceKey: null, martId: 'orders', record: null, search: '', contextIds: [], storageIds: null, folded: { sources: true, marts: false, data: false, row: false }, grid };

function setup(route: string | undefined, copyLink?: (p?: string) => Promise<void>, failFirstBlendable = false) {
  const real = createMockCtx(demoFixtures(), { latencyMs: 0 });
  let blends = 0;
  const base: Ctx = failFirstBlendable ? { ...real, owox: { ...real.owox, getJson: (async (path: string, q?: Record<string, string>) => {
    if (path.endsWith('/blendable-schema')) {
      // The resolver's read fails; later reads are slow, so the grid mounts before the joined marts are cached.
      if (blends++ === 0) throw new Error('boom');
      await new Promise((r) => setTimeout(r, 150));
    }
    return real.owox.getJson(path, q);
  }) as Ctx['owox']['getJson'] } } : real;
  const puts: string[] = [];
  const ctx: Ctx = {
    ...base,
    route,
    ui: { ...base.ui, copyLink },
    collections: <T,>(name: string) => {
      const c = base.collections<T>(name);
      return { get: (id: string) => c.get(id), put: (id: string, d: T) => { if (name === 'grid-columns' || name === 'preferences') puts.push(`${name}/${id}`); return c.put(id, d); } };
    },
  };
  render(<AppServices ctx={ctx}><StoreProvider><App /><Probe /></StoreProvider></AppServices>);
  return { puts };
}
const loaded = () => waitFor(() => expect(document.querySelector('.dm-loadbar')).toBeNull());

describe('opening a view link', () => {
  test('restores the mart and the grid without writing preferences', async () => {
    const { puts } = setup(await encodeViewLink(view));
    await loaded();
    await waitFor(() => expect(box.latest.selection.martId).toBe('orders'));
    expect(box.latest.grids['orders']).toEqual(grid);
    await new Promise((r) => setTimeout(r, 200));
    expect(puts).toEqual([]);
    expect(box.latest.history).toEqual([]);
  });

  test('link folds win over the defaults and nothing is saved', async () => {
    const { puts } = setup(await encodeViewLink({ ...view, folded: { sources: false, marts: true, data: false, row: true } }));
    await loaded();
    const expanded = (id: string) => document.getElementById(id)!.querySelector('[aria-expanded]')!.getAttribute('aria-expanded');
    await waitFor(() => expect(expanded('band-marts')).toBe('false'));
    expect(expanded('band-sources')).toBe('true');
    expect(expanded('band-row')).toBe('false');
    expect(puts).toEqual([]);
  });

  test('an unknown mart shows the notice and falls back to the first-load pick', async () => {
    setup(await encodeViewLink({ ...view, martId: 'gone', grid: null }));
    expect(await screen.findByRole('status')).toHaveTextContent("Some parts of this link aren't available to you: the data mart.");
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(box.latest.selection.martId).not.toBe('gone');
  });

  test('columns the member cannot see are pruned and counted', async () => {
    setup(await encodeViewLink({ ...view, grid: { ...grid, columns: ['id', 'nope', 'customers__name'] } }));
    expect(await screen.findByRole('status')).toHaveTextContent('1 column');
    await waitFor(() => expect(box.latest.grids['orders']?.columns).toEqual(['id', 'customers__name']));
  });

  test('a link column the schema lacks never rewrites saved columns, even when the resolver read failed', async () => {
    const { puts } = setup(await encodeViewLink({ ...view, grid: { ...grid, columns: ['id', 'nope', 'customers__name'] } }), undefined, true);
    await loaded();
    await waitFor(() => expect(box.latest.selection.martId).toBe('orders'));
    await screen.findByRole('table');
    // The column store saves after a debounce.
    await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 300));
    expect(puts).toEqual([]);
  });

  test('an unreadable link shows the unreadable notice', async () => {
    setup('/v?s=%%%');
    expect(await screen.findByRole('status')).toHaveTextContent("This link couldn't be read. Showing the default view.");
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
  });

  test('a notice can be dismissed', async () => {
    setup('/v?s=%%%');
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  test('a plain route opens normally with no notice', async () => {
    setup('/');
    await loaded();
    await waitFor(() => expect(box.latest.selection.martId).not.toBeNull());
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('copying a link', () => {
  test('copies a route that decodes back to the current view', async () => {
    const copied: string[] = [];
    setup(await encodeViewLink(view), async (p) => { copied.push(p!); });
    await loaded();
    await waitFor(() => expect(box.latest.grids['orders']).toBeDefined());
    await userEvent.click(await screen.findByRole('button', { name: 'Copy link to this view' }));
    await waitFor(() => expect(copied).toHaveLength(1));
    const back = await decodeViewLink(copied[0]);
    expect(back).toMatchObject({ martId: 'orders', grid, record: null, dropped: 0 });
    expect(back).toMatchObject({ folded: view.folded });
  });

  test('a rejected copy shows a notice', async () => {
    setup('/', async () => { throw new Error('no'); });
    await userEvent.click(await screen.findByRole('button', { name: 'Copy link to this view' }));
    expect(await screen.findByRole('status')).toHaveTextContent("The link couldn't be copied.");
  });

  test('no chain button without a route', async () => {
    setup(undefined, async () => {});
    await loaded();
    expect(screen.queryByRole('button', { name: 'Copy link to this view' })).toBeNull();
  });
});
