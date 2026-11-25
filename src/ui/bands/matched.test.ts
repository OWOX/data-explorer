import { matchedFrom } from './matched';

describe('matchedFrom', () => {
  test('reads each path under its unique count key, numbers or digit strings', () => {
    const row = { 'Unique Count': 12, c_x__unique_count: '7', other__unique_count: 3 };
    expect([...matchedFrom(row, ['', 'c.x'])]).toEqual([['', 12], ['c.x', 7]]);
  });
  test('leaves out a count that is missing, blank, negative or not a number', () => {
    const row = { 'Unique Count': null, a__unique_count: '', b__unique_count: 'abc', c__unique_count: -1, d__unique_count: 0 };
    expect([...matchedFrom(row, ['', 'a', 'b', 'c', 'd', 'e'])]).toEqual([['d', 0]]);
    expect(matchedFrom(undefined, [''])).toEqual(new Map());
  });
});
