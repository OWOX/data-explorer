import { expect, test } from 'vitest';
import { fitBadges } from './fitBadges';

test('every badge fits: all stay, no chip', () => {
  expect(fitBadges([40, 50, 60], 44, 160, 4)).toBe(3);
  expect(fitBadges([40, 50, 60], 44, 158, 4)).toBe(3);
});

test('one pixel short: the chip takes room and the last badges go', () => {
  expect(fitBadges([40, 50, 60], 44, 157, 4)).toBe(2);
});

test('keeps as many badges as fit beside the chip', () => {
  // 44 chip + 4 + 40 + 4 + 50 = 142 <= 150; a third would need 206.
  expect(fitBadges([40, 50, 60], 44, 150, 4)).toBe(2);
  expect(fitBadges([40, 50, 60], 44, 100, 4)).toBe(1);
  expect(fitBadges([40, 50, 60], 44, 60, 4)).toBe(0);
});

test('a row that has not been laid out keeps everything', () => {
  expect(fitBadges([40, 50], 44, 0, 4)).toBe(2);
});

test('no badges is nothing to fit', () => {
  expect(fitBadges([], 44, 100, 4)).toBe(0);
});
