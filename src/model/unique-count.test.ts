import { describe, expect, it } from 'vitest';
import type { Field, Schema } from './types';
import { keepUnique, uniqueField, uniqueKey, uniquePathsOf } from './unique-count';

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
    expect(keepUnique([''], schemaOf([f('name')]), ['name'])).toEqual([]);
  });

  it('has a stand-in field that takes no function', () => {
    const main = uniqueField('');
    expect(main).toMatchObject({ name: 'Unique Count', alias: 'Unique Count', category: 'number', isCalculated: true });
    expect(uniqueField('c', { martId: 'customers', label: 'Customers' }).joined).toEqual({ martId: 'customers', label: 'Customers', aliasPath: 'c' });
  });
});
