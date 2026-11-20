import { describe } from 'vitest';
import type { ColumnFilter } from '../filters/build';
import { HISTORY_LIMIT, initialState, reducer, type GridState, type State } from './store';

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
  const st = reducer(start, { type: 'openRecord', martId: 'a', pk: { id: 7 }, sourceOf });
  expect(st.selection).toEqual(sel({ martId: 'a', filters, record: { martId: 'a', pk: { id: 7 } } }));
  expect(st.history).toEqual([start.selection]);
  const other = reducer(start, { type: 'openRecord', martId: 'c', pk: { id: 7 }, sourceOf });
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

test('undo restores the previous selection, in order, and does nothing with no history', () => {
  let st = reducer(s(), { type: 'init', focusId: 'a' });
  st = reducer(st, { type: 'selectMart', id: 'b', sourceOf });
  st = reducer(st, { type: 'openRecord', martId: 'b', pk: { id: 1 }, sourceOf });
  st = reducer(st, { type: 'selectMart', id: 'c', sourceOf });
  st = reducer(st, { type: 'undo' });
  expect(st.selection).toEqual(sel({ martId: 'b', record: { martId: 'b', pk: { id: 1 } } }));
  st = reducer(st, { type: 'undo' });
  expect(st.selection).toEqual(sel({ martId: 'b' }));
  st = reducer(st, { type: 'undo' });
  expect(st.selection).toEqual(sel({ martId: 'a' }));
  expect(st.history).toEqual([]);
  expect(reducer(st, { type: 'undo' })).toBe(st);
});

test('follow into a filtered mart seeds its saved grid once, keeping its columns', () => {
  const filters = [{ field: 'order_id', op: 'eq' as const, value: 1 }];
  const start = s({ selection: sel({ martId: 'a' }), grids: { c: { columns: ['x'], filters: { y: { field: 'y', op: 'eq', value: 2 } }, sorts: [{ field: 'x', direction: 'desc' as const }], limit: 400 } } });
  const st = reducer(start, { type: 'follow', target: { kind: 'mart', martId: 'c', filters }, sourceOf });
  expect(st.grids.c).toEqual({ columns: ['x'], filters: { order_id: filters[0] }, sorts: [{ field: 'x', direction: 'desc' }], limit: 200 });
});

test('replace swaps the selection without a history entry', () => {
  const start = s({ selection: sel({ martId: 'gone' }), history: [sel({ martId: 'a' })] });
  const st = reducer(start, { type: 'replace', selection: sel({ martId: 'b' }) });
  expect(st.selection.martId).toBe('b');
  expect(st.history).toEqual(start.history);
});

test('undo skips history entries that name a mart or source that no longer exists', () => {
  const history = [sel({ martId: 'a' }), sel({ martId: 'gone' }), sel({ sourceKey: 'dead' })];
  const st = reducer(s({ selection: sel({ martId: 'b' }), history }), { type: 'undo', known: (x) => x.martId !== 'gone' && x.sourceKey !== 'dead' });
  expect(st.selection.martId).toBe('a');
  expect(st.history).toEqual([]);
  const none = reducer(s({ selection: sel({ martId: 'b' }), history: [sel({ martId: 'gone' })] }), { type: 'undo', known: () => false });
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
  const grid = { columns: ['id'], filters: {}, sorts: [], limit: 200 };
  let st = reducer(s(), { type: 'saveGrid', martId: 'a', grid });
  st = reducer(st, { type: 'saveGrid', martId: 'b', grid: { ...grid, limit: 400 } });
  expect(st.grids).toEqual({ a: grid, b: { ...grid, limit: 400 } });
  expect(reducer(st, { type: 'refreshModel' }).modelVersion).toBe(1);
});

describe('redo', () => {
  const nav = () => {
    let st = reducer(s(), { type: 'init', focusId: 'a' });
    st = reducer(st, { type: 'selectMart', id: 'b', sourceOf });
    st = reducer(st, { type: 'selectMart', id: 'c', sourceOf });
    return st;
  };

  test('undo pushes the current selection onto the forward stack; redo re-applies it, in order', () => {
    let st = reducer(nav(), { type: 'undo' });
    st = reducer(st, { type: 'undo' });
    expect(st.selection.martId).toBe('a');
    expect(st.future.map((x) => x.martId)).toEqual(['c', 'b']);
    st = reducer(st, { type: 'redo' });
    expect(st.selection.martId).toBe('b');
    st = reducer(st, { type: 'redo' });
    expect(st.selection.martId).toBe('c');
    expect(st.future).toEqual([]);
    expect(st.history.map((x) => x.martId)).toEqual(['a', 'b']);
    expect(reducer(st, { type: 'redo' })).toBe(st);
  });

  test('every kind of new navigation empties the forward stack', () => {
    const undone = reducer(nav(), { type: 'undo' });
    expect(undone.future).toHaveLength(1);
    const actions = [
      { type: 'selectMart', id: 'd', sourceOf },
      { type: 'selectSource', key: 'Shopify' },
      { type: 'openRecord', martId: 'b', pk: { id: 1 }, sourceOf },
      { type: 'follow', target: { kind: 'record', martId: 'd', pk: { id: 1 } }, sourceOf },
    ] as const;
    for (const a of actions) expect(reducer(undone, a).future).toEqual([]);
  });

  test('things that are not navigation keep the forward stack', () => {
    const undone = reducer(nav(), { type: 'undo' });
    for (const a of [{ type: 'search', q: 'x' }, { type: 'toggleContext', id: 'c1' }, { type: 'setStorages', ids: null }, { type: 'refreshModel' }, { type: 'replace', selection: sel({ martId: 'a' }) }] as const) {
      expect(reducer(undone, a).future).toEqual(undone.future);
    }
  });

  test('redo skips selections whose mart no longer exists, and the forward stack is capped at 20', () => {
    let st = s({ selection: sel({ martId: 'x' }), future: [sel({ martId: 'b' }), sel({ martId: 'gone' })] });
    st = reducer(st, { type: 'redo', known: (x) => x.martId !== 'gone' });
    expect(st.selection.martId).toBe('b');
    expect(st.future).toEqual([]);
    let long = reducer(s(), { type: 'init', focusId: 'm0' });
    for (let i = 1; i <= 25; i++) long = reducer(long, { type: 'selectMart', id: `m${i}`, sourceOf });
    for (let i = 0; i < 20; i++) long = reducer(long, { type: 'undo' });
    expect(long.future).toHaveLength(20);
    long = reducer(long, { type: 'undo' });
    expect(long.history).toEqual([]);
    expect(long.future).toHaveLength(20);
  });

  test('grids edited per mart are kept through undo and redo', () => {
    const grid = { columns: ['x'], filters: {}, sorts: [], limit: 200 };
    let st = reducer(nav(), { type: 'saveGrid', martId: 'c', grid });
    st = reducer(reducer(st, { type: 'undo' }), { type: 'redo' });
    expect(st.grids.c).toBe(grid);
  });
});

describe('setMarts: the main mart, its joined marts and their grid state change together', () => {
  const grid = (columns: string[]) => ({ columns, filters: {}, sorts: null, limit: 200 });
  const joined = (from: State) => reducer(from, { type: 'setMarts', selection: sel({ martId: 'a' }), grids: { a: grid(['id', 'b__x']) } });

  test('it sets the selection and the grid in one history step', () => {
    const start = s({ selection: sel({ martId: 'a' }), grids: { a: grid(['id']) } });
    const st = joined(start);
    expect(st.grids.a!.columns).toEqual(['id', 'b__x']);
    expect(st.history).toHaveLength(1);
    expect(st.history[0]).toMatchObject({ grids: { a: grid(['id']) } });
  });

  test('an op that changes nothing adds no history', () => {
    const start = s({ selection: sel({ martId: 'a' }), grids: { a: grid(['id', 'b__x']) } });
    expect(joined(start)).toBe(start);
  });

  test('undo puts the grid back, redo applies it again; a mart that had no grid goes back to none', () => {
    const start = s({ selection: sel({ martId: 'a' }) });
    const st = joined(start);
    const back = reducer(st, { type: 'undo' });
    expect(back.grids.a).toBeUndefined();
    expect(back.selection).toEqual(start.selection);
    expect(back.future[0]).toMatchObject({ martId: 'a', grids: { a: grid(['id', 'b__x']) } });
    const again = reducer(back, { type: 'redo' });
    expect(again.grids.a!.columns).toEqual(['id', 'b__x']);
    expect(again.selection).toEqual(sel({ martId: 'a' }));
  });

  test('promoting another mart to main restores both grids and the selection on undo', () => {
    const start = s({ selection: sel({ martId: 'a' }), grids: { a: grid(['id', 'b__x']) } });
    const st = reducer(start, { type: 'setMarts', selection: sel({ martId: 'b' }), grids: { b: grid(['id']) } });
    expect(st.selection.martId).toBe('b');
    const back = reducer(st, { type: 'undo' });
    expect(back.selection.martId).toBe('a');
    expect(back.grids.b).toBeUndefined();
    expect(back.grids.a!.columns).toEqual(['id', 'b__x']);
  });
});

test('applyView sets everything at once, with no history entry', () => {
  const grid = { columns: ['id'], filters: {}, sorts: null, limit: 200 };
  const other = { columns: ['x'], filters: {}, sorts: null, limit: 200 };
  const start = s({ selection: sel({ martId: 'a' }), history: [sel({ martId: 'd' })], future: [sel({ martId: 'c' })], grids: { z: other } });
  const next = reducer(start, { type: 'applyView', selection: sel({ sourceKey: 'Shopify', martId: 'b' }), grid, search: 'q', contextIds: ['c1'], storageIds: ['s1'] });
  expect(next.selection).toEqual(sel({ sourceKey: 'Shopify', martId: 'b' }));
  expect(next.search).toBe('q');
  expect(next.contextIds).toEqual(['c1']);
  expect(next.storageIds).toEqual(['s1']);
  expect(next.grids).toEqual({ z: other, b: grid });
  expect(next.history).toBe(start.history);
  expect(next.future).toBe(start.future);
});

test('applyView sets no grid without one or without a main mart', () => {
  const grid = { columns: ['id'], filters: {}, sorts: null, limit: 200 };
  const a = { type: 'applyView' as const, search: '', contextIds: [], storageIds: null };
  expect(reducer(s(), { ...a, selection: sel({ martId: 'b' }), grid: null }).grids).toEqual({});
  const none = reducer(s(), { ...a, selection: sel({ sourceKey: 'Shopify' }), grid });
  expect(none.grids).toEqual({});
  expect(none.selection).toEqual(sel({ sourceKey: 'Shopify' }));
  expect(reducer(s(), { ...a, selection: sel(), grid: null }).selection).toEqual(sel());
});

describe('smart search', () => {
  const grid = { columns: ['id', 'status'], filters: {}, sorts: null, limit: 200 };
  const start = () => s({ selection: sel({ martId: 'a' }) });
  const found = (st: State, extra: object = {}) => reducer(st, { type: 'smartFound', query: 'big orders', ids: ['b', 'a'], ...extra });

  test('smartFound keeps the query, the found marts in order, and the filter-by-title text out of the way', () => {
    const next = found(start());
    expect(next.search).toBe('big orders');
    expect(next.found).toEqual(['b', 'a']);
    expect(next.history).toEqual([]);
  });

  test('typing a title search, clearing, or opening a view link drops the found marts', () => {
    const base = found(start());
    expect(reducer(base, { type: 'search', q: 'x' }).found).toEqual([]);
    expect(reducer(base, { type: 'search', q: '' }).found).toEqual([]);
    expect(reducer(base, { type: 'applyView', selection: sel({ martId: 'a' }), grid: null, search: '', contextIds: [], storageIds: null }).found).toEqual([]);
  });

  test('the result is one Undo step: the new main mart and its grid come back out together', () => {
    const before = reducer(start(), { type: 'saveGrid', martId: 'a', grid });
    let st = found(before);
    st = reducer(st, { type: 'setMarts', selection: sel({ martId: 'b' }), grids: { b: { ...grid, filters: { status: { field: 'status', op: 'eq', value: 'paid' } } } } });
    expect(st.selection.martId).toBe('b');
    expect(st.history).toHaveLength(before.history.length + 1);
    const undone = reducer(st, { type: 'undo' });
    expect(undone.selection.martId).toBe('a');
    expect(undone.grids.b).toBeUndefined();
    expect(undone.grids.a).toEqual(grid);
    const redone = reducer(undone, { type: 'redo' });
    expect(redone.selection.martId).toBe('b');
    expect(redone.grids.b?.filters.status?.value).toBe('paid');
  });
});

describe('editGrid', () => {
  const grid = (over: Partial<GridState> = {}): GridState => ({ columns: ['a', 'b'], filters: {}, sorts: null, limit: 100, ...over });
  const filtered = grid({ filters: { a: { field: 'a', op: 'eq', value: '1' } as ColumnFilter } });
  const base = () => s({ selection: sel({ martId: 'a' }), grids: { a: grid() } });

  test('stores the grid and pushes the previous one as a step', () => {
    const st = reducer(base(), { type: 'editGrid', martId: 'a', grid: filtered });
    expect(st.grids.a).toBe(filtered);
    expect(st.history).toEqual([{ ...sel({ martId: 'a' }), grids: { a: grid() } }]);
    expect(st.future).toEqual([]);
  });

  test('an edit that changes nothing is no step, and a new edit empties Redo', () => {
    const st = base();
    expect(reducer(st, { type: 'editGrid', martId: 'a', grid: grid() })).toBe(st);
    const undone = reducer(reducer(st, { type: 'editGrid', martId: 'a', grid: filtered }), { type: 'undo' });
    expect(undone.future).toHaveLength(1);
    expect(reducer(undone, { type: 'editGrid', martId: 'a', grid: grid({ sorts: [] }) }).future).toEqual([]);
  });

  test('an edit that only reorders keys is no step', () => {
    const f = (o: object) => ({ a: { field: 'a', op: 'eq', value: '1', ...o } as ColumnFilter });
    const st = s({ selection: sel({ martId: 'a' }), grids: { a: { limit: 100, sorts: null, filters: f({}), columns: ['a', 'b'] } } });
    const same = { columns: ['a', 'b'], filters: { a: { value: '1', op: 'eq', field: 'a' } as ColumnFilter }, sorts: null, limit: 100 } as GridState;
    expect(reducer(st, { type: 'editGrid', martId: 'a', grid: same })).toBe(st);
    expect(reducer(st, { type: 'editGrid', martId: 'a', grid: { ...same, columns: ['b', 'a'] } })).not.toBe(st);
  });

  test('undo restores the previous grid and redo the new one', () => {
    const edited = reducer(base(), { type: 'editGrid', martId: 'a', grid: filtered });
    const undone = reducer(edited, { type: 'undo' });
    expect(undone.grids.a).toEqual(grid());
    expect(undone.history).toEqual([]);
    const redone = reducer(undone, { type: 'redo' });
    expect(redone.grids.a).toEqual(filtered);
    expect(redone.history).toHaveLength(1);
  });

  test('a mart with no grid yet goes back to none on undo', () => {
    const edited = reducer(s({ selection: sel({ martId: 'a' }) }), { type: 'editGrid', martId: 'a', grid: filtered });
    expect(reducer(edited, { type: 'undo' }).grids.a).toBeUndefined();
  });

  test('saveGrid stays out of the history', () => {
    expect(reducer(base(), { type: 'saveGrid', martId: 'a', grid: filtered }).history).toEqual([]);
  });

  test('history keeps at most HISTORY_LIMIT steps', () => {
    let st = base();
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) st = reducer(st, { type: 'editGrid', martId: 'a', grid: grid({ limit: 100 + i + 1 }) });
    expect(st.history).toHaveLength(HISTORY_LIMIT);
  });
});

describe('fillGrid: a late answer fills the grid only while nothing moved', () => {
  const grid = (columns: string[]) => ({ columns, filters: {}, sorts: null, limit: 200 });
  const start = () => s({ selection: sel({ martId: 'a' }), grids: { a: grid(['id']) } });

  test('it applies when the mart is still main and the grid is still the expected one, with no history entry', () => {
    const from = start();
    const st = reducer(from, { type: 'fillGrid', martId: 'a', expect: grid(['id']), grid: grid(['id', 'x']) });
    expect(st.grids.a).toEqual(grid(['id', 'x']));
    expect(st.history).toBe(from.history);
  });

  test('it is a no-op after the main mart changed', () => {
    const from = reducer(start(), { type: 'selectMart', id: 'b', sourceOf });
    expect(reducer(from, { type: 'fillGrid', martId: 'a', expect: grid(['id']), grid: grid(['id', 'x']) })).toBe(from);
  });

  test('it is a no-op after a grid edit', () => {
    const from = reducer(start(), { type: 'editGrid', martId: 'a', grid: grid(['id', 'y']) });
    expect(reducer(from, { type: 'fillGrid', martId: 'a', expect: grid(['id']), grid: grid(['id', 'x']) })).toBe(from);
  });

  test('it is a no-op after an Undo of the pick that started the wait', () => {
    const picked = reducer(start(), { type: 'setMarts', selection: sel({ martId: 'a' }), grids: { a: grid(['id']) }, always: true });
    const undone = reducer(picked, { type: 'undo' });
    expect(reducer(undone, { type: 'fillGrid', martId: 'a', expect: grid(['id']), grid: grid(['id', 'x']) })).toBe(undone);
  });

  test('setMarts with always pushes history even when nothing changed', () => {
    const from = start();
    const st = reducer(from, { type: 'setMarts', selection: sel({ martId: 'a' }), grids: { a: grid(['id']) }, always: true });
    expect(st.history).toHaveLength(1);
    expect(st.grids.a).toEqual(grid(['id']));
  });
});

test('a selection with its keys in another order is the same selection: no history step', () => {
  const start = s({ selection: { sourceKey: 'Shopify', martId: 'a', record: null } });
  const st = reducer(start, { type: 'replace', selection: { record: null, martId: 'a', sourceKey: 'Shopify' } });
  expect(reducer(st, { type: 'selectMart', id: 'a', sourceOf })).toBe(st);
  const reordered = { martId: 'a', record: null, sourceKey: 'Shopify' };
  expect(reducer(start, { type: 'setMarts', selection: reordered, grids: {} })).toBe(start);
});
