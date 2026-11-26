import { moveColumn } from './kinds/sankey';

test('moveColumn: forward, backward, same place and out of range', () => {
  expect(moveColumn(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
  expect(moveColumn(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  expect(moveColumn(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  expect(moveColumn(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  expect(moveColumn(['a', 'b', 'c'], 0, 3)).toEqual(['a', 'b', 'c']);
  expect(moveColumn(['a', 'b', 'c'], -1, 1)).toEqual(['a', 'b', 'c']);
  expect(moveColumn(['a', 'b', 'c'], 3, 0)).toEqual(['a', 'b', 'c']);
});
