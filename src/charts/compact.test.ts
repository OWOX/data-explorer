import { describe, expect, it } from 'vitest';
import { compactValue } from './compact';
import { AUTO } from '../format/formats';

describe('compactValue', () => {
  it('shortens a number of at least 10,000, with en separators whatever the locale', () => {
    expect(compactValue(1_600_000, 'INTEGER', AUTO)).toBe('1.6M');
    expect(compactValue('116739.09999999996', 'NUMERIC', AUTO)).toBe('116.7K');
    expect(compactValue(-25_000, 'FLOAT', { kind: 'plain' })).toBe('-25K');
    expect(compactValue(999_950, 'INTEGER', AUTO)).toBe('1M');
    expect(compactValue(1e15, 'FLOAT', AUTO)).toBe('1000T');
  });
  it('leaves a number below 10,000 in full', () => {
    expect(compactValue(2026, 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(-9999, 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(9999.95, 'FLOAT', AUTO)).toBeNull();
  });
  it('leaves a non-number, a blank and a number-looking text alone', () => {
    expect(compactValue('abc', 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(null, 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(true, 'BOOL', AUTO)).toBeNull();
    expect(compactValue('12345', 'STRING', AUTO)).toBeNull();
  });
  it('keeps the currency of a money format, and a bad currency gives no short form', () => {
    const want = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(116739);
    expect(compactValue(116739, 'NUMERIC', { kind: 'money', currency: 'USD' })).toBe(want);
    expect(compactValue(116739, 'NUMERIC', { kind: 'money', currency: 'US' })).toBeNull();
  });
  it('does not shorten a percent', () => {
    expect(compactValue(12345, 'FLOAT', { kind: 'percent' })).toBeNull();
  });
});
