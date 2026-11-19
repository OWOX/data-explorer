import { expect, test } from 'vitest';
import { CARD_H, CARD_W } from './canvas-layout';
import { closestTarget } from './canvas-drag';

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
