import type { JoinedSource } from '../api/blendable';
import { NO_AGGREGATION } from '../model/aggregation';
import type { Field, Schema } from '../model/types';
import { chartSetsOf } from './chartSets';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const joined = { martId: 'customers', label: 'Customers', aliasPath: 'customers' };
const schema: Schema = Object.assign([f('id', 'string', { isPrimaryKey: true }), f('amount', 'number'), f('customers__email', 'string', { joined })], { primaryKey: ['id'] });
const source = (uniqueCount: boolean): JoinedSource => ({ aliasPath: 'customers', martId: 'customers', label: 'Customers', depth: 1, fields: [schema[2]!], uniqueCount, mainGrainCollapse: 'collapses', mainGrainMultiplication: 'unknown' });
const main = { path: '', title: 'Orders' };
const customers = { path: 'customers', title: 'Customers' };

test('a mart shown only by its Unique Count is one chart mart, and offers Count Unique', () => {
  const groups = [main, customers];
  // The same mart is also a path mart kept empty: it must not be listed twice.
  const { chart, cf } = chartSetsOf(schema, ['id', 'amount'], NO_AGGREGATION, 'orders', groups, groups, [customers], [source(true)]);
  expect(chart.marts.map((m) => m.aliasPath)).toEqual(['', 'customers']);
  expect(chart.marts[1]!.hasPk).toBe(true);
  expect(cf.marts[1]!.hasPk).toBe(true);
});

test('a path mart that is no group still lists after the groups, with no Count Unique', () => {
  const { chart } = chartSetsOf(schema, ['id'], NO_AGGREGATION, 'orders', [main], [main], [customers], [source(true)]);
  expect(chart.marts.map((m) => m.aliasPath)).toEqual(['', 'customers']);
  expect(chart.marts[1]!.hasPk).toBe(false);
});
