import type { ChartFields } from '../fields';
import { heatmap } from './heatmap';

const date = { name: 'day', category: 'date', type: 'DATE' } as never;
const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const c = { name: 'channel', category: 'string', type: 'STRING' } as never;
const amt = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const mk = (dates: never[], dims: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: amt, fn: 'SUM' }], dates, dimensions: dims }], dates, dimensions: dims, counter: null });

test('heatmap columns: a saved second dimension, else the date, else another dimension', () => {
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap', dimension: 'status', dimension2: 'channel' }, mk([date], [s, c]))!.cols).toEqual({ kind: 'dim', dim: c });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap', dimension: 'status' }, mk([date], [s, c]))!.cols).toMatchObject({ kind: 'date', date });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap' }, mk([], [s, c]))!.cols).toEqual({ kind: 'dim', dim: c });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap' }, mk([], [s]))).toBeNull();
  expect(heatmap.eligible(mk([], [s]))).toBe(false);
  expect(heatmap.eligible(mk([date], [s]))).toBe(true);
});
