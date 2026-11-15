import { matchesContexts, matchesSearch } from './search';
import type { Mart, Schema } from '../model/types';

const m: Mart = { id: 'o', title: 'Orders', description: null, icon: null, storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: null, accessible: true, sourceKey: null };
const contexts = [{ id: 'c1', name: 'Sales', icon: null }];
const schema: Schema = [{ name: 'customer_id', alias: 'Customer', type: 'INT64', category: 'number', description: null, isPrimaryKey: false }];

test.each([
  ['ord', true, undefined],
  ['sales', true, undefined],
  ['customer_', true, 'customer_id'],
  ['CUSTOMER', true, 'customer_id'],
  ['refund', false, undefined],
  ['  ', true, undefined],
])('"%s" → %s', (q, hit, field) => {
  expect(matchesSearch(m, q, contexts, schema)).toEqual(field ? { hit, field } : { hit });
});

test('a field query does not match while the schema is unknown', () => {
  expect(matchesSearch(m, 'customer_', contexts, undefined)).toEqual({ hit: false });
});

test('matchesContexts: any selected context matches; none selected matches all', () => {
  expect(matchesContexts(m, [])).toBe(true);
  expect(matchesContexts(m, ['c9', 'c1'])).toBe(true);
  expect(matchesContexts(m, ['c9'])).toBe(false);
});
