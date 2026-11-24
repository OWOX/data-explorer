import { expect, it } from 'vitest';
import { applyCharts, mergeCharts, type ChartCandidate } from './charts';

const c = (key: string, kind: ChartCandidate['spec']['kind']): ChartCandidate => ({ key, spec: { kind, measure: 'spend', dimension: 'country' } });
const cands = [c('bar', 'bar'), c('pie', 'pie'), c('rankedBar', 'rankedBar'), c('spread', 'spread')];

it('takes the primary then up to two scored yes', () => {
  const s = (level: number) => ({ type: 'score' as const, level });
  const picked = applyCharts({ primary: { type: 'choice', choice: 'pie' }, x0: s(2), x2: s(2), x3: s(2) }, cands);
  expect(picked.map((p) => p.key)).toEqual(['pie', 'bar', 'rankedBar']);
});
it('picks nothing without a primary answer', () => {
  expect(applyCharts({}, cands)).toEqual([]);
});
it('puts new charts first, keeps saved ones and skips duplicates', () => {
  const merged = mergeCharts({ charts: [{ id: 'mine', kind: 'bar', measure: 'spend', dimension: 'country' }, { id: 'x', kind: 'line' }] }, [c('bar', 'bar'), c('pie', 'pie')], 1);
  expect(merged.charts!.map((s) => s.id)).toEqual(['ai-pie-1-1', 'mine', 'x']);
});
it('keeps the default charts when the member saved none', () => {
  const merged = mergeCharts({}, [c('pie', 'pie')], 1);
  expect(merged.charts!.map((s) => s.id)).toEqual(['ai-pie-1-0', 'time-series', 'pie']);
});
