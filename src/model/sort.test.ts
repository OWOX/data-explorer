import { cycleSort, sortsOnColumns, type SortKey } from './sort';

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

test('sortsOnColumns drops the sorts on columns that are not shown and keeps the order of the rest', () => {
  const s: SortKey[] = [{ field: 'a', direction: 'asc' }, { field: 'b', direction: 'desc' }, { field: 'c', direction: 'asc' }];
  expect(sortsOnColumns(s, ['a', 'c'])).toEqual([s[0], s[2]]);
  expect(sortsOnColumns(s, ['a', 'b', 'c'])).toBe(s);
});
