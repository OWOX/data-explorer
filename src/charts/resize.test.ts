import { cleanSize, dragged, panelWidth, toCells } from './resize';
import { plotHeight, rowHeight } from './plotSize';

const box = { w: 480, h: 288 };

test('a size is the nearest whole number of cells, within the limits and the room', () => {
  expect(toCells(491, { min: 8, max: 100 })).toBe(20);
  expect(toCells(493, { min: 8, max: 100 })).toBe(21);
  expect(toCells(10, { min: 8, max: 100 })).toBe(8);
  expect(toCells(99999, { min: 8, max: 100 })).toBe(100);
  expect(toCells(900, { min: 8, max: 100 }, 500)).toBe(20);
  expect(toCells(900, { min: 8, max: 100 }, 50)).toBe(8);
});

test('a handle sets only the sides it moves', () => {
  expect(dragged({}, 'e', box, 48, 500, 2000)).toEqual({ cols: 22 });
  expect(dragged({ cols: 9 }, 's', box, 500, 24, 2000)).toEqual({ cols: 9, rows: 13 });
  expect(dragged({}, 'se', box, -24, -24, 2000)).toEqual({ cols: 19, rows: 11 });
});

test('cleanSize keeps whole cells within the limits', () => {
  expect(cleanSize({ cols: 20, rows: 12, x: 1 })).toEqual({ cols: 20, rows: 12 });
  expect(cleanSize({ cols: '20', rows: 2 })).toBeUndefined();
  expect(cleanSize([])).toBeUndefined();
});

test('the panel width is the saved cells or the content rounded up to cells, at most the band', () => {
  expect(panelWidth({ cols: 20 }, '26rem')).toBe('min(round(down, 100%, 24px), 480px)');
  expect(panelWidth({ rows: 12 }, '26rem')).toBe('min(round(down, 100%, 24px), round(up, 26rem, 24px))');
});

test('a plot and its rows take the room they are given, and their own size without one', () => {
  expect(plotHeight(null, 50, 240)).toBe(240);
  expect(plotHeight(400, 50, 240)).toBe(350);
  expect(plotHeight(20, 50, 240)).toBe(60);
  expect(rowHeight(null, 30, 5, 20)).toBe(20);
  expect(rowHeight(330, 30, 5, 20)).toBe(60);
  expect(rowHeight(100, 30, 50, 20)).toBe(20);
});
