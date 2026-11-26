import { describe, expect, it } from 'vitest';
import type { Field, Schema } from '../../model/types';
import type { GridState } from '../../state/store';
import { applyCharts, buildChartQuestions, chartCandidates, mergeCharts, type ChartCandidate } from './charts';

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

describe('chartCandidates', () => {
  const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: false });
  const schema = [f('day', 'date'), f('country', 'string'), f('channel', 'string'), f('spend', 'number'), f('clicks', 'number')] as Schema;
  const keyed = Object.assign([...schema], { primaryKey: ['day'] }) as Schema;
  const grid = (columns: string[], extra: Partial<GridState> = {}): GridState => ({ columns, filters: {}, sorts: null, limit: 200, ...extra });
  const kinds = (g: GridState, sc: Schema = schema) => chartCandidates(g, sc).map((c) => c.spec.kind);

  it('offers time charts only with a date and a measure', () => {
    expect(kinds(grid(['day', 'spend']))).toEqual(expect.arrayContaining(['timeSeries', 'line']));
    expect(kinds(grid(['country', 'spend']))).not.toContain('timeSeries');
  });
  it('offers bar, ranked bar and pie for a text breakdown and a measure', () => {
    expect(kinds(grid(['country', 'spend']))).toEqual(expect.arrayContaining(['bar', 'rankedBar', 'pie', 'spread']));
  });
  it('offers heatmap and sankey for two breakdowns', () => {
    expect(kinds(grid(['country', 'channel', 'spend'], { aggregations: [{ column: 'spend', function: 'SUM' }] }))).toEqual(expect.arrayContaining(['heatmap', 'sankey']));
  });
  it('does not offer sankey for a measure that does not add up', () => {
    expect(kinds(grid(['country', 'channel', 'spend'], { aggregations: [{ column: 'spend', function: 'AVG' }] }))).not.toContain('sankey');
  });
  it('offers scatter for two measures and a text breakdown', () => {
    expect(kinds(grid(['country', 'spend', 'clicks']))).toContain('scatter');
  });
  it('offers nothing without a measure', () => {
    expect(kinds(grid(['country', 'day']))).toEqual([]);
  });
  it('does not offer scatter with a date as the only breakdown', () => {
    expect(kinds(grid(['day', 'spend', 'clicks']))).not.toContain('scatter');
  });
  it('treats id and calculated numbers as neither measures nor breakdowns', () => {
    const sc = [f('user_id', 'number'), f('code_id', 'string'), { ...f('ratio', 'number'), isCalculated: true }, { ...f('made', 'date'), isCalculated: true }, f('country', 'string')] as Schema;
    expect(kinds(grid(['user_id', 'code_id', 'ratio', 'made', 'country']), sc)).toEqual([]);
  });
  it('counts records when no number is shown and the mart has a key', () => {
    const c = chartCandidates(grid(['day', 'country', 'channel']), keyed);
    expect(c.map((x) => x.spec.kind)).toEqual(expect.arrayContaining(['timeSeries', 'line', 'bar', 'rankedBar', 'pie', 'spread', 'heatmap', 'sankey']));
    expect(c.every((x) => x.spec.measure === 'records')).toBe(true);
    expect(c.map((x) => x.spec.kind)).not.toContain('scatter');
  });
  it('offers no record-count charts when the mart has no key', () => {
    expect(kinds(grid(['day', 'country']))).toEqual([]);
  });
  it('does not offer sankey or pie for a distinct count', () => {
    const k = kinds(grid(['country', 'channel', 'spend'], { aggregations: [{ column: 'spend', function: 'COUNT_DISTINCT' }] }));
    expect(k).not.toContain('sankey');
    expect(k).not.toContain('pie');
  });
});
