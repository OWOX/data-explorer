import { addDays, ymd } from './day';

test('ymd reads the day a value starts with', () => {
  expect(ymd('2026-11-20')).toEqual([2026, 11, 20]);
  expect(ymd('2026-11-20T10:00:00Z')).toEqual([2026, 11, 20]);
  expect(ymd('Nov 2026')).toBeNull();
  expect(ymd(null)).toBeNull();
});

test('addDays crosses month and year ends', () => {
  expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
});
