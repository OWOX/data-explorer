import { expect, test } from 'vitest';
import { fitBadges } from './fitBadges';

test('every badge fits: all stay, no chip', () => {
  expect(fitBadges([40, 50, 60], 44, 160, 4)).toBe(3);
  expect(fitBadges([40, 50, 60], 44, 158, 4)).toBe(3);
});

test('one line short: a second line takes the rest, still no chip', () => {
  // 40 + 4 + 50 = 94 on the first line, 60 on the second.
  expect(fitBadges([40, 50, 60], 44, 157, 4)).toBe(3);
  expect(fitBadges([40, 50, 60], 44, 100, 4)).toBe(3);
});

test('a single line keeps the old rule: the chip takes room and the last badges go', () => {
  expect(fitBadges([40, 50, 60], 44, 157, 4, 1)).toBe(2);
  expect(fitBadges([40, 50, 60], 44, 150, 4, 1)).toBe(2);
  expect(fitBadges([40, 50, 60], 44, 100, 4, 1)).toBe(1);
  expect(fitBadges([40, 50, 60], 44, 60, 4, 1)).toBe(0);
});

test('past two lines the chip ends the second line and the badges before it stay', () => {
  // Width 100: line one 40 + 4 + 50 = 94; the third badge and the chip together (108) do not fit on line two, so the chip stands alone there.
  expect(fitBadges([40, 50, 60, 50], 44, 100, 4)).toBe(2);
  // Width 110: line one 94; line two 60 + 4 + 44 = 108 fits, the fourth badge does not.
  expect(fitBadges([40, 50, 60, 50], 44, 110, 4)).toBe(3);
  // Width 60: a badge per line; the first badge and the chip (88) cannot share a line, so one badge and the chip.
  expect(fitBadges([40, 50, 60], 44, 60, 4)).toBe(1);
});

test('a badge wider than the row still counts as one line', () => {
  expect(fitBadges([200, 40], 44, 100, 4)).toBe(2);
  expect(fitBadges([200, 60, 60], 44, 100, 4)).toBe(1);
});

test('a row that has not been laid out keeps everything', () => {
  expect(fitBadges([40, 50], 44, 0, 4)).toBe(2);
});

test('no badges is nothing to fit', () => {
  expect(fitBadges([], 44, 100, 4)).toBe(0);
});
