import { runPool } from './pool';

test('runPool never exceeds the limit and keeps result order', async () => {
  let active = 0;
  let peak = 0;
  const out = await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 2;
  });
  expect(peak).toBeLessThanOrEqual(3);
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
});

test('runPool records a rejection as an Error without stopping the others', async () => {
  const out = await runPool([1, 2], 2, async (n) => { if (n === 1) throw new Error('x'); return n; });
  expect(out[0]).toBeInstanceOf(Error);
  expect(out[1]).toBe(2);
});
