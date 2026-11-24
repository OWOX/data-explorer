import { cleanText } from '../../api/ai-prompt';
import { chartsOf, editCharts, type ChartSettings, type ChartSpec } from '../../charts/settings';
import type { Schema } from '../../model/types';
import type { GridState } from '../../state/store';
import { chartCandidates, type ChartCandidate } from '../chartCandidates';
import { choiceQ, scoreQ, type Answers, type Question } from '../decide';
import type { Asked, StepDeps, StepInput } from './types';

export type { ChartCandidate };
export const CHARTS_MAX = 3;
const LEVELS = ['Does not help show the answer.', 'Might help.', 'Clearly helps show the answer.'];

export function buildChartQuestions(input: StepInput, cands: ChartCandidate[]): Asked {
  if (cands.length < 2) return null;
  const questions: Record<string, Question> = {};
  questions.primary = choiceQ('Which chart shows the answer to the query best?', Object.fromEntries(cands.map((c) => [c.key, null])));
  cands.forEach((c, i) => { questions[`x${i}`] = scoreQ(`Would a ${c.spec.kind} chart also help show the answer?`, LEVELS); });
  return {
    questions,
    state: { query: cleanText(input.query, 256), chartHint: input.intent.chartHint, charts: cands.map((c) => ({ id: c.key, ...c.spec })) },
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
