import type { Field } from '../model/types';
import { sankeyColumnQuery, sankeyFlowQuery, SANKEY_COLUMN_LIMIT, SANKEY_FLOW_LIMIT, type Measure } from './queries';

const fld = (name: string): Field => ({ name, alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false });
const [src, dst, chan] = [fld('source'), fld('status'), fld('channel')];
const sum: Measure = { kind: 'metric', metric: { field: { ...fld('amount'), type: 'FLOAT', category: 'number' }, fn: 'SUM' } };
const recs: Measure = { kind: 'records', aliasPath: '', recordsId: 'records:M' };
const base = [{ column: 'country', operator: 'eq' as const, value: 'US' }];

test('the flow read groups on every column with the measure, largest first, capped', () => {
  expect(sankeyFlowQuery([src, dst, chan], sum, base)).toEqual({
    column: ['source', 'status', 'channel', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }],
    sort: [{ column: 'amount', direction: 'desc' }], limit: SANKEY_FLOW_LIMIT, filter: base,
  });
  expect(SANKEY_FLOW_LIMIT).toBe(5000);
});

test('a records flow read counts uniquely and sorts by that count', () => {
  const o = sankeyFlowQuery([src, dst], recs, []);
  expect(o.column).toEqual(['source', 'status']);
  expect(o.uniqueCount).toEqual(['']);
  expect(o.sort).toEqual([{ column: 'Unique Count', direction: 'desc' }]);
  expect(o.filter).toBeUndefined();
});

test('a column read groups on its dimension alone, with no top limit but a high cap', () => {
  expect(sankeyColumnQuery(src, sum, base)).toEqual({
    column: ['source', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }],
    sort: [{ column: 'amount', direction: 'desc' }], limit: SANKEY_COLUMN_LIMIT, filter: base,
  });
  expect(SANKEY_COLUMN_LIMIT).toBeGreaterThan(100);
});

test('pre-join slices are kept (the reads name columns) and HAVING rules are dropped', () => {
  const slice = { column: 'a', operator: 'eq' as const, value: 1, placement: 'pre-join' as const };
  const having = { column: 'b', operator: 'gt' as const, value: 1, function: 'SUM' as const };
  expect(sankeyFlowQuery([src, dst], recs, [slice, having], fld('id')).filter).toEqual([slice]);
  expect(sankeyColumnQuery(src, recs, [slice, having], fld('id')).filter).toEqual([slice]);
});
