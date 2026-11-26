import { cycleSort, defaultSort, keptSorts, sortsOnColumns, type SortKey } from './sort';
import type { Field } from './types';

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

describe('defaultSort', () => {
  const f = (name: string, type: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category, description: null, isPrimaryKey: false, ...extra });
  const schema = [f('id', 'INT64', 'number'), f('placed', 'DATE', 'date'), f('created_at', 'TIMESTAMP', 'date'), f('closed', 'DATETIME', 'date'), f('name', 'STRING', 'string')];

  test('the first date, datetime or timestamp field in schema order, newest first', () => {
    expect(defaultSort(schema, ['id', 'placed', 'created_at'])).toEqual([{ field: 'placed', direction: 'desc' }]);
    expect(defaultSort(schema.slice(2), [])).toEqual([{ field: 'created_at', direction: 'desc' }]);
    expect(defaultSort([f('d', 'DATETIME', 'date')], [])).toEqual([{ field: 'd', direction: 'desc' }]);
  });

  test('a date among the visible columns wins over an earlier one that is not shown', () => {
    expect(defaultSort(schema, ['id', 'created_at'])).toEqual([{ field: 'created_at', direction: 'desc' }]);
    expect(defaultSort(schema, ['id', 'closed'])).toEqual([{ field: 'closed', direction: 'desc' }]);
  });

  test('with none visible it falls back to the first in schema; with no date field there is no default', () => {
    expect(defaultSort(schema, ['id', 'name'])).toEqual([{ field: 'placed', direction: 'desc' }]);
    expect(defaultSort([f('id', 'INT64', 'number'), f('t', 'TIME', 'time')], ['id'])).toEqual([]);
  });

  test('a calculated date field is not sorted on', () => {
    expect(defaultSort([f('calc', 'DATE', 'date', { isCalculated: true }), f('real', 'DATE', 'date')], [])).toEqual([{ field: 'real', direction: 'desc' }]);
  });
});

describe('keptSorts', () => {
  const a: SortKey = { field: 'a', direction: 'asc' };
  it('keeps null as null', () => expect(keptSorts(null, [])).toBeNull());
  it('turns a list that pruning emptied into null', () => expect(keptSorts([a], [])).toBeNull());
  it('keeps what is left', () => expect(keptSorts([a], [a])).toEqual([a]));
  it('keeps an empty list that was empty', () => expect(keptSorts([], [])).toEqual([]));
});
