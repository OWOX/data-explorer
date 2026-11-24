import { Experimental_DecisionRefusalError, experimental_decide, type Experimental_DecisionQuestion } from 'ai';
import type { DecisionModel } from '../sdk/types';
import { AiUnavailable } from './ai';

export type Question = Experimental_DecisionQuestion;
export type Answer =
  | { type: 'choice'; choice: string; probabilities?: Record<string, number> }
  | { type: 'score'; level: number; probabilities?: Record<string, number> }
  | { type: 'boolean'; probability: number };
export type Answers = Record<string, Answer | undefined>;
export type Decide = (questions: Record<string, Question>, state: unknown, signal: AbortSignal) => Promise<Answers>;

export const DECIDE_TIMEOUT_MS = 20_000;
export const MAX_QUESTIONS = 64;
export const MAX_OPTIONS = 255;
const SURE = 0.6;
const GAP = 0.15;

export const choiceQ = (instructions: string, options: Record<string, string | null>): Question => ({ type: 'choice', instructions, criteria: options });
export const scoreQ = (instructions: string, levels: string[]): Question => ({ type: 'score', instructions, criteria: levels });

/** One answer checked against its question: a choice must name an offered option, a score is rounded into its levels. */
function checked(q: Question, raw: unknown): Answer | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as { type?: string; choice?: unknown; score?: unknown; probability?: unknown; probabilities?: Record<string, number> };
  if (q.type === 'choice' && a.type === 'choice' && typeof a.choice === 'string' && Object.hasOwn(q.criteria, a.choice)) return { type: 'choice', choice: a.choice, probabilities: a.probabilities };
  if (q.type === 'score' && a.type === 'score' && typeof a.score === 'number' && Number.isFinite(a.score)) {
    const level = Math.min(q.criteria.length - 1, Math.max(0, Math.round(a.score)));
    return { type: 'score', level, probabilities: a.probabilities };
  }
  if (q.type === 'boolean' && a.type === 'boolean' && typeof a.probability === 'number') return { type: 'boolean', probability: a.probability };
  return undefined;
}

/** The decision model behind one function: one JSON state, typed questions, checked answers; AiUnavailable for anything that is not an answer. */
export function createDecide(model: DecisionModel, opts: { timeoutMs?: number; decideFn?: typeof experimental_decide } = {}): Decide {
  const decideFn = opts.decideFn ?? experimental_decide;
  const timeoutMs = opts.timeoutMs ?? DECIDE_TIMEOUT_MS;
  return async (questions, state, signal) => {
    const ids = Object.keys(questions);
    if (!ids.length) return {};
    if (ids.length > MAX_QUESTIONS) throw new AiUnavailable('too many questions');
    if (signal.aborted) throw new AiUnavailable('aborted');
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal.addEventListener('abort', stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Rejects on timeout or abort, so a model that ignores the signal cannot hold the pipeline.
    const unavailable = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(new AiUnavailable('timeout')); }, timeoutMs);
      ctl.signal.addEventListener('abort', () => reject(new AiUnavailable('aborted')), { once: true });
    });
    unavailable.catch(() => undefined);
    const ask = async (qs: Record<string, Question>): Promise<Record<string, unknown>> => {
      const pending = Promise.resolve(decideFn({ model, state: [{ type: 'text', text: JSON.stringify(state) }], questions: qs, abortSignal: ctl.signal, maxRetries: 1 }));
      pending.catch(() => undefined);
      const result = await Promise.race([pending, unavailable]);
      return (result as { answers?: Record<string, unknown> }).answers ?? {};
    };
    try {
      let answers: Record<string, unknown>;
      let asked = questions;
      try {
        answers = await ask(asked);
      } catch (e) {
        if (!Experimental_DecisionRefusalError.isInstance(e)) throw e;
        // The provider refused some questions: answer around them, once.
        const refused = new Set((e as { questionIds: string[] }).questionIds);
        asked = Object.fromEntries(ids.filter((id) => !refused.has(id)).map((id) => [id, questions[id]!]));
        answers = Object.keys(asked).length ? await ask(asked) : {};
      }
      return Object.fromEntries(ids.map((id) => [id, id in asked ? checked(questions[id]!, answers[id]) : undefined]));
    } catch (e) {
      throw e instanceof AiUnavailable ? e : new AiUnavailable(e instanceof Error ? e.message : String(e));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
  };
}

const sortedProbs = (a: Answer | undefined) =>
  a && a.type !== 'boolean' && a.probabilities ? Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]) : null;

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
