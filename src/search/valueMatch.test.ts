// src/search/valueMatch.test.ts
import { describe, expect, it } from 'vitest';
import { matchValue, normalize, readValues } from './valueMatch';
import { stubCtx, traversalOf } from '../api/test-ctx';

describe('matchValue', () => {
  const values = ['Germany', 'germany', 'DE', 'Côte d’Ivoire', 'New York', 'New Zealand'];
  it('prefers case-insensitive equality', () => expect(matchValue('GERMANY', values)).toEqual(['Germany', 'germany']));
  it('then equality without spaces, punctuation or accents', () => expect(matchValue("cote d'ivoire", values)).toEqual(['Côte d’Ivoire']));
  it('then a whole-word prefix', () => expect(matchValue('new', values)).toEqual(['New York', 'New Zealand']));
  it('finds nothing for an unrelated word', () => expect(matchValue('france', values)).toEqual([]));
  it('normalizes', () => expect(normalize('Côte d’Ivoire!')).toBe('cotedivoire'));
});

it('reads the top values of a field, and nothing on failure', async () => {
  const ctx = stubCtx({ dataMarts: { traverseData: async () => traversalOf([{ country: 'DE' }, { country: 'FR' }, { country: null }]) } });
  const field = { name: 'country', alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false };
  expect(await readValues(ctx, 'm', field, new AbortController().signal)).toEqual(['DE', 'FR']);
  const broken = stubCtx({ dataMarts: { traverseData: async () => { throw new Error('x'); } } });
  expect(await readValues(broken, 'm', field, new AbortController().signal)).toEqual([]);
});
