import type { ChartSpec } from '../charts/settings';
import { canBucket } from '../model/aggregation';
import type { Field, Schema } from '../model/types';
import { hasPrimaryKey } from '../records/relationships';
import { isIdField } from '../state/join-plan';
import type { GridState } from '../state/store';

export type ChartCandidate = { key: string; spec: Omit<ChartSpec, 'id'> };
/** A sum or a count adds up across groups; a distinct count does not. */
const ADDITIVE = new Set(['SUM', 'COUNT']);
const RECORDS = 'records';

/** Every chart type the view can draw, with its fields filled in from the shown columns. Fields are classified as the charts resolve them. */
export function chartCandidates(grid: GridState, schema: Schema): ChartCandidate[] {
  const by = new Map(schema.map((f) => [f.name, f]));
  const fields = grid.columns.flatMap((c) => (by.get(c) ? [by.get(c)!] : []));
  const measures = fields.filter((f) => f.category === 'number' && !isIdField(f) && !f.isCalculated);
  const dates = fields.filter((f) => canBucket(f));
  const texts = fields.filter((f) => (f.category === 'string' || f.category === 'boolean') && !isIdField(f));
  const real = measures[0];
  // With no number shown, the main mart's record count is the measure (only when the mart has a key to count).
  const m = real?.name ?? (hasPrimaryKey(schema) ? RECORDS : null);
  if (!m) return [];
  const fnOf = (f: Field) => grid.aggregations?.find((a) => a.column === f.name)?.function;
  const additive = !real || !grid.aggregations?.length || ADDITIVE.has(fnOf(real) ?? 'SUM');
  const out: ChartCandidate[] = [];
  const add = (key: string, spec: Omit<ChartSpec, 'id'>) => out.push({ key, spec });
  const d = dates[0];
  const bucket = d ? grid.dateTrunc?.find((t) => t.column === d.name)?.unit ?? 'AUTO' : undefined;
  if (d) { add('timeSeries', { kind: 'timeSeries', date: d.name, measure: m, bucket }); add('line', { kind: 'line', date: d.name, measure: m, bucket }); }
  const t = texts[0];
  if (t) {
    add('bar', { kind: 'bar', dimension: t.name, measure: m });
    add('rankedBar', { kind: 'rankedBar', dimension: t.name, measure: m });
    if (additive) add('pie', { kind: 'pie', dimension: t.name, measure: m });
    add('spread', { kind: 'spread', dimension: t.name, measure: m });
  }
  if (texts.length >= 2) add('heatmap', { kind: 'heatmap', dimension: texts[0]!.name, dimension2: texts[1]!.name, measure: m });
  if (texts.length >= 2 && additive) add('sankey', { kind: 'sankey', dimensions: texts.slice(0, 5).map((x) => x.name), measure: m });
  if (measures.length >= 2 && t) add('scatter', { kind: 'scatter', dimension: t.name, measure: m, measure2: measures[1]!.name });
  return out;
}
