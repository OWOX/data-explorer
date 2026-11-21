import { niceTicks } from './ticks';

test('a count of 73 steps by 20, not into thirds', () => {
  expect(niceTicks(73, { integer: true })).toEqual({ ticks: [0, 20, 40, 60, 80], top: 80 });
});

test('a whole-number measure never steps below 1, and its ticks are whole', () => {
  expect(niceTicks(3, { integer: true }).ticks).toEqual([0, 1, 2, 3]);
  expect(niceTicks(1, { integer: true }).ticks).toEqual([0, 1]);
  expect(niceTicks(0, { integer: true }).ticks).toEqual([0, 1]);
  for (const hi of [2, 7, 24, 73, 1234, 99999]) expect(niceTicks(hi, { integer: true }).ticks.every(Number.isInteger)).toBe(true);
});

test('a fractional measure gets a 1, 2 or 5 step and the top covers the data', () => {
  expect(niceTicks(0.9)).toEqual({ ticks: [0, 0.5, 1], top: 1 });
  for (const hi of [0.37, 5.2, 48.67, 1e6 + 1]) {
    const { ticks, top } = niceTicks(hi);
    expect(top).toBeGreaterThanOrEqual(hi);
    expect(ticks[0]).toBe(0);
  }
});

test('an axis from a negative start puts a tick on a whole step below it', () => {
  const { ticks } = niceTicks(10, { lo: -3 });
  expect(ticks[0]).toBe(-5);
  expect(ticks.at(-1)).toBeGreaterThanOrEqual(10);
});
