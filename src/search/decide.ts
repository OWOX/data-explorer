import type { Experimental_DecisionQuestion, experimental_decide } from 'ai';
import type { DecisionModel } from '../sdk/types';
import { AiUnavailable, raceAi } from './ai';

export type Question = Experimental_DecisionQuestion;
export type Answer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; level: number; probabilities?: Record<string, number> };
export type Answers = Record<string, Answer | undefined>;
export type Decide = (questions: Record<string, Question>, state: unknown, signal: AbortSignal) => Promise<Answers>;

export const DECIDE_TIMEOUT_MS = 20_000;
export const MAX_QUESTIONS = 64;
const SURE = 0.6;
const GAP = 0.15;

export const choiceQ = (instructions: string, options: Record<string, string | null>): Question => ({ type: 'choice', instructions, criteria: options });
export const scoreQ = (instructions: string, levels: string[]): Question => ({ type: 'score', instructions, criteria: levels });

/** The most probable level of a score's distribution (keyed by level index); a tie goes to the lower level. undefined without a usable distribution. */
function argmaxLevel(probs: Record<string, number> | undefined, top: number): number | undefined {
  if (!probs || typeof probs !== 'object') return undefined;
  let best: number | undefined;
  let bestP = -Infinity;
  for (let l = 0; l <= top; l++) {
    const p = probs[String(l)];
    if (typeof p === 'number' && Number.isFinite(p) && p > bestP) { best = l; bestP = p; }
  }
  return best;
}

/** One answer checked against its question: a choice must name an offered option, a score takes its most probable level, or is rounded into its levels. */
function checked(q: Question, raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as { type?: string; choice?: unknown; score?: unknown; probabilities?: Record<string, number> };
  if (q.type === 'choice' && a.type === 'choice' && typeof a.choice === 'string' && Object.hasOwn(q.criteria, a.choice)) return { type: 'choice', choice: a.choice, probabilities: a.probabilities };
  if (q.type === 'score' && a.type === 'score' && typeof a.score === 'number' && Number.isFinite(a.score)) {
    const top = q.criteria.length - 1;
    const level = argmaxLevel(a.probabilities, top) ?? Math.min(top, Math.max(0, Math.round(a.score)));
    return { type: 'score', level, probabilities: a.probabilities };
  }
  return undefined;
}

const sdk = () => import('ai');

/** The decision model behind one function: one JSON state, typed questions, checked answers; AiUnavailable for anything that is not an answer. */
export function createDecide(model: DecisionModel, opts: { timeoutMs?: number; decideFn?: typeof experimental_decide } = {}): Decide {
  const timeoutMs = opts.timeoutMs ?? DECIDE_TIMEOUT_MS;
  return async (questions, state, signal) => {
    const ids = Object.keys(questions);
    if (!ids.length) return {};
    if (ids.length > MAX_QUESTIONS) throw new AiUnavailable('too many questions');
    if (signal.aborted) throw new AiUnavailable('aborted');
    return raceAi(signal, timeoutMs, async (abortSignal) => {
      const ask = async (qs: Record<string, Question>): Promise<Record<string, unknown>> => {
        // The SDK loads on the first question, so a member who never searches with AI does not download it.
        const decideFn = opts.decideFn ?? (await sdk()).experimental_decide;
        const result = await decideFn({ model, state: [{ type: 'text', text: JSON.stringify(state) }], questions: qs, abortSignal, maxRetries: 1 });
        return (result as { answers?: Record<string, unknown> }).answers ?? {};
      };
      let answers: Record<string, unknown>;
      let asked = questions;
      try {
        answers = await ask(asked);
      } catch (e) {
        if (!(await sdk()).Experimental_DecisionRefusalError.isInstance(e)) throw e;
        // The provider refused some questions: answer around them, once.
        const refused = new Set((e as { questionIds: string[] }).questionIds);
        asked = Object.fromEntries(ids.filter((id) => !refused.has(id)).map((id) => [id, questions[id]!]));
        answers = Object.keys(asked).length ? await ask(asked) : {};
      }
      return Object.fromEntries(ids.map((id) => [id, id in asked ? checked(questions[id]!, answers[id]) : undefined]));
    });
  };
}

const sortedProbs = (a: Answer | undefined) =>
  a && a.probabilities ? Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]) : null;

/** Under 0.6, or within 0.15 of the runner-up. A provider without probabilities is taken at its word. */
export function isUnsure(a: Answer | undefined): boolean {
  const p = sortedProbs(a);
  if (!p || !p.length) return false;
  const [top, second] = [p[0]![1], p[1]?.[1] ?? 0];
  return top < SURE || top - second < GAP;
}

/** A choice's options, most likely first. */
export function ranked(a: Answer | undefined): string[] {
  if (!a || a.type !== 'choice') return [];
  const p = sortedProbs(a);
  return p ? p.map(([id]) => id) : [a.choice];
}
