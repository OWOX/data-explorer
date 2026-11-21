import type { ChartFields } from '../fields';
import { spread } from './spread';

const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const plain = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const net = { name: 'net', category: 'number', type: 'NUMERIC', allowedAggregations: ['SUM', 'P25', 'P50', 'P75'] } as never;
const mk = (metrics: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: true, metrics, dates: [], dimensions: [s] }], dates: [], dimensions: [s], counter: null });

test('spread is offered only for metrics whose governance allows the three percentiles', () => {
  expect(spread.eligible(mk([{ field: plain, fn: 'SUM' }] as never))).toBe(false);
  const cf = mk([{ field: plain, fn: 'SUM' }, { field: net, fn: 'SUM' }] as never);
  expect(spread.eligible(cf)).toBe(true);
  expect(spread.resolve({ id: 's', kind: 'spread', measure: 'amount' }, cf)!.field).toBe(net);
});
