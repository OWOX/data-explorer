import type { JoinedSource } from '../../api/blendable';
import { martsAtTwoPaths, matchedFrom } from './matched';

const source = (aliasPath: string, martId: string, column: string) => ({ aliasPath, martId, label: martId, fields: [{ name: column }] }) as unknown as JoinedSource;

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

describe('martsAtTwoPaths', () => {
  const sources = [source('a', 'm1', 'a__x'), source('b', 'm1', 'b__x'), source('c', 'm2', 'c__x'), source('d', 'orders', 'd__x')];
  test('a mart with columns at two paths, or one kept with none beside one with columns, is at two paths', () => {
    expect([...martsAtTwoPaths('orders', ['id', 'a__x', 'b__x', 'c__x'], sources)]).toEqual(['m1']);
    expect([...martsAtTwoPaths('orders', ['id', 'a__x', 'c__x'], sources, ['b'])]).toEqual(['m1']);
  });
  test('a path with no column and not kept is no path of the report', () => {
    expect(martsAtTwoPaths('orders', ['id', 'a__x', 'c__x'], sources).size).toBe(0);
  });
  test('the main mart joined to itself is at two paths', () => {
    expect([...martsAtTwoPaths('orders', ['id', 'd__x'], sources)]).toEqual(['orders']);
  });
});
