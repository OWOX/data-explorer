import { describe, expect, it } from 'vitest';
import { compactValue } from './compact';
import { AUTO } from '../format/formats';

const short = (n: number, maxFrac = 1) => new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: maxFrac }).format(n);

describe('compactValue', () => {
  it('shortens a number of at least 1,000', () => {
    expect(compactValue(1_600_000, 'INTEGER', AUTO)).toBe(short(1_600_000));
    expect(compactValue('116739.09999999996', 'NUMERIC', AUTO)).toBe(short(116739.09999999996));
    expect(compactValue(-2500, 'FLOAT', { kind: 'plain' })).toBe(short(-2500));
  });
  it('leaves a short number, a non-number and a blank alone', () => {
    expect(compactValue(450, 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(999.5, 'FLOAT', AUTO)).toBeNull();
    expect(compactValue('abc', 'STRING', AUTO)).toBeNull();
    expect(compactValue(null, 'INTEGER', AUTO)).toBeNull();
    expect(compactValue(true, 'BOOL', AUTO)).toBeNull();
  });
  it('keeps the currency of a money format', () => {
    const want = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(116739);
    expect(compactValue(116739, 'NUMERIC', { kind: 'money', currency: 'USD' })).toBe(want);
  });
  it('does not shorten a percent', () => {
    expect(compactValue(12345, 'FLOAT', { kind: 'percent' })).toBeNull();
  });
});
