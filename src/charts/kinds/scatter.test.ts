import type { ChartFields } from '../fields';
import { scatter } from './scatter';

const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const a = { name: 'a', category: 'number', type: 'NUMERIC' } as never;
const b = { name: 'b', category: 'number', type: 'NUMERIC' } as never;
const mk = (metrics: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics, dates: [], dimensions: [s] }], dates: [], dimensions: [s], counter: null });

test('scatter needs two measures; Y defaults to the first measure that is not X', () => {
  expect(scatter.eligible(mk([{ field: a, fn: 'SUM' }] as never))).toBe(false);
  const cf = mk([{ field: a, fn: 'SUM' }, { field: b, fn: 'SUM' }] as never);
  const r = scatter.resolve({ id: 's', kind: 'scatter' }, cf)!;
  expect([r.x, r.y].map((m) => m.kind === 'metric' && m.metric.field.name)).toEqual(['a', 'b']);
  expect(scatter.resolve({ id: 's', kind: 'scatter', measure: 'b', measure2: 'b' }, cf)!.y).toMatchObject({ metric: { field: a } });
});
