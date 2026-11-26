import { describe, expect, it } from 'vitest';
import type { Field, Schema } from './types';
import { keepEmpty } from './empty-paths';

const f = (name: string, extra: Partial<Field> = {}): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, ...extra });
const joined = (name: string, aliasPath: string): Field => f(name, { joined: { martId: aliasPath, label: aliasPath, aliasPath } });
const schema: Schema = Object.assign([f('id'), joined('c__name', 'c'), joined('d__name', 'd')], {});

describe('keepEmpty', () => {
  it('keeps the paths a joined field is joined by, once, in order', () => {
    expect(keepEmpty(['d', 'c', 'd'], schema, ['id'])).toEqual(['d', 'c']);
  });

  it('drops a path with a column, the main mart, and a path no field is joined by', () => {
    expect(keepEmpty(['c', '', 'x', 'd'], schema, ['id', 'c__name'])).toEqual(['d']);
  });

  it('gives none for no paths', () => {
    expect(keepEmpty(undefined, schema, ['id'])).toEqual([]);
    expect(keepEmpty([], schema, ['id'])).toEqual([]);
  });
});
