import { describe, expect, it } from 'vitest';
import type { Field, Schema } from './types';
import { dropUniqueSorts, keepUnique, uniqueField, uniqueKey, uniquePathsOf, withUniqueAfter } from './unique-count';

const f = (name: string, extra: Partial<Field> = {}): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...extra });
const joined = (name: string, aliasPath: string): Field => f(name, { joined: { martId: aliasPath, label: aliasPath, aliasPath } });
const schemaOf = (fields: Field[], extra: Partial<Pick<Schema, 'primaryKey' | 'joinedUniqueCount'>> = {}): Schema => Object.assign([...fields], extra);

describe('the Unique Count metric of a mart', () => {
  it('has the row key the backend answers with', () => {
    expect(uniqueKey('')).toBe('Unique Count');
    expect(uniqueKey('customers.countries')).toBe('customers_countries__unique_count');
  });

  it('is offered for the main mart with a key, hidden or composite included, and for the joined marts the backend names', () => {
    expect(uniquePathsOf(schemaOf([f('id', { isPrimaryKey: true })]))).toEqual(['']);
    expect(uniquePathsOf(schemaOf([f('name')], { primaryKey: ['id'] }))).toEqual(['']);
    expect(uniquePathsOf(schemaOf([f('a', { isPrimaryKey: true }), f('b', { isPrimaryKey: true })], { primaryKey: ['a', 'b'] }))).toEqual(['']);
    expect(uniquePathsOf(schemaOf([f('name')]))).toEqual([]);
    expect(uniquePathsOf(schemaOf([f('name')], { primaryKey: [], joinedUniqueCount: ['c'] }))).toEqual(['c']);
  });

  it('stays on while it is offered and its mart has a column on the grid; main first, no repeats', () => {
    const s = schemaOf([f('name'), joined('c__name', 'c'), joined('d__name', 'd')], { primaryKey: ['id'], joinedUniqueCount: ['c', 'd'] });
    expect(keepUnique(['c', '', 'c', 'x', 'd'], s, ['name', 'c__name'])).toEqual(['', 'c']);
    expect(keepUnique(undefined, s, ['name'])).toEqual([]);
    // A joined mart kept in the report with no column keeps its metric; one that is neither shown nor kept does not.
    expect(keepUnique(['c', 'd'], s, ['name'], ['c'])).toEqual(['c']);
    expect(keepUnique(['c'], s, ['name'], [])).toEqual([]);
    expect(keepUnique(['c'], s, ['name'], ['x'])).toEqual([]);
    expect(keepUnique([''], schemaOf([f('name')]), ['name'])).toEqual([]);
  });

  it('has a stand-in field that takes no function', () => {
    const main = uniqueField('');
    expect(main).toMatchObject({ name: 'Unique Count', alias: 'Unique Count', category: 'number', isCalculated: true });
    expect(uniqueField('c', { martId: 'customers', label: 'Customers' }).joined).toEqual({ martId: 'customers', label: 'Customers', aliasPath: 'c' });
  });
});

describe('withUniqueAfter', () => {
  const pathOf = (s: string) => (s.includes('__') ? s.split('__')[0]! : '');
  it('puts a mart\'s metric after its last item, for the marts asked, and nowhere else', () => {
    const items = ['a', 'b', 'c__x', 'c__y', 'd__z'];
    const make = (path: string) => `U(${path})`;
    expect(withUniqueAfter(items, pathOf, ['', 'c'], make)).toEqual(['a', 'b', 'U()', 'c__x', 'c__y', 'U(c)', 'd__z']);
    expect(withUniqueAfter(items, pathOf, [], make)).toEqual(items);
    expect(withUniqueAfter(items, pathOf, ['d'], make)).toEqual(['a', 'b', 'c__x', 'c__y', 'd__z', 'U(d)']);
  });
});

describe('dropUniqueSorts', () => {
  const sorts = [{ field: 'Unique Count', direction: 'asc' as const }, { field: 'c__unique_count', direction: 'desc' as const }, { field: 'a', direction: 'asc' as const }];
  it('takes the sorts of the dropped paths, keeps the rest, and gives null when none is left', () => {
    expect(dropUniqueSorts(sorts, ['c'])).toEqual([sorts[0], sorts[2]]);
    expect(dropUniqueSorts(sorts, [])).toBe(sorts);
    expect(dropUniqueSorts(sorts, ['x'])).toBe(sorts);
    expect(dropUniqueSorts(null, [''])).toBeNull();
    expect(dropUniqueSorts([sorts[0]!], [''])).toBeNull();
    expect(dropUniqueSorts([], [''])).toEqual([]);
  });
});
