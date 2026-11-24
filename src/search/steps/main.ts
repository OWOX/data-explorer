// src/search/steps/main.ts
import { cleanText } from '../../api/ai-prompt';
import { coreSignals, shortlist } from '../core';
import { choiceQ, isUnsure, ranked, type Answer } from '../decide';
import type { Asked, StepDeps, StepInput } from './types';

export type MainCandidate = { id: string; title: string; description: string; inbound: number; outbound: number; neighbours: number; key: string[]; searchHit: boolean };
export type MainResult = { martId: string | null; alternatives: string[]; failed: boolean };
const ALTERNATIVES = 2;

const INSTRUCTIONS = 'Pick the data mart whose rows are the business entity the query is about (for example users, visitors, orders), so the other data can be joined to it. Prefer an entity with a key and many relationships over a report that summarises it.';

export function buildMainQuestion(input: StepInput, cands: MainCandidate[]): Asked {
  if (cands.length < 2) return null;
  return {
    questions: { main: choiceQ(INSTRUCTIONS, Object.fromEntries(cands.map((c) => [c.id, null]))) },
    state: {
      query: cleanText(input.query, 256), intent: input.intent,
      marts: cands.map((c) => ({ ...c, title: cleanText(c.title, 120), description: cleanText(c.description, 160), key: c.key.map((k) => cleanText(k, 120)) })),
    },
  };
}

export function applyMain(answer: Answer | undefined, cands: MainCandidate[]): Omit<MainResult, 'failed'> {
  const pick = answer?.type === 'choice' ? answer.choice : cands[0]?.id ?? null;
  const alternatives = answer && isUnsure(answer) ? ranked(answer).filter((id) => id !== pick).slice(0, ALTERNATIVES) : [];
  return { martId: pick, alternatives };
}

/** Step 1: the shortlist by relationships and relevance, the marts with a key, and one choice among them. */
export async function runMain(input: StepInput, deps: StepDeps): Promise<MainResult> {
  const { model, hits, intent } = input;
  const signals = coreSignals(model);
  const ids = shortlist(model, signals, hits, intent.subjects);
  const keyed = (await Promise.all(ids.map(async (id) => {
    try { const s = await deps.schemas.get(id); return s.primaryKey?.length ? { id, key: [...s.primaryKey] } : null; } catch { return null; }
  }))).filter((x): x is { id: string; key: string[] } => !!x);
  const hit = (id: string) => hits.marts.includes(id) || hits.reports.some((r) => r.martId === id);
  const cands: MainCandidate[] = keyed.map(({ id, key }) => {
    const m = model.marts.get(id)!;
    const s = signals.get(id)!;
    return { id, title: m.title, description: m.description ?? '', inbound: s.inbound, outbound: s.outbound, neighbours: s.neighbours, key, searchHit: hit(id) };
  });
  const fallback = hits.marts[0] ?? hits.reports[0]?.martId ?? null;
  if (!cands.length) return { martId: fallback, alternatives: [], failed: false };
  const asked = buildMainQuestion(input, cands);
  if (!asked) return { martId: cands[0]!.id, alternatives: [], failed: false };
  try {
    const answers = await deps.decide(asked.questions, asked.state, deps.signal);
    return { ...applyMain(answers.main, cands), failed: false };
  } catch {
    return { ...applyMain(undefined, cands), failed: true };
  }
}
