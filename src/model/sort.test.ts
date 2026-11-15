import { cycleSort, type SortKey } from './sort';

test('a column cycles none, ascending, descending, none', () => {
  let s: SortKey[] = [];
  s = cycleSort(s, 'a');
  expect(s).toEqual([{ field: 'a', direction: 'asc' }]);
  s = cycleSort(s, 'a');
  expect(s).toEqual([{ field: 'a', direction: 'desc' }]);
  expect(cycleSort(s, 'a')).toEqual([]);
});

test('precedence is the order of first sort; cycling keeps the place, removing drops only that column', () => {
  let s = cycleSort(cycleSort(cycleSort([], 'a'), 'b'), 'c');
  expect(s.map((k) => k.field)).toEqual(['a', 'b', 'c']);
  s = cycleSort(s, 'a');
  expect(s).toEqual([{ field: 'a', direction: 'desc' }, { field: 'b', direction: 'asc' }, { field: 'c', direction: 'asc' }]);
  s = cycleSort(cycleSort(s, 'b'), 'b');
  expect(s.map((k) => k.field)).toEqual(['a', 'c']);
});
