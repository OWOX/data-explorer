import { cleanText } from '../../api/ai-prompt';
import { chartsOf, editCharts, type ChartSettings, type ChartSpec } from '../../charts/settings';
import { canBucket } from '../../model/aggregation';
import type { Field, Schema } from '../../model/types';
import { hasPrimaryKey } from '../../records/relationships';
import { isIdField } from '../../state/join-plan';
import type { GridState } from '../../state/store';
import { choiceQ, scoreQ, type Answers, type Question } from '../decide';
import type { Asked, StepDeps, StepInput } from './types';

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

const CHARTS_MAX = 3;
const LEVELS = ['Does not help show the answer.', 'Might help.', 'Clearly helps show the answer.'];

/** A spec as the model sees it: every string cleaned and capped, since field names come from OWOX. */
function cleanSpec(spec: Omit<ChartSpec, 'id'>): Record<string, unknown> {
  const clean = (v: unknown): unknown => (typeof v === 'string' ? cleanText(v, 120) : Array.isArray(v) ? v.map(clean) : v);
  return Object.fromEntries(Object.entries(spec).map(([k, v]) => [k, clean(v)]));
}

export function buildChartQuestions(input: StepInput, cands: ChartCandidate[]): Asked {
  if (cands.length < 2) return null;
  const questions: Record<string, Question> = {};
  questions.primary = choiceQ('Which chart shows the answer to the query best?', Object.fromEntries(cands.map((c) => [c.key, null])));
  cands.forEach((c, i) => { questions[`x${i}`] = scoreQ(`Would a ${c.spec.kind} chart also help show the answer?`, LEVELS); });
  return {
    questions,
    state: { query: cleanText(input.query, 256), chartHint: input.intent.chartHint, charts: cands.map((c) => ({ id: c.key, ...cleanSpec(c.spec) })) },
  };
}

export function applyCharts(answers: Answers, cands: ChartCandidate[]): ChartCandidate[] {
  const p = answers.primary;
  const primary = p?.type === 'choice' ? cands.find((c) => c.key === p.choice) : cands.length === 1 ? cands[0] : undefined;
  if (!primary) return [];
  const extra = cands.flatMap((c, i) => { const a = answers[`x${i}`]; return c !== primary && a?.type === 'score' && a.level === 2 ? [c] : []; });
  return [primary, ...extra].slice(0, CHARTS_MAX);
}

const sameChart = (a: Omit<ChartSpec, 'id'>, b: ChartSpec) =>
  a.kind === b.kind && a.measure === b.measure && a.dimension === b.dimension && a.dimension2 === b.dimension2 && a.date === b.date && a.measure2 === b.measure2 && a.bucket === b.bucket && JSON.stringify(a.dimensions ?? null) === JSON.stringify(b.dimensions ?? null);

/** New charts go in front; a saved chart is never removed; a new chart equal to a saved one is not added. */
export function mergeCharts(saved: ChartSettings, picked: ChartCandidate[], now = Date.now()): ChartSettings {
  const list = chartsOf(saved);
  const fresh: ChartSpec[] = picked.flatMap((c, i) => (list.some((s) => sameChart(c.spec, s)) ? [] : [{ id: `ai-${c.spec.kind}-${now}-${i}`, ...c.spec }]));
  return editCharts(saved, (l) => [...fresh, ...l]);
}

/** Step 5: valid charts in code, one decision to pick them. */
export async function runCharts(input: StepInput, deps: StepDeps, grid: GridState, schema: Schema): Promise<{ picked: ChartCandidate[]; failed: boolean }> {
  const cands = chartCandidates(grid, schema);
  if (cands.length === 1) return { picked: cands, failed: false };
  const asked = buildChartQuestions(input, cands);
  if (!asked) return { picked: [], failed: false };
  try { return { picked: applyCharts(await deps.decide(asked.questions, asked.state, deps.signal), cands), failed: false }; } catch { return { picked: [], failed: true }; }
}
