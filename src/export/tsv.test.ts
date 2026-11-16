import type { Field } from '../model/types';
import { displayText } from '../ui/format';
import { buildTsv, cellText } from './tsv';

const f = (name: string, extra: Partial<Field> = {}): Field => ({ name, type: 'STRING', category: 'string', ...extra }) as Field;

test('numbers and booleans are raw values', () => {
  expect(cellText(1234567.5)).toBe('1234567.5');
  expect(cellText(0)).toBe('0');
  expect(cellText(true)).toBe('true');
  expect(cellText(false)).toBe('false');
});

test('null and undefined are empty', () => {
  expect(cellText(null)).toBe('');
  expect(cellText(undefined)).toBe('');
});

test('a date and a timestamp copy as the grid shows them, in the viewer format and zone', () => {
  const day = displayText('2026-11-15', 'DATE');
  const moment = displayText('2026-11-15T10:20:30.000Z', 'TIMESTAMP');
  expect(day).not.toBe('2026-11-15');
  expect(cellText('2026-11-15', 'DATE')).toBe(day);
  expect(cellText('2026-11-15T10:20:30.000Z', 'TIMESTAMP')).toBe(moment);
  expect(moment).not.toContain('T10:20');
  expect(buildTsv([f('d', { type: 'DATE' }), f('t', { type: 'TIMESTAMP' })], [{ d: '2026-11-15', t: '2026-11-15T10:20:30.000Z' }])).toBe(`d\tt\n${day}\t${moment}`);
});

test('a string column keeps a date-looking text as stored, and a value that is not a date stays raw', () => {
  expect(cellText('2026-11-15T10:20:30.000Z', 'STRING')).toBe('2026-11-15T10:20:30.000Z');
  expect(cellText('not a date', 'DATE')).toBe('not a date');
});

test('a long value is copied whole, never clipped', () => {
  const long = 'x'.repeat(5000);
  expect(cellText(long, 'STRING')).toBe(long);
});

test('arrays are joined with ", ", nulls inside are empty, objects are JSON', () => {
  expect(cellText(['a', 'b', 3])).toBe('a, b, 3');
  expect(cellText(['a', null, 'c'])).toBe('a, , c');
  expect(cellText({ a: 1 })).toBe('"{""a"":1}"');
  expect(cellText([{ a: 1 }, 'x'])).toBe('"{""a"":1}, x"');
});

test('tab, CR and LF inside a value become one space each run', () => {
  expect(cellText('a\tb')).toBe('a b');
  expect(cellText('a\r\nb')).toBe('a b');
  expect(cellText('a\n\nb\rc')).toBe('a b c');
  expect(cellText(['x\ty', 'z'])).toBe('x y, z');
  expect(cellText({ a: 'x\ty' })).not.toMatch(/[\t\r\n]/);
});

test('the header row uses the titles as the grid shows them, joined ones lead with the mart', () => {
  const fields = [f('id'), f('status', { alias: 'Order status' }), f('customers__city', { alias: 'City', joined: { martId: 'customers', label: 'Customers' } } as Partial<Field>)];
  const tsv = buildTsv(fields, [{ id: 1, status: 'new', customers__city: ['Kyiv', 'Lviv'] }]);
  expect(tsv).toBe('id\tOrder status\tCustomers · City\n1\tnew\tKyiv, Lviv');
});

test('columns keep the given order, a missing key is empty, lines end with \\n and no trailing newline', () => {
  const tsv = buildTsv([f('b'), f('a')], [{ a: 1, b: 2 }, { a: 3 }]);
  expect(tsv).toBe('b\ta\n2\t1\n\t3');
});

test('a header title with a tab or newline is cleaned too; no rows gives the header only', () => {
  expect(buildTsv([f('x', { alias: 'a\tb' })], [])).toBe('a b');
});

test('text that would start a spreadsheet formula is prefixed with an apostrophe', () => {
  for (const v of ['=1+1', '+A1', '@SUM(A1)', '-cmd']) expect(cellText(v, 'STRING')).toBe(`'${v}`);
});

test('plain numbers keep their sign and are not prefixed', () => {
  for (const v of ['-5', '-1.25', '+3', '-1.2e3', '.5']) expect(cellText(v, 'STRING')).toBe(v);
  expect(cellText(-5)).toBe('-5');
});

test('a header is guarded too', () => {
  expect(buildTsv([f('x', { alias: '=x' })], [{ x: '=y' }])).toBe("'=x\n'=y");
});

describe('quotes', () => {
  test('a value that starts with a quote is wrapped and its quotes doubled', () => {
    expect(cellText('"Premium" plan')).toBe('"""Premium"" plan"');
  });
  test('an inner quote wraps the value so it cannot swallow the next tab', () => {
    expect(cellText('5" screen')).toBe('"5"" screen"');
    expect(cellText('"abc')).toBe('"""abc"');
  });
  test('a header with a quote is wrapped too', () => {
    expect(buildTsv([f('a', { alias: 'The "best" one' }), f('b')], [{ a: 'x', b: 'y' }])).toBe('"The ""best"" one"\tb\nx\ty');
  });
  test('a quoted value that starts with = is neutralised inside the quotes', () => {
    expect(cellText('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
  });
  test('a value that starts with an apostrophe keeps it', () => {
    expect(cellText("'abc")).toBe("''abc");
  });
});
