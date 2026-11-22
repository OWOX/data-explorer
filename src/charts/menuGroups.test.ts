import { chartFields, measuresOf } from './fields';
import { fieldGroups, measureGroups } from './menuGroups';
import { NO_AGGREGATION } from '../model/aggregation';
import type { Field } from '../model/types';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const org = { martId: 'O', label: 'Contact Organization', aliasPath: 'org' };
const schema = [
  f('id', 'string', { isPrimaryKey: true }), f('amount', 'number'), f('channel', 'string'),
  f('org__name', 'string', { joined: org }), f('org__size', 'number', { joined: org }),
];
const cf = chartFields(schema, ['id', 'amount', 'channel', 'org__name', 'org__size'], NO_AGGREGATION, 'M', ['', 'org'], new Set(['org']), { '': 'Contacts', org: 'Contact Organization' }, undefined, { org: 'lucide:building' });

test('the dimensions of a two-mart chart come out as two groups, main first, with unprefixed labels', () => {
  const groups = fieldGroups(cf, cf.dimensions);
  expect(groups.map((g) => g.title)).toEqual(['Contacts', 'Contact Organization']);
  expect(groups.map((g) => g.icon)).toEqual([undefined, 'lucide:building']);
  expect(groups.map((g) => g.options)).toEqual([[{ value: 'channel', label: 'channel' }], [{ value: 'org__name', label: 'org__name' }]]);
});

test('a field shows its own label and a Count Unique sits in its mart group', () => {
  const aliased = { ...cf, dimensions: [{ ...schema[3]!, alias: 'Name' }] };
  expect(fieldGroups(aliased, aliased.dimensions)[0]!.options[0]!.label).toBe('Name');
  const groups = measureGroups(cf, measuresOf(cf));
  expect(groups.map((g) => g.title)).toEqual(['Contacts', 'Contact Organization']);
  expect(groups[0]!.options.map((o) => o.label)).toEqual(['Count Unique', 'amount · Sum']);
  expect(groups[1]!.options.map((o) => o.label)).toEqual(['Count Unique', 'org__size · Sum']);
});

test('a mart with none of the fields has no group', () => {
  expect(fieldGroups(cf, [schema[2]!]).map((g) => g.title)).toEqual(['Contacts']);
});
