import { chartFields, measuresOf } from './fields';
import { axisTitle, fieldGroups, martTitleOf, measureAxisTitle, measureGroups } from './menuGroups';
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

test('an axis title names the field and the data mart the menus group it under', () => {
  expect(martTitleOf(cf, '')).toBe('Contacts');
  expect(martTitleOf(cf, 'org')).toBe('Contact Organization');
  expect(axisTitle(cf, schema[2]!)).toBe('channel | Contacts');
  expect(axisTitle(cf, schema[3]!)).toBe('Contact Organization · org__name | Contact Organization');
});

test('a measure axis title carries the mart of its field, a Count Unique the mart it counts', () => {
  const [records, amount, , orgSize] = [measuresOf(cf)[0]!, measuresOf(cf)[1]!, measuresOf(cf)[2]!, measuresOf(cf)[3]!];
  expect(measureAxisTitle(cf, amount)).toBe('amount · Sum | Contacts');
  expect(measureAxisTitle(cf, orgSize)).toBe('org__size · Sum | Contact Organization');
  expect(measureAxisTitle(cf, records)).toBe('Count Unique | Contacts');
});

test('a mart without a title adds no suffix', () => {
  const bare = chartFields(schema, ['id', 'channel'], NO_AGGREGATION, 'M', ['']);
  expect(axisTitle(bare, schema[2]!)).toBe('channel');
});
