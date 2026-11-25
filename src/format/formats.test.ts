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

describe('formatValue with whole: values above 10 show no fraction', () => {
  const whole = { whole: true };
  const money0 = (v: unknown, t = 'NUMERIC') => formatValue(v, t, money('USD'), whole);
  test('off by default: nothing changes', () => {
    expect(formatValue('9298.69', 'NUMERIC', money('USD'))).toMatch(/9,298\.69/);
    expect(formatValue('9298.69', 'NUMERIC', auto)).toBe('9,298.69');
  });
  test('auto and plain round half away from zero past 10, and keep grouping or not', () => {
    expect(formatValue('9298.69', 'NUMERIC', auto, whole)).toBe('9,299');
    expect(formatValue(9298.69, 'FLOAT', auto, whole)).toBe('9,299');
    expect(formatValue('9298.69', 'NUMERIC', { kind: 'plain' }, whole)).toBe('9299');
    expect(formatValue('10.5', 'NUMERIC', auto, whole)).toBe('11');
    expect(formatValue('10.4', 'NUMERIC', auto, whole)).toBe('10');
    expect(formatValue('-10.5', 'NUMERIC', auto, whole)).toBe('-11');
    expect(formatValue('-9298.69', 'NUMERIC', auto, whole)).toBe('-9,299');
    expect(formatValue('99.5', 'NUMERIC', auto, whole)).toBe('100');
  });
  test('10 and below keep their fraction', () => {
    expect(formatValue('10', 'NUMERIC', auto, whole)).toBe('10');
    expect(formatValue('10.0', 'NUMERIC', auto, whole)).toBe('10.0');
    expect(formatValue('9.999', 'NUMERIC', auto, whole)).toBe('9.999');
    expect(formatValue('-9.99', 'NUMERIC', auto, whole)).toBe('-9.99');
    expect(formatValue(9.99, 'FLOAT', { kind: 'plain' }, whole)).toBe('9.99');
  });
  test('a numeric string stays exact: no float noise on a long one', () => {
    expect(formatValue('12345678901234567890.5', 'NUMERIC', auto, whole)).toBe('12,345,678,901,234,567,891');
    expect(formatValue('123456789012345678.49', 'NUMERIC', { kind: 'plain' }, whole)).toBe('123456789012345678');
    expect(formatValue('99999999999999999999.5', 'BIGNUMERIC', auto, whole)).toBe('100,000,000,000,000,000,000');
  });
  test('integers and values that are not plain numbers are unchanged', () => {
    expect(formatValue(1223, 'INTEGER', auto, whole)).toBe('1,223');
    expect(formatValue('1e+21', 'FLOAT', auto, whole)).toBe(displayText('1e+21', 'FLOAT'));
    expect(formatValue('n/a', 'INTEGER', auto, whole)).toBe('n/a');
    expect(formatValue('2026-03-12', 'DATE', auto, whole)).toBe(displayText('2026-03-12', 'DATE'));
  });
  test('percent: above 10 as shown has no fraction', () => {
    const pct: Format = { kind: 'percent' };
    expect(formatValue(0.1234, 'FLOAT', pct, whole)).toBe('12%');
    expect(formatValue(0.105, 'FLOAT', pct, whole)).toBe('11%');
    expect(formatValue(0.104, 'FLOAT', pct, whole)).toBe('10%');
    expect(formatValue(0.0999, 'FLOAT', pct, whole)).toMatch(/9[.,]99%/);
    expect(formatValue(0.1, 'FLOAT', pct, whole)).toBe('10%');
    expect(formatValue(-0.1234, 'FLOAT', pct, whole)).toMatch(/12%/);
    expect(formatValue('0.1234', 'NUMERIC', pct, whole)).toBe('12%');
  });
  test('money: no .00, currency kept, boundaries', () => {
    expect(money0('9298.69')).toMatch(/^(US)?\$9,299$/);
    expect(money0('12345678901234567890.5')).toMatch(/^(US)?\$12,345,678,901,234,567,891$/);
    expect(money0(9298.69, 'FLOAT')).toMatch(/^(US)?\$9,299$/);
    expect(money0('10.5')).toMatch(/^(US)?\$11$/);
    expect(money0('10.4')).toMatch(/^(US)?\$10$/);
    expect(money0('9.999')).toMatch(/10\.00/);
    expect(money0('9.99')).toMatch(/9\.99/);
    expect(money0('10')).toMatch(/10\.00/);
    expect(money0('-9298.69')).toMatch(/9,299/);
    expect(money0('-9298.69')).not.toMatch(/\./);
    expect(formatValue('9298.5', 'NUMERIC', money('EUR'), whole)).toMatch(/9.?299/);
  });
  test('the 10 line is judged on the digits the format shows: 10.004 and 10.0049% are not above it', () => {
    expect(money0('10.004')).toMatch(/10\.00/);
    expect(money0(10.004, 'FLOAT')).toMatch(/10\.00/);
    expect(formatValue(0.100049, 'FLOAT', { kind: 'percent' }, whole)).toBe('10%');
    expect(formatValue(0.10006, 'FLOAT', { kind: 'percent' }, whole)).toBe('10%');
  });
  test('a format the type does not offer, and a bad currency, fall back as before', () => {
    expect(formatValue('12.5', 'STRING', { kind: 'percent' }, whole)).toBe('12.5');
    expect(formatValue(1223.5, 'FLOAT', money('ZZZZ'), whole)).toBe(displayText(1223.5, 'FLOAT'));
  });
});

test('keepsUnit: counts and combined text lose the column format, the rest keep it', () => {
  for (const fn of [undefined, 'SUM', 'MIN', 'MAX', 'AVG', 'P25', 'P50', 'P75', 'P95']) expect(keepsUnit(fn)).toBe(true);
  for (const fn of ['COUNT', 'COUNT_DISTINCT', 'STRING_AGG']) expect(keepsUnit(fn)).toBe(false);
});

test('formatsFor hands out one shared list per category', () => {
  expect(formatsFor('INT64')).toBe(formatsFor('NUMERIC'));
  expect(formatsFor('TIMESTAMP')).toBe(formatsFor('DATETIME'));
  expect(formatsFor('DATE')).toBe(formatsFor('date'));
  expect(formatsFor('STRING')).toBe(formatsFor('BOOL'));
});
