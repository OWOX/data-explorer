import { initialState, reducer, type State } from './store';

const s = (patch: Partial<State> = {}): State => ({ ...initialState, ...patch });

test('openMart adds a tab, selects the mart and activates it; reopening activates without duplicating', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'b' });
  st = reducer(st, { type: 'openMart', martId: 'a' });
  expect(st.tabs.map((t) => t.id)).toEqual(['mart:a', 'mart:b']);
  expect(st.activeTabId).toBe('mart:a');
  expect(st.selectedId).toBe('a');
});

test('openMart with filters on an open tab replaces its initial filters', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'a', filters: [{ field: 'id', op: 'eq', value: 1 }] });
  expect(st.tabs[0]).toMatchObject({ initialFilters: [{ field: 'id', op: 'eq', value: 1 }] });
});

test('openRecord uses a stable id', () => {
  let st = reducer(s(), { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  st = reducer(st, { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  expect(st.tabs).toHaveLength(1);
  expect(st.tabs[0]!.kind).toBe('record');
});

test('closing the active tab activates the left neighbour, or the right if first', () => {
  let st = s();
  for (const m of ['a', 'b', 'c']) st = reducer(st, { type: 'openMart', martId: m });
  st = reducer(st, { type: 'activate', tabId: 'mart:b' });
  st = reducer(st, { type: 'close', tabId: 'mart:b' });
  expect(st.activeTabId).toBe('mart:a');
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st.activeTabId).toBe('mart:c');
  expect(st.selectedId).toBe('c');
});

test('closing the last tab leaves explore mode and clears the selection', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st).toMatchObject({ tabs: [], activeTabId: null, selectedId: null });
});

test('closing an inactive tab keeps the active one', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'b' });
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st.activeTabId).toBe('mart:b');
});

test('activating a record tab selects its mart', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  st = reducer(st, { type: 'activate', tabId: 'mart:a' });
  expect(st.selectedId).toBe('a');
});

test('search, contexts and refresh', () => {
  let st = reducer(s(), { type: 'search', q: 'ord' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  st = reducer(st, { type: 'toggleContext', id: 'c2' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  st = reducer(st, { type: 'refreshModel' });
  expect(st).toMatchObject({ search: 'ord', contextIds: ['c2'], modelVersion: 1 });
});
