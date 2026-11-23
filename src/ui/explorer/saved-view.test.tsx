import { useEffect } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { GRID_COLUMNS_COLLECTION, SAVE_DEBOUNCE_MS } from '../../api/grid-columns';
import type { Ctx, TraverseOptions } from '../../sdk/types';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider, useStore, useServices, type GridState } from '../../state/store';
import { App } from '../App';

type Doc = { columns: string[]; at: string; gridView?: unknown };

function setup(doc: Doc | null, grid?: GridState) {
  const base = createMockCtx(demoFixtures(), { latencyMs: 0 });
  const queries: TraverseOptions[] = [];
  const real = base.owox.dataMarts.traverseData.bind(base.owox.dataMarts);
  const put = vi.fn();
  const ctx: Ctx = {
    ...base,
    owox: { ...base.owox, dataMarts: { ...base.owox.dataMarts, traverseData: (id, o) => { if (id === 'orders' && o.column && o.column.length > 1) queries.push(o); return real(id, o); } } },
    collections: <T,>(name: string) => {
      const c = base.collections<T>(name);
      return name === GRID_COLUMNS_COLLECTION ? { get: c.get, put: (id: string, d: T) => { put(id, d); return c.put(id, d); } } : c;
    },
  };
  const seeded = doc ? base.collections<Doc>(GRID_COLUMNS_COLLECTION).put('orders', doc) : Promise.resolve();
  const services: { current: ReturnType<typeof useServices> | null } = { current: null };
  function Probe() {
    const [, dispatch] = useStore();
    services.current = useServices();
    useEffect(() => { if (grid) dispatch({ type: 'saveGrid', martId: 'orders', grid }); }, [dispatch]);
    return null;
  }
  const view = () => render(<AppServices ctx={ctx}><StoreProvider><Probe /><App /></StoreProvider></AppServices>);
  return { queries, put, seeded, view, services };
}

const data = () => document.getElementById('band-data')!;
const headers = () => within(data()).getAllByRole('columnheader').filter((h) => !h.hasAttribute('aria-hidden') && h.getAttribute('scope') !== 'colgroup').map((h) => h.textContent);
const lastQuery = (t: ReturnType<typeof setup>) => t.queries[t.queries.length - 1]!;

const stored: Doc = {
  columns: ['id', 'status', 'amount'], at: 'then',
  gridView: { fl: [['status', 'eq', 'paid', null, 1]], s: [['amount', -1]], l: 400 },
};

test('a saved view seeds the first rows query: filter, sort and limit', async () => {
  const t = setup(stored);
  await t.seeded;
  t.view();
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  const q = t.queries[0]!;
  expect(q.filter).toEqual([expect.objectContaining({ column: 'status', operator: 'eq' })]);
  expect(q.sort?.[0]).toEqual({ column: 'amount', direction: 'desc' });
  expect(q.limit).toBe(401);
  expect(t.queries.every((x) => x.filter?.length === 1)).toBe(true);
  // Reading what was saved is not a change.
  await new Promise((r) => setTimeout(r, SAVE_DEBOUNCE_MS + 100));
  expect(t.put).not.toHaveBeenCalled();
});

test('rules and sorts on columns the mart no longer has are dropped', async () => {
  const t = setup({ columns: ['id', 'status'], at: 'then', gridView: { fl: [['gone', 'eq', 'x'], ['status', 'eq', 'paid']], sl: [['customers__gone', 'eq', 'x']], s: [['gone', 1]], l: 200 } });
  await t.seeded;
  t.view();
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  for (const q of t.queries) {
    expect(q.filter).toEqual([expect.objectContaining({ column: 'status' })]);
    expect(JSON.stringify(q.sort ?? [])).not.toContain('gone');
  }
});

test('the grid the page holds (a view link) wins over the saved view', async () => {
  const link: GridState = { columns: ['id', 'status'], filters: { status: { field: 'status', op: 'eq', value: 'shipped' } }, sorts: null, limit: 200 };
  const t = setup(stored, link);
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(2));
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  expect(JSON.stringify(lastQuery(t).filter)).toContain('shipped');
  expect(JSON.stringify(lastQuery(t).filter)).not.toContain('paid');
  expect(lastQuery(t).sort ?? []).not.toEqual([{ column: 'amount', direction: 'desc' }]);
  expect(lastQuery(t).limit).toBe(201);
});

test('a change in the grid is saved with the view', async () => {
  const t = setup({ columns: ['id', 'status', 'amount'], at: 'then' });
  await t.seeded;
  t.view();
  await waitFor(() => expect(headers()).toHaveLength(3));
  expect(t.put).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: /Sort by Amount/ }));
  await waitFor(() => expect(t.put).toHaveBeenCalledTimes(1), { timeout: SAVE_DEBOUNCE_MS + 1500 });
  const doc = t.put.mock.calls[0]![1] as Doc;
  expect(doc.columns).toEqual(['id', 'status', 'amount']);
  expect(doc.gridView).toEqual(expect.objectContaining({ s: [['amount', 1]] }));
});

test('a saved rule on a field that is not a column survives a reload: it is sent without the column', async () => {
  const t = setup({ columns: ['id', 'amount'], at: 'then', gridView: { fl: [['status', 'eq', 'paid', null, 1]], s: null, l: 200 } });
  await t.seeded;
  t.view();
  await waitFor(() => expect(t.queries.length).toBeGreaterThan(0));
  for (const q of t.queries) {
    expect(q.filter).toEqual([expect.objectContaining({ column: 'status', operator: 'eq' })]);
    expect(q.column).not.toContain('status');
  }
});
