import { expect, it } from 'vitest';
import { chartCandidates } from './chartCandidates';
import type { Field, Schema } from '../model/types';
import type { GridState } from '../state/store';

const f = (name: string, category: Field['category']): Field => ({ name, alias: null, type: 'X', category, description: null, isPrimaryKey: false });
const schema = [f('day', 'date'), f('country', 'string'), f('channel', 'string'), f('spend', 'number'), f('clicks', 'number')] as Schema;
const grid = (columns: string[], extra: Partial<GridState> = {}): GridState => ({ columns, filters: {}, sorts: null, limit: 200, ...extra });
const kinds = (g: GridState) => chartCandidates(g, schema).map((c) => c.spec.kind);

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
it('offers scatter for two measures and a breakdown', () => {
  expect(kinds(grid(['country', 'spend', 'clicks']))).toContain('scatter');
});
it('offers nothing without a measure', () => {
  expect(kinds(grid(['country', 'day']))).toEqual([]);
});
