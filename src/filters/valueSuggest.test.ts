import { describe, expect, test } from 'vitest';
import type { Field } from '../model/types';
import { toTraverseFilter } from './build';
import { addValue, closePick, canSuggest, keepsPicks, lastToken, mergeValues, narrow, valuesOf, valuesQuery } from './valueSuggest';

const f = (over: Partial<Field> = {}): Field => ({ name: 'country', alias: 'Country', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...over });

describe('narrow', () => {
  const all = ['United States', 'Germany', 'Ukraine', 'France'];
  test('shows all for an empty text', () => expect(narrow(all, '')).toEqual(all));
  test('matches the text after the last comma, ignoring case', () => expect(narrow(all, 'France, U')).toEqual(['United States', 'Ukraine']));
  test('leaves out values already in the list', () => expect(narrow(all, 'Germany, ')).toEqual(['United States', 'Ukraine', 'France']));
  test('an empty last token shows what is left', () => expect(narrow(all, 'Germany, France, ')).toEqual(['United States', 'Ukraine']));
  test('lastToken trims', () => expect(lastToken('a,  b ')).toBe('b'));
});

describe('valuesQuery', () => {
  test('reads the distinct values by unique count, most first, without blanks', () => {
    expect(valuesQuery(f(), [{ column: 'status', operator: 'eq', value: 'paid' }])).toEqual({
      column: ['country'], uniqueCount: [''], sort: [{ column: 'Unique Count', direction: 'desc' }], limit: 50,
      filter: [{ column: 'status', operator: 'eq', value: 'paid' }, { column: 'country', operator: 'is_not_blank' }],
    });
  });
  test('drops HAVING rules and keeps slices', () => {
    const q = valuesQuery(f(), [{ column: 'amount', operator: 'gt', value: 1, function: 'SUM' }, { column: 'c', operator: 'eq', value: 'x', placement: 'pre-join' }]);
    expect(q.filter).toEqual([{ column: 'c', operator: 'eq', value: 'x', placement: 'pre-join' }, { column: 'country', operator: 'is_not_blank' }]);
  });
  test('valuesOf keeps text, drops blanks and repeats', () => {
    expect(valuesOf([{ country: 'US' }, { country: null }, { country: ' ' }, { country: 'US' }, { country: 'DE' }], f())).toEqual(['US', 'DE']);
  });
  test('only text columns', () => { expect(canSuggest(f())).toBe(true); expect(canSuggest(f({ category: 'number' }))).toBe(false); expect(canSuggest(f({ category: 'date' }))).toBe(false); });
});

describe('a comma-separated value', () => {
  test('is any of with several values is an `in` rule, is none of is `not_in`', () => {
    expect(toTraverseFilter({ field: 'country', op: 'in', value: 'US, DE, ' }, f())).toEqual({ column: 'country', operator: 'in', value: ['US', 'DE'] });
    expect(toTraverseFilter({ field: 'country', op: 'not_in', value: 'US,DE' }, f())).toEqual({ column: 'country', operator: 'not_in', value: ['US', 'DE'] });
  });
  test('one value is still an `in` with one entry', () => expect(toTraverseFilter({ field: 'country', op: 'in', value: 'US' }, f())).toEqual({ column: 'country', operator: 'in', value: ['US'] }));
  test('equals keeps a comma value as one exact value', () => expect(toTraverseFilter({ field: 'country', op: 'eq', value: 'US, DE' }, f())).toEqual({ column: 'country', operator: 'eq', value: 'US, DE' }));
  test('a plain value is untouched; contains keeps its commas', () => {
    expect(toTraverseFilter({ field: 'country', op: 'eq', value: ' US ' }, f())).toEqual({ column: 'country', operator: 'eq', value: ' US ' });
    expect(toTraverseFilter({ field: 'country', op: 'contains', value: 'a, b' }, f())).toEqual({ column: 'country', operator: 'contains', value: 'a, b' });
  });
});

describe('addValue / closePick', () => {
  test('the first pick is the bare value, the second adds ", " between', () => {
    expect(addValue('', 'A')).toBe('A');
    expect(addValue(closePick('A', ['A', 'B']), 'B')).toBe('A, B');
    expect(addValue(closePick('A, B', ['A', 'B', 'C']), 'C')).toBe('A, B, C');
  });
  test('a value already there leaves the values as they were, minus a half-typed piece', () => {
    expect(addValue('A, B, ', 'a')).toBe('A, B');
    expect(addValue('A, ', 'A')).toBe('A');
  });
  test('the half-typed piece is what the pick completes', () => expect(addValue('A, Ge', 'Germany')).toBe('A, Germany'));
  test('a piece that is exactly a known value is closed with ", "; others stay', () => {
    expect(closePick('A', ['A', 'B'])).toBe('A, ');
    expect(closePick('A, B', ['A', 'B', 'C'])).toBe('A, B, ');
    expect(closePick('A, b', ['A', 'B'])).toBe('A, b');
    expect(closePick('A, ', ['A'])).toBe('A, ');
    expect(closePick('', ['A'])).toBe('');
  });
});

describe('keepsPicks', () => {
  test('a picked list followed by a comma, with or without the space', () => {
    expect(keepsPicks('Ukraine, ', 'Ukraine, Ger')).toBe(true);
    expect(keepsPicks('Ukraine, ', 'Ukraine,')).toBe(true);
    expect(keepsPicks('Ukraine, ', 'Ukraine , Ger')).toBe(true);
    expect(keepsPicks('Ukraine, Germany, ', 'Ukraine,Germany, x')).toBe(true);
  });
  test('a picked base needs the comma; a single reopened value may stand alone', () => {
    expect(keepsPicks('Ukraine, ', 'Ukraine')).toBe(false);
    expect(keepsPicks('Ukraine', 'Ukraine')).toBe(true);
    expect(keepsPicks('Ukraine', 'Ukraine, Ger')).toBe(true);
  });
  test('a changed or longer first value drops it', () => {
    expect(keepsPicks('Ukraine, ', 'Ukrain, Ger')).toBe(false);
    expect(keepsPicks('Ukraine', 'Ukrainer, x')).toBe(false);
    expect(keepsPicks('', 'x')).toBe(false);
  });
  test('regex characters in a value are literal', () => {
    expect(keepsPicks('a.b, ', 'a.b, c')).toBe(true);
    expect(keepsPicks('a.b, ', 'aXb, c')).toBe(false);
  });
});

test('mergeValues keeps the first list first and drops repeats', () => {
  expect(mergeValues(['b', 'a'], ['a', 'c'])).toEqual(['b', 'a', 'c']);
});
