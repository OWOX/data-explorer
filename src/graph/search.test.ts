import { matchesSearch } from './search';
import type { Mart } from '../model/types';

const m: Mart = { id: 'o', title: 'Orders', description: 'Customer orders', icon: null, storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: null, accessible: true, sourceKey: null };

test.each([
  ['ord', true],
  ['ORDERS', true],
  ['  ', true],
  ['', true],
  ['refund', false],
  // not the context name, the description or a field name
  ['sales', false],
  ['customer', false],
])('"%s" matches the title only: %s', (q, hit) => {
  expect(matchesSearch(m, q)).toBe(hit);
});
