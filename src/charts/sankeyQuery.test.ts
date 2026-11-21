import type { Field } from '../model/types';
import { sankeyPairQuery, type Measure } from './queries';

const fld = (name: string): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false });
const [src, dst] = [fld('source'), fld('status')];
const sum: Measure = { kind: 'metric', metric: { field: { ...fld('amount'), type: 'FLOAT', category: 'number' }, fn: 'SUM' } };
const recs: Measure = { kind: 'records', aliasPath: '', recordsId: 'records:M' };
const base = [{ column: 'country', operator: 'eq' as const, value: 'US' }];

test('a pair of listed values groups on both columns and keeps both to their lists', () => {
  expect(sankeyPairQuery(src, { kind: 'in', top: ['web', 'ads'] }, dst, { kind: 'in', top: ['paid'] }, sum, base)).toEqual({
    column: ['source', 'status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }],
    filter: [...base, { column: 'source', operator: 'in', value: ['web', 'ads'] }, { column: 'status', operator: 'in', value: ['paid'] }],
  });
});

test('a blank side is read with is_blank and not grouped on', () => {
  const o = sankeyPairQuery(src, { kind: 'blank' }, dst, { kind: 'in', top: ['paid'] }, recs, []);
  expect(o.column).toEqual(['status']);
  expect(o.uniqueCount).toEqual(['']);
  expect(o.filter).toEqual([{ column: 'source', operator: 'is_blank' }, { column: 'status', operator: 'in', value: ['paid'] }]);
});

test('an Other side is read as not blank and not in the list, and not grouped on', () => {
  const o = sankeyPairQuery(src, { kind: 'in', top: ['web'] }, dst, { kind: 'other', top: ['paid', 'open'] }, sum, []);
  expect(o.column).toEqual(['source', 'amount']);
  expect(o.filter).toEqual([
    { column: 'source', operator: 'in', value: ['web'] },
    { column: 'status', operator: 'is_not_blank' }, { column: 'status', operator: 'not_in', value: ['paid', 'open'] },
  ]);
});

test('blank by Other reads one row of the measure', () => {
  const o = sankeyPairQuery(src, { kind: 'blank' }, dst, { kind: 'other', top: ['paid'] }, sum, []);
  expect(o.column).toEqual(['amount']);
  expect(o.filter).toHaveLength(3);
});

test('a records read with no column of its own counts through the counter when a slice is set', () => {
  const counter = fld('id');
  const o = sankeyPairQuery(src, { kind: 'blank' }, dst, { kind: 'blank' }, recs, [{ column: 'a', operator: 'eq', value: 1, placement: 'pre-join' }], counter);
  expect(o.column).toEqual(['id']);
  expect(o.aggregation).toEqual([{ column: 'id', function: 'COUNT' }]);
});
