import { expect, test } from 'vitest';
import { CARD_H, CARD_W } from './canvas-layout';
import { buildJoinTree } from '../../state/join-tree';
import type { JoinedSource } from '../../api/blendable';
import { boxLinePath, closestTarget, dragLinePath, dropTargets } from './canvas-drag';

const t = (target: string) => ({ target, moves: new Map([['a.c', `${target}.c`]]) });
const placed = [{ path: 'a', x: 0, y: 0 }, { path: 'b', x: 0, y: 300 }, { path: '', x: -400, y: 150 }];

test('picks the target whose centre is closest', () => {
  expect(closestTarget([t('a'), t('b')], placed, CARD_W / 2, 280)!.target).toBe('b');
  expect(closestTarget([t('a'), t('b')], placed, CARD_W / 2, CARD_H / 2)!.target).toBe('a');
});

test('no targets, no pick', () => {
  expect(closestTarget([], placed, 0, 0)).toBeNull();
});

test('a target with no placed card is ignored', () => {
  expect(closestTarget([t('zzz')], placed, 0, 0)).toBeNull();
});

test('dropTargets adds the current parent once, with no moves; the main mart has no parent entry', () => {
  const src = (aliasPath: string, martId: string, depth: number, field: string) => ({ aliasPath, martId, depth, label: martId, uniqueCount: true, fields: [{ name: field }] }) as unknown as JoinedSource;
  const sources = [src('c', 'customers', 1, 'c__x'), src('c.k', 'countries', 2, 'c__k__y')];
  const tree = buildJoinTree('orders', ['c__x', 'c__k__y'], sources);
  const own = dropTargets(tree, sources, 'c.k').filter((t) => t.target === 'c');
  expect(own).toHaveLength(1);
  expect(dropTargets(tree, sources, '').some((t) => t.target === null)).toBe(false);
});

test('a drag line leaves the held card on the side that faces the target and ends on the target edge', () => {
  const held = { path: 'a', x: 352, y: 0 };
  expect(dragLinePath(held, { path: 'b', x: 704, y: 144 })).toMatch(/^M576 56 .* 704 200$/);
  expect(dragLinePath(held, { path: 'c', x: 0, y: 0 })).toMatch(/^M352 56 .* 224 56$/);
});

test('a line over a row of cards never peaks higher than the room given, however far the target', () => {
  const from = { x: 0, y: 100, w: 200, h: 100 };
  // The peak of the curve is at 3/4 of the control height above the card tops.
  const peak = (d: string) => 100 - (100 - Number(d.match(/C\S+ (\S+) /)![1])) * 0.75;
  for (const far of [1, 2, 4, 8, 20]) {
    const d = boxLinePath(from, { ...from, x: far * 220 }, 40);
    expect(100 - peak(d)).toBeLessThanOrEqual(40.001);
  }
  // A near target arcs lower than a far one, so the two lines do not lie on each other.
  const rise = (far: number) => 100 - Number(boxLinePath(from, { ...from, x: far * 220 }, 40).match(/C\S+ (\S+) /)![1]);
  expect(rise(1)).toBeLessThan(rise(4));
  // Little room above the row: the arc stays within it.
  expect(100 - peak(boxLinePath(from, { ...from, x: 880 }, 10))).toBeLessThanOrEqual(10.001);
});
