import { displayText } from '../ui/format';
import { formatsFor, formatValue, isValidFormat, resolveFormat, type Format, keepsUnit } from './formats';

const auto: Format = { kind: 'auto' };
const money = (currency: string): Format => ({ kind: 'money', currency });

test('formatsFor: number, DATE, timestamps, and none for text, boolean, time of day', () => {
  expect(formatsFor('INTEGER')).toEqual(['auto', 'plain', 'percent', 'money']);
  expect(formatsFor('numeric')).toEqual(['auto', 'plain', 'percent', 'money']);
  expect(formatsFor('DATE')).toEqual(['auto', 'date']);
  expect(formatsFor('TIMESTAMP')).toEqual(['auto', 'date', 'datetime', 'time']);
  expect(formatsFor('DATETIME')).toEqual(['auto', 'date', 'datetime', 'time']);
  for (const t of ['STRING', 'BOOLEAN', 'TIME', 'ARRAY', '']) expect(formatsFor(t)).toEqual([]);
});

test('isValidFormat checks shape and type', () => {
  expect(isValidFormat({ kind: 'percent' }, 'FLOAT')).toBe(true);
  expect(isValidFormat({ kind: 'percent' }, 'STRING')).toBe(false);
  expect(isValidFormat({ kind: 'time' }, 'DATE')).toBe(false);
  expect(isValidFormat({ kind: 'money', currency: 'EUR' }, 'INT64')).toBe(true);
  expect(isValidFormat({ kind: 'money' }, 'INT64')).toBe(false);
  expect(isValidFormat({ kind: 'money', currency: 'euro' }, 'INT64')).toBe(false);
  expect(isValidFormat({ kind: 'bogus' }, 'INT64')).toBe(false);
  expect(isValidFormat(null, 'INT64')).toBe(false);
  expect(isValidFormat('plain', 'INT64')).toBe(false);
});

test('resolveFormat: member, then project, then auto', () => {
  expect(resolveFormat({ kind: 'plain' }, { kind: 'percent' })).toEqual({ kind: 'plain' });
  expect(resolveFormat(undefined, { kind: 'percent' })).toEqual({ kind: 'percent' });
  expect(resolveFormat()).toEqual(auto);
});

describe('formatValue', () => {
  test('auto equals displayText', () => {
    for (const [v, t] of [[1223, 'INTEGER'], ['1234567.5', 'NUMERIC'], ['2026-03-12', 'DATE'], ['2026-03-12T10:45:30Z', 'TIMESTAMP'], ['abc', 'STRING'], [null, 'INTEGER']] as const) {
      expect(formatValue(v, t, auto)).toBe(displayText(v, t));
    }
  });
  test('plain drops the grouping', () => {
    expect(formatValue(1223, 'INTEGER', { kind: 'plain' })).toBe('1223');
    expect(formatValue('-1234567.5', 'NUMERIC', { kind: 'plain' })).toBe('-1234567.5');
  });
  test('percent multiplies by 100, up to 2 decimals', () => {
    expect(formatValue(0.125, 'FLOAT', { kind: 'percent' })).toBe(new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 2 }).format(0.125));
    expect(formatValue(0.125, 'FLOAT', { kind: 'percent' })).toMatch(/12\.5|12,5/);
    expect(formatValue(0.123456, 'FLOAT', { kind: 'percent' })).toMatch(/12[.,]35/);
    expect(formatValue('0.5', 'NUMERIC', { kind: 'percent' })).toMatch(/50/);
  });
  test('money has 2 decimals and the currency', () => {
    const want = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(1223);
    expect(formatValue(1223, 'INTEGER', money('USD'))).toBe(want);
    expect(formatValue('1223.5', 'NUMERIC', money('EUR'))).toMatch(/1.?223[.,]50/);
    expect(formatValue(5, 'INTEGER', money('PLN'))).toMatch(/5[.,]00/);
  });
  test('an unknown currency falls back to the default text', () => {
    expect(formatValue(1223, 'INTEGER', money('ZZZZ'))).toBe(displayText(1223, 'INTEGER'));
  });
  test('a non-numeric value in a number column falls back', () => {
    for (const f of [{ kind: 'plain' }, { kind: 'percent' }, money('USD')] as Format[]) {
      expect(formatValue('n/a', 'INTEGER', f)).toBe('n/a');
      expect(formatValue('', 'INTEGER', f)).toBe('');
      expect(formatValue(null, 'INTEGER', f)).toBe('');
    }
  });
  test('a format the type does not offer falls back', () => {
    expect(formatValue('abc', 'STRING', { kind: 'percent' })).toBe('abc');
    expect(formatValue('2026-03-12', 'DATE', { kind: 'time' })).toBe(displayText('2026-03-12', 'DATE'));
  });
  test('date, datetime and time', () => {
    const at = new Date('2026-03-12T10:45:30Z');
    expect(formatValue('2026-03-12T10:45:30Z', 'TIMESTAMP', { kind: 'date' })).toBe(new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(at));
    expect(formatValue('2026-03-12T10:45:30Z', 'TIMESTAMP', { kind: 'datetime' })).toBe(displayText('2026-03-12T10:45:30Z', 'TIMESTAMP'));
    expect(formatValue('2026-03-12T10:45:30Z', 'TIMESTAMP', { kind: 'time' })).toBe(new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(at));
  });
  test('a wall-clock DATETIME is not converted', () => {
    expect(formatValue('2026-03-12T10:45:30', 'DATETIME', { kind: 'time' })).toBe(new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(2026, 2, 12, 10, 45, 30)));
  });
  test('DATE date stays a calendar day; unreadable value falls back', () => {
    expect(formatValue('2026-03-12', 'DATE', { kind: 'date' })).toBe(displayText('2026-03-12', 'DATE'));
    expect(formatValue('not a date', 'TIMESTAMP', { kind: 'time' })).toBe('not a date');
  });
});

test('keepsUnit: counts and combined text lose the column format, the rest keep it', () => {
  for (const fn of [undefined, 'SUM', 'MIN', 'MAX', 'AVG', 'P25', 'P50', 'P75', 'P95']) expect(keepsUnit(fn)).toBe(true);
  for (const fn of ['COUNT', 'COUNT_DISTINCT', 'STRING_AGG']) expect(keepsUnit(fn)).toBe(false);
});
