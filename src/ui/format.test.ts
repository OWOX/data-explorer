import { vi } from 'vitest';
import { compactNumber, count, displayText, formatNumber, formatTemporal, groupsLabel, num, rowCountLabel, rowsLabel, uniqueRecordsLabel, relativeTime, resetFormats } from './format';

test.each([[0, '0'], [999, '999'], [1200, '1.2K'], [12400, '12.4K'], [3_400_000, '3.4M'], [2_000_000_000, '2B']])('%d → %s', (n, s) => {
  expect(compactNumber(n)).toBe(s);
});

test('relativeTime', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  expect(relativeTime('2026-11-14T10:00:00Z', now)).toBe('2 hours ago');
  expect(relativeTime('2026-11-11T12:00:00Z', now)).toBe('3 days ago');
  expect(relativeTime('2026-11-14T11:59:40Z', now)).toBe('just now');
});

test('count pluralises', () => {
  expect(count(1, 'data mart')).toBe('1 data mart');
  expect(count(3, 'data mart')).toBe('3 data marts');
});

describe('rowCountLabel', () => {
  test('says rows, and row for one', () => {
    expect(rowCountLabel('1')).toBe('1 row');
    expect(rowCountLabel('2')).toBe('2 rows');
    expect(rowCountLabel('200+')).toBe('200+ rows');
    expect(rowCountLabel('0')).toBe('0 rows');
    expect(rowCountLabel('11.1K')).toBe('11.1K rows');
  });
});

describe('rowsLabel', () => {
  test('shows loaded of total only when there are more rows and the total is larger', () => {
    expect(rowsLabel(200, true, 12345)).toBe(`${num(200)} of ${num(12345)}`);
    expect(rowsLabel(1200, true, 12345)).toBe(`${num(1200)} of ${num(12345)}`);
    expect(rowsLabel(200, true, null)).toBe('200+');
    expect(rowsLabel(200, true, 200)).toBe('200+');
    expect(rowsLabel(200, true, 150)).toBe('200+');
    expect(rowsLabel(57, false, 57)).toBe('57');
    expect(rowsLabel(57, false, null)).toBe('57');
  });
  test('reads as rows and as groups', () => {
    expect(rowCountLabel(rowsLabel(200, true, 12345))).toBe(`${num(200)} of ${num(12345)} rows`);
    expect(groupsLabel(rowsLabel(200, true, 12345))).toBe(`${num(200)} of ${num(12345)} groups`);
    expect(rowCountLabel(rowsLabel(1, true, 2))).toBe('1 of 2 rows');
    expect(groupsLabel(rowsLabel(1, true, 2))).toBe('1 of 2 groups');
  });
});

describe('formatTemporal', () => {
  const medium = (d: Date) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(d);

  test('a TIMESTAMP shows in the viewer local time, with date, hours and minutes', () => {
    expect(formatTemporal('2026-03-12T10:45:30.000Z', 'TIMESTAMP')).toBe(medium(new Date('2026-03-12T10:45:30.000Z')));
    expect(formatTemporal('2026-03-12 10:45:30+00', 'TIMESTAMP')).toBe(medium(new Date('2026-03-12T10:45:30Z')));
  });

  test('a TIMESTAMP with no zone is UTC; a DATETIME with none is wall-clock time and is not shifted', () => {
    expect(formatTemporal('2026-03-12 10:45:30', 'TIMESTAMP')).toBe(medium(new Date('2026-03-12T10:45:30Z')));
    expect(formatTemporal('2026-03-12T10:45:30', 'DATETIME')).toBe(medium(new Date(2026, 2, 12, 10, 45, 30)));
  });

  test('a DATE is a calendar day: it never moves with the time zone', () => {
    try {
      for (const tz of ['America/Los_Angeles', 'Pacific/Auckland', 'UTC']) {
        vi.stubEnv('TZ', tz);
        resetFormats();
        expect(formatTemporal('2026-03-12', 'DATE')).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(2026, 2, 12)));
        expect(formatTemporal('2026-03-12', 'DATE')).toMatch(/12/);
        expect(formatTemporal('2026-03-12T00:00:00.000Z', 'DATE')).toMatch(/12/);
      }
    } finally {
      vi.unstubAllEnvs();
      resetFormats();
    }
  });

  test('an impossible day or time is left raw, not rolled into a real date', () => {
    expect(formatTemporal('2026-02-31', 'DATE')).toBeNull();
    expect(formatTemporal('2026-13-01', 'DATE')).toBeNull();
    expect(formatTemporal('2026-02-29', 'DATE')).toBeNull();
    expect(formatTemporal('2024-02-29', 'DATE')).not.toBeNull();
    expect(formatTemporal('2026-02-31T10:00:00Z', 'TIMESTAMP')).toBeNull();
    expect(formatTemporal('2026-04-31 10:00:00', 'DATETIME')).toBeNull();
    expect(formatTemporal('2026-03-12T25:00:00Z', 'TIMESTAMP')).toBeNull();
    expect(formatTemporal('2026-03-12T10:61:00Z', 'TIMESTAMP')).toBeNull();
  });

  test('anything it cannot read, and any other type, is left to the caller', () => {
    expect(formatTemporal('not a date', 'TIMESTAMP')).toBeNull();
    expect(formatTemporal('', 'DATE')).toBeNull();
    expect(formatTemporal(null, 'TIMESTAMP')).toBeNull();
    expect(formatTemporal(1700000000, 'TIMESTAMP')).toBeNull();
    expect(formatTemporal('2026-03-12', 'STRING')).toBeNull();
  });
});

describe('formatNumber', () => {
  test('groups thousands like Sheets and keeps every digit', () => {
    expect(formatNumber(1223)).toBe('1,223');
    expect(formatNumber(-1234567.5)).toBe('-1,234,567.5');
    expect(formatNumber('12345678901234567890.123')).toBe('12,345,678,901,234,567,890.123');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(0)).toBe('0');
    expect(formatNumber('+42')).toBe('42');
  });
  test('leaves what is not a plain number to be shown as it is', () => {
    for (const v of [1e21, NaN, Infinity, 'abc', '1e5', '', null, undefined, true]) expect(formatNumber(v)).toBeNull();
  });
  test('displayText formats numbers by type only', () => {
    expect(displayText(1223, 'INT64')).toBe('1,223');
    expect(displayText('1223', 'NUMERIC')).toBe('1,223');
    expect(displayText(1223, 'STRING')).toBe('1223');
    expect(displayText(1223)).toBe('1223');
  });
});

describe('uniqueRecordsLabel', () => {
  test('is singular for one', () => {
    expect(uniqueRecordsLabel('1')).toBe('1 unique record');
    expect(uniqueRecordsLabel('2')).toBe('2 unique records');
    expect(uniqueRecordsLabel('11.1K')).toBe('11.1K unique records');
  });
});
