import { expect, test } from 'vitest';
import { EDGE, placeBeside } from './menuPlacement';

const row = { left: 200, top: 100, right: 300, bottom: 130 };

test.each([320, 360, 1100])('a 16rem-wide submenu stays inside a %spx viewport', (w) => {
  const size = { width: Math.min(256, w - 2 * EDGE), height: 200 };
  const p = placeBeside(row, size, { width: w, height: 700 });
  expect(p.left).toBeGreaterThanOrEqual(EDGE);
  expect(p.left + size.width).toBeLessThanOrEqual(w - EDGE);
});

test('a submenu with no room on the right opens to the left of its row', () => {
  const p = placeBeside(row, { width: 256, height: 200 }, { width: 400, height: 700 });
  expect(p.side).toBe('left');
});
