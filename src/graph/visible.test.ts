import { computeVisible, expandLevels, inboundCounts, neighbours, pickFocus } from './visible';
import type { Edge, Mart, Model } from '../model/types';

const e = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target, joins: [] });
const mart = (id: string, extra: Partial<Mart> = {}): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey: null, ...extra });
const modelOf = (ids: string[], edges: Edge[]): Model => ({ marts: new Map(ids.map((i) => [i, mart(i)])), sources: [], edges, contexts: [], failedStorages: [] });

test('inboundCounts counts targets', () => {
  expect(inboundCounts([e('a', 'b'), e('c', 'b'), e('b', 'd')])).toEqual(new Map([['b', 2], ['d', 1]]));
});

test('pickFocus picks the most inbound, ties by title', () => {
  const marts = new Map([['x', mart('x', { title: 'Zeta' })], ['y', mart('y', { title: 'Alpha' })]]);
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 1], ['y', 1]]))).toBe('y');
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 2]]))).toBe('x');
  expect(pickFocus([], marts, new Map())).toBeNull();
});

test('expandLevels adds whole levels while the total stays within budget', () => {
  // f has 3 neighbours (level 1); each has 2 more (level 2 = 6) → 1+3+6 = 10 ≤ 12; level 3 has 5 → 15 > 12
  const edges = [e('a', 'f'), e('b', 'f'), e('f', 'c'),
    e('a1', 'a'), e('a2', 'a'), e('b1', 'b'), e('b2', 'b'), e('c', 'c1'), e('c', 'c2'),
    e('x1', 'a1'), e('x2', 'a1'), e('x3', 'b1'), e('x4', 'c1'), e('x5', 'c2')];
  const ids = expandLevels('f', edges, 12);
  expect(new Set(ids)).toEqual(new Set(['f', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2']));
});

test('expandLevels always shows level 1 in full, even past the budget', () => {
  const edges = Array.from({ length: 15 }, (_, i) => e(`n${i}`, 'hub'));
  expect(expandLevels('hub', edges, 12)).toHaveLength(16);
});

test('expandLevels on an isolated mart returns just the mart', () => {
  expect(expandLevels('solo', [], 12)).toEqual(['solo']);
});

test('neighbours returns inbound and outbound, without duplicates', () => {
  expect(new Set(neighbours('b', [e('a', 'b'), e('b', 'c'), e('a', 'b')]))).toEqual(new Set(['a', 'c']));
});

test('computeVisible: no selection, no filters → levels from the focus', () => {
  const r = computeVisible({ model: modelOf(['a', 'b', 'c', 'z'], [e('a', 'b'), e('c', 'b')]), selectedId: null, search: '', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('levels');
  expect(r.focusId).toBe('b');
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c']));
});

test('computeVisible: selection shows the selected mart and all direct neighbours, no cap', () => {
  const edges = Array.from({ length: 20 }, (_, i) => e(`n${i}`, 'hub'));
  const ids = ['hub', ...edges.map((x) => x.source)];
  const r = computeVisible({ model: modelOf(ids, edges), selectedId: 'n3', search: '', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('selected');
  expect(new Set(r.ids)).toEqual(new Set(['n3', 'hub']));
});

test('computeVisible: search narrows to matches capped at 12 by inbound count', () => {
  const ids = Array.from({ length: 15 }, (_, i) => `sales${i}`);
  const edges = [e('sales1', 'sales0'), e('sales2', 'sales0')];
  const r = computeVisible({ model: modelOf([...ids, 'other'], edges), selectedId: null, search: 'SALES', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('filtered');
  expect(r.ids).toHaveLength(12);
  expect(r.ids[0]).toBe('sales0');
  expect(r.hiddenMatches).toBe(3);
});

test('computeVisible: a search with no matches is empty, not the default view', () => {
  const r = computeVisible({ model: modelOf(['a', 'b'], [e('a', 'b')]), selectedId: null, search: 'nope', contextIds: [], schemas: () => undefined });
  expect(r).toMatchObject({ mode: 'empty', ids: [], hiddenMatches: 0 });
});

test('computeVisible: selection wins over filters', () => {
  const r = computeVisible({ model: modelOf(['a', 'b'], [e('a', 'b')]), selectedId: 'a', search: 'zzz', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('selected');
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b']));
});

test('computeVisible: default view fills up to 12 from other connected groups, never isolated marts', () => {
  const small = ['a', 'b', 'c', 'd', 'e'];
  const big = Array.from({ length: 8 }, (_, i) => `g${i}`);
  const edges = [...small.map((x) => e(x, 'hub')), ...big.map((x) => e(x, 'h2'))];
  const ids = ['hub', 'h2', ...small, ...big, 'solo1', 'solo2'];
  const r = computeVisible({ model: modelOf(ids, edges), selectedId: null, search: '', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('levels');
  expect(r.focusId).toBe('h2');
  expect(r.ids).toHaveLength(12);
  expect(r.ids).toContain('hub');
  expect(r.ids).not.toContain('solo1');
  expect(r.ids).not.toContain('solo2');
  // 15 connected marts in total, 12 shown
  expect(r.hiddenMatches).toBe(3);
});

test('computeVisible: a small connected model has no hidden matches and keeps isolated marts out', () => {
  const r = computeVisible({ model: modelOf(['a', 'b', 'c', 'd', 'solo'], [e('a', 'b'), e('c', 'd')]), selectedId: null, search: '', contextIds: [], schemas: () => undefined });
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c', 'd']));
  expect(r.hiddenMatches).toBe(0);
});
