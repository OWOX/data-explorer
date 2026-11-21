import { BLANK_KEY, BLANK_LABEL, blankFirst, keyOf, labelOf } from './blank';

test('null and undefined are the blank key; anything else is its text', () => {
  expect(keyOf(null)).toBe(BLANK_KEY);
  expect(keyOf(undefined)).toBe(BLANK_KEY);
  expect(keyOf(false)).toBe('false');
  expect(keyOf('null')).toBe('null');
  expect(labelOf(BLANK_KEY)).toBe(BLANK_LABEL);
  expect(labelOf('a')).toBe('a');
});

test('blankFirst puts the blank key first and keeps the rest in order', () => {
  expect(blankFirst(['b', 'a', BLANK_KEY])).toEqual([BLANK_KEY, 'b', 'a']);
});
