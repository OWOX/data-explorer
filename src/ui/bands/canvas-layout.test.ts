import { expect, test } from 'vitest';
import type { JoinTree, TreeNode } from '../../state/join-tree';
import { CARD_H, CARD_W, COL_GAP, ROW_GAP, layoutTree } from './canvas-layout';

const tree = (entries: [string, string | null, string[]][]): JoinTree => ({ nodes: new Map(entries.map(([path, parent, children]) => [path, { path, martId: path || 'main', parent, children } as TreeNode])) });
const at = (r: ReturnType<typeof layoutTree>, p: string) => r.placed.find((x) => x.path === p)!;

test('the column is the depth in the tree', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', ['a.c']], ['a.c', 'a', []]]));
  expect([at(r, '').x, at(r, 'a').x, at(r, 'a.c').x]).toEqual([0, CARD_W + COL_GAP, 2 * (CARD_W + COL_GAP)]);
});

test('leaves stack and a parent is centred on its children', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', []], ['b', '', []]]));
  expect(at(r, 'a').y).toBe(0);
  expect(at(r, 'b').y).toBe(CARD_H + ROW_GAP);
  expect(at(r, '').y).toBe((CARD_H + ROW_GAP) / 2);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
  expect(r.width).toBe(2 * CARD_W + COL_GAP);
});

test('a lone main mart sits at the origin', () => {
  const r = layoutTree(tree([['', null, []]]));
  expect(r.placed).toEqual([{ path: '', x: 0, y: 0 }]);
  expect([r.width, r.height]).toEqual([CARD_W, CARD_H]);
});

test('ghosts take the next column after their parent, stacked from the parent row', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', []]]), { path: 'a', ids: ['g1', 'g2'] });
  expect(r.ghosts).toEqual([
    { id: 'g1', x: 2 * (CARD_W + COL_GAP), y: 0 },
    { id: 'g2', x: 2 * (CARD_W + COL_GAP), y: CARD_H + ROW_GAP },
  ]);
  expect(r.width).toBe(3 * CARD_W + 2 * COL_GAP);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
});
