import { describe, expect, test } from 'vitest';
import type { Field } from '../model/types';
import { toTraverseFilter } from './build';
import { addValue, canSuggest, lastToken, narrow, valuesOf, valuesQuery } from './valueSuggest';

const f = (over: Partial<Field> = {}): Field => ({ name: 'country', alias: 'Country', type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...over });

describe('addValue', () => {
  test('adds to the empty input', () => expect(addValue('', 'US')).toBe('US, '));
  test('adds after what is there, separated by a comma', () => expect(addValue('US, ', 'DE')).toBe('US, DE, '));
  test('adds after a value typed without a trailing comma', () => expect(addValue('US,', 'DE')).toBe('US, DE, '));
  test('a pick completes the half-typed piece', () => expect(addValue('US, d', 'DE')).toBe('US, DE, '));
  test('skips a value already present, in any case', () => { expect(addValue('US, DE, ', 'de')).toBe('US, DE, '); expect(addValue('US', 'DE')).toBe('DE, '); });
});

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
  test('equals with several values is an `in` rule, does not equal is `not_in`', () => {
    expect(toTraverseFilter({ field: 'country', op: 'eq', value: 'US, DE, ' }, f())).toEqual({ column: 'country', operator: 'in', value: ['US', 'DE'] });
    expect(toTraverseFilter({ field: 'country', op: 'neq', value: 'US,DE' }, f())).toEqual({ column: 'country', operator: 'not_in', value: ['US', 'DE'] });
  });
  test('one value with a trailing comma stays an equals', () => expect(toTraverseFilter({ field: 'country', op: 'eq', value: 'US, ' }, f())).toEqual({ column: 'country', operator: 'eq', value: 'US' }));
  test('a plain value is untouched; contains keeps its commas', () => {
    expect(toTraverseFilter({ field: 'country', op: 'eq', value: ' US ' }, f())).toEqual({ column: 'country', operator: 'eq', value: ' US ' });
    expect(toTraverseFilter({ field: 'country', op: 'contains', value: 'a, b' }, f())).toEqual({ column: 'country', operator: 'contains', value: 'a, b' });
  });
});
