import { describe, expect, test } from 'vitest';
import { clampGhost, dropSlot } from './ColumnDrag';

const others = [{ left: 0, right: 100 }, { left: 100, right: 200 }, { left: 200, right: 300 }];

describe('dropSlot', () => {
  test('is the gap before the first column whose middle is right of the pointer', () => {
    expect(dropSlot(others, 10)).toBe(0);
    expect(dropSlot(others, 60)).toBe(1);
    expect(dropSlot(others, 160)).toBe(2);
  });
  test('clamps to the group edges when the pointer is far outside', () => {
    expect(dropSlot(others, -500)).toBe(0);
    expect(dropSlot(others, 5000)).toBe(3);
  });
});

describe('clampGhost', () => {
  test('follows the pointer inside the group', () => {
    expect(clampGhost(150, 20, 80, 0, 400)).toBe(130);
  });
  test('stops at the group edges', () => {
    expect(clampGhost(-50, 20, 80, 0, 400)).toBe(0);
    expect(clampGhost(900, 20, 80, 0, 400)).toBe(320);
  });
});
