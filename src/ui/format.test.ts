import { compactNumber, relativeTime } from './format';

test.each([[0, '0'], [999, '999'], [1200, '1.2K'], [12400, '12.4K'], [3_400_000, '3.4M'], [2_000_000_000, '2B']])('%d → %s', (n, s) => {
  expect(compactNumber(n)).toBe(s);
});

test('relativeTime', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  expect(relativeTime('2026-11-14T10:00:00Z', now)).toBe('2 hours ago');
  expect(relativeTime('2026-11-11T12:00:00Z', now)).toBe('3 days ago');
  expect(relativeTime('2026-11-14T11:59:40Z', now)).toBe('just now');
});
