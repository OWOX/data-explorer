import { operatorsFor } from './catalogue';
import type { Field } from '../model/types';

const f = (type: string, category: Field['category']): Field => ({ name: 'x', alias: null, type, category, description: null, isPrimaryKey: false });
const ids = (field: Field) => operatorsFor(field).map((o) => o.id);

test('string operators', () => {
  expect(ids(f('STRING', 'string'))).toEqual(['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'ends_with', 'is_blank', 'is_not_blank']);
});
test('number operators', () => {
  expect(ids(f('INT64', 'number'))).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_blank', 'is_not_blank']);
});
test('DATE offers "on"; TIMESTAMP does not', () => {
  expect(ids(f('DATE', 'date'))).toEqual(['on', 'before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
  expect(ids(f('TIMESTAMP', 'date'))).toEqual(['before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
});
test('time, boolean and other', () => {
  expect(ids(f('TIME', 'time'))).toEqual(['before', 'after', 'between', 'is_blank', 'is_not_blank']);
  expect(ids(f('BOOL', 'boolean'))).toEqual(['is_true', 'is_false', 'is_blank']);
  expect(ids(f('JSON', 'other'))).toEqual(['is_blank', 'is_not_blank']);
});
