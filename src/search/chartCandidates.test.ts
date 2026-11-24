import { expect, it } from 'vitest';
import { chartCandidates } from './chartCandidates';
import type { Field, Schema } from '../model/types';
import type { GridState } from '../state/store';

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
