import type { Mart, Model } from '../model/types';
import { contextOptions, matchesContexts, NO_CONTEXT, tickedContexts } from './contexts';

const model = (contexts: Model['contexts']): Model => ({ marts: new Map(), sources: [], edges: [], contexts, storages: [], failedStorages: [] });
const two = model([{ id: 'c2', name: 'Sales', icon: null }, { id: 'c1', name: 'Finance', icon: null }]);
const mart = (contextIds: string[]): Mart => ({ id: 'm', title: 'M', description: null, icon: null, storageId: 's', contextIds, dataLastUpdatedAt: null, accessible: true, sourceKey: null });

test('the options are the contexts by name', () => {
  expect(contextOptions(two).map((c) => c.name)).toEqual(['Finance', 'Sales']);
});

test('null, and every box ticked, narrow nothing', () => {
  expect(tickedContexts(two, null)).toBeNull();
  expect(tickedContexts(two, ['c1', 'c2', NO_CONTEXT])).toBeNull();
});

test('a project with no contexts has no filter', () => {
  expect(tickedContexts(model([]), ['c1'])).toBeNull();
});

test('unticking narrows; a removed context drops out; an empty choice stays empty', () => {
  expect(tickedContexts(two, ['c1', NO_CONTEXT])).toEqual(['c1', NO_CONTEXT]);
  expect(tickedContexts(two, ['c1', 'gone'])).toEqual(['c1']);
  expect(tickedContexts(two, ['gone'])).toBeNull();
  expect(tickedContexts(two, [])).toEqual([]);
});

test('matchesContexts: a context, or none when "Without context" is ticked', () => {
  expect(matchesContexts(mart(['c1']), null)).toBe(true);
  expect(matchesContexts(mart(['c1', 'c2']), ['c2'])).toBe(true);
  expect(matchesContexts(mart(['c1']), ['c2', NO_CONTEXT])).toBe(false);
  expect(matchesContexts(mart([]), ['c1'])).toBe(false);
  expect(matchesContexts(mart([]), ['c1', NO_CONTEXT])).toBe(true);
  expect(matchesContexts(mart(['c1']), [])).toBe(false);
});
