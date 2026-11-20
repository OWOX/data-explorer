import { expect, test } from 'vitest';
import { rovingTarget } from './roving';

test('wraps by default and answers Home and End', () => {
  expect(rovingTarget('ArrowDown', 2, 3)).toBe(0);
  expect(rovingTarget('ArrowUp', 0, 3)).toBe(2);
  expect(rovingTarget('ArrowDown', 0, 3)).toBe(1);
  expect(rovingTarget('Home', 2, 3)).toBe(0);
  expect(rovingTarget('End', 0, 3)).toBe(2);
});

test('without wrap it clamps at the end and reports -1 above the first item', () => {
  expect(rovingTarget('ArrowDown', 2, 3, { wrap: false })).toBe(2);
  expect(rovingTarget('ArrowUp', 0, 3, { wrap: false })).toBe(-1);
});

test('other keys and empty lists give null', () => {
  expect(rovingTarget('a', 0, 3)).toBeNull();
  expect(rovingTarget('ArrowDown', 0, 0)).toBeNull();
});
