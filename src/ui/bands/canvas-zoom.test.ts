import { MAX_SCALE, MIN_SCALE, zoomedScale } from './canvas-zoom';

test('wheel up zooms in and wheel down zooms out, multiplicatively', () => {
  expect(zoomedScale(1, -10)).toBeGreaterThan(1);
  expect(zoomedScale(1, 10)).toBeLessThan(1);
  expect(zoomedScale(1, -10) * zoomedScale(1, 10)).toBeCloseTo(1, 10);
  expect(zoomedScale(1, 0)).toBe(1);
});

test('small pinch deltas make small steps', () => {
  expect(Math.abs(zoomedScale(1, 2) - 1)).toBeLessThan(0.02);
});

test('the scale stays within 0.5 and 2', () => {
  let s = 1;
  for (let i = 0; i < 100; i++) s = zoomedScale(s, -100);
  expect(s).toBe(MAX_SCALE);
  for (let i = 0; i < 100; i++) s = zoomedScale(s, 100);
  expect(s).toBe(MIN_SCALE);
});
