import { describe, expect, test } from 'vitest';
import { formatListText, formatListValue, listPieces, parseListText } from './list-text';

// The first group is the OWOX Google Sheets extension's filter-value-utils test cases.
describe('formatListValue / parseListText round-trip', () => {
  test('keeps commas literal inside quoted values', () => {
    const values = ['Acme, Inc.', 'plain', 'say "hi"', ' padded '];
    expect(parseListText(formatListText(values))).toEqual(values);
  });
  test('quotes only values that need it', () => {
    expect(formatListValue('plain')).toBe('plain');
    expect(formatListValue('Acme, Inc.')).toBe('"Acme, Inc."');
    expect(formatListValue('say "hi"')).toBe('"say ""hi"""');
  });
  test('splits unquoted entries on commas and newlines, trimming and dropping empties', () => {
    expect(parseListText(' a , b \n c ,, ')).toEqual(['a', 'b', 'c']);
  });
  test('keeps whitespace inside quotes but drops stray whitespace around a quoted token', () => {
    expect(parseListText(' " a " , b')).toEqual([' a ', 'b']);
  });
});

describe('quote escapes', () => {
  test('a doubled quote inside quotes is one quote', () => {
    expect(parseListText('"a""b", c')).toEqual(['a"b', 'c']);
    expect(parseListText('""""')).toEqual(['"']);
  });
  test.each(['a""b', '"', '""', ',', 'a,b,c', 'line\nbreak', '  edge', 'x"', '"x'])('%j round-trips', (v) => {
    expect(parseListText(formatListText([v, 'z']))).toEqual([v, 'z']);
  });
  test('an open quote runs to the end', () => {
    expect(parseListText('a, "b, c')).toEqual(['a', 'b, c']);
  });
  test('a quoted empty value is dropped like any empty piece', () => {
    expect(parseListText('a, "", b')).toEqual(['a', 'b']);
  });
  test('numbers format as themselves', () => {
    expect(formatListText([1, 2.5])).toBe('1, 2.5');
  });
});

describe('listPieces', () => {
  test('cuts at separators outside quotes only', () => {
    expect(listPieces('a, "b, c", d')).toEqual([{ raw: 'a', ended: true }, { raw: ' "b, c"', ended: true }, { raw: ' d', ended: false }]);
    expect(listPieces('a,')).toEqual([{ raw: 'a', ended: true }, { raw: '', ended: false }]);
  });
});
