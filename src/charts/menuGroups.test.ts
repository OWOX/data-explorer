import { chartFields, measuresOf } from './fields';
import { axisTitle, BUCKET_OPTIONS, dimensionItem, fieldGroups, martTitleOf, measureAxisTitle, measureGroups, metricItem } from './menuGroups';
import { measureId } from './settings';
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
  expect(axisTitle(cf, schema[3]!)).toBe('org__name | Contact Organization');
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

test('a joined mart\'s Count Unique names its mart once on the axis', () => {
  const orgRecords = measuresOf(cf).find((m) => m.kind === 'records' && m.aliasPath === 'org')!;
  expect(measureAxisTitle(cf, orgRecords)).toBe('Count Unique | Contact Organization');
});

test('a field with a description carries it as its hint, in the field and the measure lists; a blank one carries none', () => {
  const described = { ...cf, dimensions: [{ ...schema[2]!, description: ' Where it came from ' }, { ...schema[3]!, description: '  ' }] };
  expect(fieldGroups(described, described.dimensions).map((g) => g.options)).toEqual([[{ value: 'channel', label: 'channel', hint: 'Where it came from' }], [{ value: 'org__name', label: 'org__name' }]]);
  const amount = measuresOf(cf)[1]!;
  const withText = amount.kind === 'metric' ? { ...amount, metric: { ...amount.metric, field: { ...amount.metric.field, description: 'Net' } } } : amount;
  expect(measureGroups(cf, [measuresOf(cf)[0]!, withText])[0]!.options.map((o) => o.hint)).toEqual([undefined, 'Net']);
});

test('builds the Metric row that patches the measure', () => {
  const picked: unknown[] = [];
  const list = measuresOf(cf);
  const item = metricItem(cf, measureId(list[1]!), list, (p) => picked.push(p));
  expect(item.label).toBe('Metric');
  if (item.kind !== 'radio') throw new Error('expected a radio row');
  expect(item.value).toBe(measureId(list[1]!));
  expect(item.groups!.map((g) => g.title)).toEqual(['Contacts', 'Contact Organization']);
  item.onPick(item.groups![1]!.options[0]!.value);
  expect(picked).toEqual([{ measure: item.groups![1]!.options[0]!.value }]);
});

test('builds the Dimension row that patches the dimension', () => {
  const picked: unknown[] = [];
  const item = dimensionItem(cf, 'channel', (p) => picked.push(p));
  expect(item.label).toBe('Dimension');
  if (item.kind !== 'radio') throw new Error('expected a radio row');
  expect(item.value).toBe('channel');
  item.onPick('org__name');
  expect(picked).toEqual([{ dimension: 'org__name' }]);
});

test('the bucket options start with Auto', () => {
  expect(BUCKET_OPTIONS[0]).toEqual({ value: 'AUTO', label: 'Auto' });
  expect(BUCKET_OPTIONS.length).toBeGreaterThan(3);
});
