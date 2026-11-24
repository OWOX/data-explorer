import { expect, it } from 'vitest';
import { applyCharts, buildChartQuestions, mergeCharts, type ChartCandidate } from './charts';

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
it('saves version 2 settings so the charts survive a reload', () => {
  expect(mergeCharts({}, [c('pie', 'pie')], 1).version).toBe(2);
});
it('does not treat charts with different second measures as equal', () => {
  const sc = { key: 'scatter', spec: { kind: 'scatter' as const, dimension: 'country', measure: 'spend', measure2: 'clicks' } };
  const merged = mergeCharts({ charts: [{ id: 'm', kind: 'scatter', dimension: 'country', measure: 'spend', measure2: 'cost' }] }, [sc], 1);
  expect(merged.charts!.map((s) => s.id)).toEqual(['ai-scatter-1-0', 'm']);
});
it('asks nothing for a single candidate', () => {
  const input = { query: 'q', intent: { chartHint: null } } as never;
  expect(buildChartQuestions(input, [c('bar', 'bar')])).toBeNull();
  expect(buildChartQuestions(input, cands)!.questions.primary).toBeDefined();
});
it('cleans the strings of a chart spec before the model sees them', () => {
  const dirty = { key: 'bar', spec: { kind: 'bar' as const, measure: `sp\u0000end${'x'.repeat(200)}`, dimension: 'country' } };
  const asked = buildChartQuestions({ query: 'q', intent: { chartHint: null } } as never, [dirty, c('pie', 'pie')])!;
  const charts = (asked.state as { charts: { measure: string }[] }).charts;
  expect(charts[0]!.measure).toHaveLength(120);
  expect(charts[0]!.measure).not.toContain('\u0000');
});
