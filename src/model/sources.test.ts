import { groupSources } from './sources';
import type { Mart } from './types';

const mart = (id: string, sourceKey: string | null, extra: Partial<Mart> = {}): Mart => ({
  id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, sourceKey, ...extra,
});

test('groups accessible marts by connector key', () => {
  const sources = groupSources([mart('a', 'Shopify'), mart('b', 'Shopify'), mart('c', 'GA4')], []);
  expect(sources.map((s) => [s.key, s.martIds])).toEqual([['Shopify', ['a', 'b']], ['GA4', ['c']]]);
});

test('skips marts without a source and inaccessible marts', () => {
  const sources = groupSources([mart('a', null), mart('b', 'X', { accessible: false }), mart('c', 'Y')], []);
  expect(sources.map((s) => s.key)).toEqual(['Y']);
});

test('uses the connector title and string logo, falling back to the key and null', () => {
  const sources = groupSources(
    [mart('a', 'A'), mart('b', 'B'), mart('c', 'C')],
    [{ name: 'A', title: 'Alpha', logo: 'data:image/png;base64,xx' }, { name: 'B', title: null, logo: { svg: 1 } }],
  );
  const by = Object.fromEntries(sources.map((s) => [s.key, s]));
  expect(by.A).toMatchObject({ name: 'Alpha', logo: 'data:image/png;base64,xx' });
  expect(by.B).toMatchObject({ name: 'B', logo: null });
  expect(by.C).toMatchObject({ name: 'C', logo: null });
});

test('orders by mart count descending, then name', () => {
  const sources = groupSources(
    [mart('1', 'Zed'), mart('2', 'Beta'), mart('3', 'Alpha'), mart('4', 'Big'), mart('5', 'Big')],
    [],
  );
  expect(sources.map((s) => s.key)).toEqual(['Big', 'Alpha', 'Beta', 'Zed']);
});
