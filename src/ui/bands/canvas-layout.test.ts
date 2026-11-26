import { expect, test } from 'vitest';
import type { JoinTree, TreeNode } from '../../state/join-tree';
import { CARD_H, CARD_W, COL_GAP, ROW_GAP, layoutTree } from './canvas-layout';

const tree = (entries: [string, string | null, string[]][]): JoinTree => ({ nodes: new Map(entries.map(([path, parent, children]) => [path, { path, martId: path || 'main', parent, children } as TreeNode])) });
const at = (r: ReturnType<typeof layoutTree>, p: string) => r.placed.find((x) => x.path === p)!;

test('the column is the depth in the tree', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', ['a.c']], ['a.c', 'a', []]]));
  expect([at(r, '').x, at(r, 'a').x, at(r, 'a.c').x]).toEqual([0, CARD_W + COL_GAP, 2 * (CARD_W + COL_GAP)]);
});

test('leaves stack, and the main mart sits top left, not centred on its children', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', []], ['b', '', []]]));
  expect(at(r, 'a').y).toBe(0);
  expect(at(r, 'b').y).toBe(CARD_H + ROW_GAP);
  expect(at(r, '').y).toBe(0);
  expect(at(r, '').x).toBe(0);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
  expect(r.width).toBe(2 * CARD_W + COL_GAP);
});

test('a lone main mart sits at the origin', () => {
  const r = layoutTree(tree([['', null, []]]));
  expect(r.placed).toEqual([{ path: '', x: 0, y: 0 }]);
  expect([r.width, r.height]).toEqual([CARD_W, CARD_H]);
});

test('ghosts take the next column after their parent, stacked from the parent row', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', []]]), [{ path: 'a', ids: ['g1', 'g2'] }]);
  expect(r.ghosts).toEqual([
    { id: 'g1', x: 2 * (CARD_W + COL_GAP), y: 0 },
    { id: 'g2', x: 2 * (CARD_W + COL_GAP), y: CARD_H + ROW_GAP },
  ]);
  expect(r.width).toBe(3 * CARD_W + 2 * COL_GAP);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
});

test('ghosts of a parent with children go below its real children', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', []], ['b', '', []]]), [{ path: '', ids: ['g1'] }]);
  expect(r.ghosts).toEqual([{ id: 'g1', x: CARD_W + COL_GAP, y: 2 * (CARD_H + ROW_GAP) }]);
  expect(r.height).toBe(3 * CARD_H + 2 * ROW_GAP);
});

test('ghosts of a leaf go below a cousin in the same column', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', []], ['b', '', ['b.x', 'b.y']], ['b.x', 'b', []], ['b.y', 'b', []]]), [{ path: 'a', ids: ['g'] }]);
  expect(r.ghosts).toEqual([{ id: 'g', x: 2 * (CARD_W + COL_GAP), y: 3 * (CARD_H + ROW_GAP) }]);
  expect(r.ghosts[0]!.y).toBeGreaterThan(at(r, 'b.y').y);
});

test('a joined parent whose first child is itself a parent is centred on fractional rows', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', ['a.x', 'a.y']], ['a.x', 'a', []], ['a.y', 'a', []], ['b', '', []]]));
  expect(at(r, 'a').y).toBe(0.5 * (CARD_H + ROW_GAP));
  expect(at(r, 'b').y).toBe(2 * (CARD_H + ROW_GAP));
  expect(at(r, '').y).toBe(0);
});

test('an unknown extra path or empty ids adds no ghosts', () => {
  const t = tree([['', null, ['a']], ['a', '', []]]);
  expect(layoutTree(t, [{ path: 'nope', ids: ['g'] }]).ghosts).toEqual([]);
  const r = layoutTree(t, [{ path: 'a', ids: [] }]);
  expect(r.ghosts).toEqual([]);
  expect(r.width).toBe(2 * CARD_W + COL_GAP);
});

test('a second column of ghosts hangs from a ghost of the first, in the column after it', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', []]]), [{ path: 'a', ids: ['g1', 'g2'] }, { path: 'g2', ids: ['h1'] }]);
  expect(r.ghosts.at(-1)).toEqual({ id: 'h1', x: 3 * (CARD_W + COL_GAP), y: CARD_H + ROW_GAP });
  expect(r.width).toBe(4 * CARD_W + 3 * COL_GAP);
});
