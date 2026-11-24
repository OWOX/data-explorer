import type { ChartSpec } from '../charts/settings';
import type { Field, Schema } from '../model/types';
import type { GridState } from '../state/store';

export type ChartCandidate = { key: string; spec: Omit<ChartSpec, 'id'> };
const ADDITIVE = new Set(['SUM', 'COUNT', 'COUNT_DISTINCT']);

/** Every chart type the view can draw, with its fields filled in from the shown columns. */
export function chartCandidates(grid: GridState, schema: Schema): ChartCandidate[] {
  const by = new Map(schema.map((f) => [f.name, f]));
  const fields = grid.columns.flatMap((c) => (by.get(c) ? [by.get(c)!] : []));
  const measures = fields.filter((f) => f.category === 'number');
  const dates = fields.filter((f) => f.category === 'date');
  const texts = fields.filter((f) => f.category === 'string' || f.category === 'boolean');
  const m = measures[0];
  if (!m) return [];
  const fnOf = (f: Field) => grid.aggregations?.find((a) => a.column === f.name)?.function;
  const additive = !grid.aggregations?.length || ADDITIVE.has(fnOf(m) ?? 'SUM');
  const out: ChartCandidate[] = [];
  const add = (key: string, spec: Omit<ChartSpec, 'id'>) => out.push({ key, spec });
  const d = dates[0];
  const bucket = d ? grid.dateTrunc?.find((t) => t.column === d.name)?.unit ?? 'AUTO' : undefined;
  if (d) { add('timeSeries', { kind: 'timeSeries', date: d.name, measure: m.name, bucket }); add('line', { kind: 'line', date: d.name, measure: m.name, bucket }); }
  const t = texts[0];
  if (t) {
    add('bar', { kind: 'bar', dimension: t.name, measure: m.name });
    add('rankedBar', { kind: 'rankedBar', dimension: t.name, measure: m.name });
    add('pie', { kind: 'pie', dimension: t.name, measure: m.name });
    add('spread', { kind: 'spread', dimension: t.name, measure: m.name });
  }
  if (texts.length >= 2) add('heatmap', { kind: 'heatmap', dimension: texts[0]!.name, dimension2: texts[1]!.name, measure: m.name });
  if (texts.length >= 2 && additive) add('sankey', { kind: 'sankey', dimensions: texts.slice(0, 5).map((x) => x.name), measure: m.name });
  if (measures.length >= 2 && (t ?? d)) add('scatter', { kind: 'scatter', dimension: (t ?? d)!.name, measure: m.name, measure2: measures[1]!.name });
  return out;
}
