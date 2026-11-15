import { initialState, reducer, type State } from './store';

const s = (patch: Partial<State> = {}): State => ({ ...initialState, ...patch });
const feeds: Record<string, string | null> = { a: 'Shopify', b: 'Shopify', c: 'GA4', d: null };
const sourceOf = (id: string) => feeds[id] ?? null;
const sel = (patch: Partial<State['selection']> = {}) => ({ sourceKey: null, martId: null, record: null, ...patch });

test('the initial selection is empty', () => {
  expect(initialState.selection).toEqual({ sourceKey: null, martId: null, record: null });
  expect(initialState.history).toEqual([]);
});

test('init selects the focus mart only when none is selected, and leaves no history', () => {
  const st = reducer(s(), { type: 'init', focusId: 'a' });
  expect(st.selection.martId).toBe('a');
  expect(st.history).toEqual([]);
  expect(reducer(st, { type: 'init', focusId: 'b' })).toBe(st);
});

test('selectSource toggles, clears the mart and the record, and pushes history', () => {
  const start = s({ selection: sel({ martId: 'a', record: { martId: 'a', pk: { id: 1 } } }) });
  const on = reducer(start, { type: 'selectSource', key: 'Shopify' });
  expect(on.selection).toEqual(sel({ sourceKey: 'Shopify' }));
  expect(on.history).toEqual([start.selection]);
  const off = reducer(on, { type: 'selectSource', key: 'Shopify' });
  expect(off.selection).toEqual(sel());
  expect(off.history).toHaveLength(2);
  expect(reducer(on, { type: 'selectSource', key: null }).selection).toEqual(sel());
});

test('selectMart keeps the source only when it feeds the mart, and clears the record', () => {
  const start = s({ selection: sel({ sourceKey: 'Shopify', martId: 'a', record: { martId: 'a', pk: { id: 1 } } }) });
  const kept = reducer(start, { type: 'selectMart', id: 'b', sourceOf });
  expect(kept.selection).toEqual(sel({ sourceKey: 'Shopify', martId: 'b' }));
  expect(kept.history).toEqual([start.selection]);
  expect(reducer(start, { type: 'selectMart', id: 'c', sourceOf }).selection).toEqual(sel({ martId: 'c' }));
  expect(reducer(start, { type: 'selectMart', id: 'd', sourceOf }).selection.sourceKey).toBeNull();
});

test('selecting what is already selected changes nothing and adds no history', () => {
  const start = s({ selection: sel({ martId: 'a' }) });
  expect(reducer(start, { type: 'selectMart', id: 'a', sourceOf })).toBe(start);
});

test('openRecord sets the mart and the record, keeping the grid filters of the same mart', () => {
  const filters = [{ field: 'id', op: 'eq' as const, value: 1 }];
  const start = s({ selection: sel({ martId: 'a', filters }) });
  const st = reducer(start, { type: 'openRecord', martId: 'a', pk: { id: 7 } });
  expect(st.selection).toEqual(sel({ martId: 'a', filters, record: { martId: 'a', pk: { id: 7 } } }));
  expect(st.history).toEqual([start.selection]);
  const other = reducer(start, { type: 'openRecord', martId: 'c', pk: { id: 7 } });
  expect(other.selection).toEqual(sel({ martId: 'c', record: { martId: 'c', pk: { id: 7 } } }));
});

test('follow a record target selects its mart and opens the record in one step', () => {
  const start = s({ selection: sel({ sourceKey: 'Shopify', martId: 'a' }) });
  const st = reducer(start, { type: 'follow', target: { kind: 'record', martId: 'b', pk: { id: 3 } }, sourceOf });
  expect(st.selection).toEqual(sel({ sourceKey: 'Shopify', martId: 'b', record: { martId: 'b', pk: { id: 3 } } }));
  expect(st.history).toEqual([start.selection]);
});

test('follow a filtered mart selects it with the filters and clears the record', () => {
  const filters = [{ field: 'order_id', op: 'eq' as const, value: 1 }];
  const start = s({ selection: sel({ martId: 'a', record: { martId: 'a', pk: { id: 1 } } }) });
  const st = reducer(start, { type: 'follow', target: { kind: 'mart', martId: 'c', filters }, sourceOf });
  expect(st.selection).toEqual(sel({ martId: 'c', filters }));
  expect(st.history).toEqual([start.selection]);
});

test('back restores the previous selection, in order, and does nothing with no history', () => {
  let st = reducer(s(), { type: 'init', focusId: 'a' });
  st = reducer(st, { type: 'selectMart', id: 'b', sourceOf });
  st = reducer(st, { type: 'openRecord', martId: 'b', pk: { id: 1 } });
  st = reducer(st, { type: 'selectMart', id: 'c', sourceOf });
  st = reducer(st, { type: 'back' });
  expect(st.selection).toEqual(sel({ martId: 'b', record: { martId: 'b', pk: { id: 1 } } }));
  st = reducer(st, { type: 'back' });
  expect(st.selection).toEqual(sel({ martId: 'b' }));
  st = reducer(st, { type: 'back' });
  expect(st.selection).toEqual(sel({ martId: 'a' }));
  expect(st.history).toEqual([]);
  expect(reducer(st, { type: 'back' })).toBe(st);
});

test('follow into a filtered mart seeds its saved grid once, keeping its columns', () => {
  const filters = [{ field: 'order_id', op: 'eq' as const, value: 1 }];
  const start = s({ selection: sel({ martId: 'a' }), grids: { c: { columns: ['x'], filters: { y: { field: 'y', op: 'eq', value: 2 } }, limit: 400 } } });
  const st = reducer(start, { type: 'follow', target: { kind: 'mart', martId: 'c', filters }, sourceOf });
  expect(st.grids.c).toEqual({ columns: ['x'], filters: { order_id: filters[0] }, limit: 200 });
});

test('replace swaps the selection without a history entry', () => {
  const start = s({ selection: sel({ martId: 'gone' }), history: [sel({ martId: 'a' })] });
  const st = reducer(start, { type: 'replace', selection: sel({ martId: 'b' }) });
  expect(st.selection.martId).toBe('b');
  expect(st.history).toEqual(start.history);
});

test('back skips history entries that name a mart or source that no longer exists', () => {
  const history = [sel({ martId: 'a' }), sel({ martId: 'gone' }), sel({ sourceKey: 'dead' })];
  const st = reducer(s({ selection: sel({ martId: 'b' }), history }), { type: 'back', known: (x) => x.martId !== 'gone' && x.sourceKey !== 'dead' });
  expect(st.selection.martId).toBe('a');
  expect(st.history).toEqual([]);
  const none = reducer(s({ selection: sel({ martId: 'b' }), history: [sel({ martId: 'gone' })] }), { type: 'back', known: () => false });
  expect(none.selection.martId).toBe('b');
  expect(none.history).toEqual([]);
});

test('history keeps the last 20 selections and drops the oldest', () => {
  let st = reducer(s(), { type: 'init', focusId: 'm0' });
  for (let i = 1; i <= 25; i++) st = reducer(st, { type: 'selectMart', id: `m${i}`, sourceOf });
  expect(st.history).toHaveLength(20);
  expect(st.history[0]!.martId).toBe('m5');
  expect(st.history.at(-1)!.martId).toBe('m24');
});

test('search and context toggles keep the selection and the history', () => {
  const start = s({ selection: sel({ martId: 'a' }), history: [sel({ martId: 'z' })] });
  let st = reducer(start, { type: 'search', q: 'ord' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  st = reducer(st, { type: 'toggleContext', id: 'c2' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  expect(st).toMatchObject({ search: 'ord', contextIds: ['c2'], selection: start.selection, history: start.history });
});

test('saveGrid keeps one state per mart; refreshModel bumps the version', () => {
  const grid = { columns: ['id'], filters: {}, limit: 200 };
  let st = reducer(s(), { type: 'saveGrid', martId: 'a', grid });
  st = reducer(st, { type: 'saveGrid', martId: 'b', grid: { ...grid, limit: 400 } });
  expect(st.grids).toEqual({ a: grid, b: { ...grid, limit: 400 } });
  expect(reducer(st, { type: 'refreshModel' }).modelVersion).toBe(1);
});
