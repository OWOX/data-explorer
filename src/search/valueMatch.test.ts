// src/search/valueMatch.test.ts
import { describe, expect, it } from 'vitest';
import { matchTiers, normalize, readValues } from './valueMatch';
import { stubCtx, traversalOf } from '../api/test-ctx';

describe('normalize', () => {
  it('normalizes', () => expect(normalize('Côte d’Ivoire!')).toBe('cotedivoire'));
});

it('reads the top values of a field, and nothing on failure', async () => {
  const ctx = stubCtx({ dataMarts: { traverseData: async () => traversalOf([{ country: 'DE' }, { country: 'FR' }, { country: null }]) } });
  const field = { name: 'country', alias: null, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false };
  expect(await readValues(ctx, 'm', field, new AbortController().signal)).toEqual(['DE', 'FR']);
  const broken = stubCtx({ dataMarts: { traverseData: async () => { throw new Error('x'); } } });
  expect(await readValues(broken, 'm', field, new AbortController().signal)).toEqual([]);
});

it('matchTiers splits the matches by tier', () => {
  expect(matchTiers('us', ['US', 'Usa', 'bus'])).toEqual([['US'], ['US'], ['US', 'Usa']]);
});
