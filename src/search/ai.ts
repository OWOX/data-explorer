import type { AiModel, Ctx, DecisionModel } from '../sdk/types';
import { errorMessage } from '../model/guards';

/** One search run waits this long for the models, all its questions together; past it the run goes on as if no AI were configured. */
export const AI_TIMEOUT_MS = 30_000;

/** The model could not answer this run (a timeout, an error, an answer that is no JSON, or the run was cancelled). Never shown to the member. */
export class AiUnavailable extends Error {}

export type Models = { fast?: AiModel; decision?: DecisionModel };

/** The models the project configured. null when there is no AI. */
export function pickModels(ctx: Ctx): Models | null {
  const ai = ctx.credentials?.ai;
  const fast = ai?.fast ?? (ai && typeof ai.doGenerate === 'function' ? ai : undefined);
  const decision = ai?.decision;
  return fast || decision ? { ...(fast ? { fast } : {}), ...(decision ? { decision } : {}) } : null;
}

/** The ad-hoc pipeline needs both models, the decision one able to answer choice and score questions; the manifest declares them together, so a project has both or neither. */
export const pipelineReady = (m: Models | null): m is Required<Models> => {
  if (!m?.fast || !m.decision) return false;
  // The pipeline asks choice and score questions; a model that lists its question types must list both. One that lists none is taken at its word.
  const types: unknown = (m.decision as { supportedQuestionTypes?: unknown }).supportedQuestionTypes;
  return !Array.isArray(types) || (types.includes('choice') && types.includes('score'));
};

/** The first JSON object in a model's answer: bare, in a code fence, or with words around it. undefined when there is none. */
export function extractJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const tryParse = (s: string): unknown => {
    try {
      const v: unknown = JSON.parse(s);
      return typeof v === 'object' && v !== null && !Array.isArray(v) ? v : undefined;
    } catch { return undefined; }
  };
  const whole = tryParse(body);
  if (whole !== undefined) return whole;
  for (let start = body.indexOf('{'); start >= 0; start = body.indexOf('{', start + 1)) {
    for (let end = body.lastIndexOf('}'); end > start; end = body.lastIndexOf('}', end - 1)) {
      const v = tryParse(body.slice(start, end + 1));
      if (v !== undefined) return v;
    }
  }
  return undefined;
}

/** What a fast question is for: reading the query, shortlisting a wide mart's fields, picking number formats. */
export type Role = 'intent' | 'shortlist' | 'formats';
/** The share of the run's budget one question may take. */
const SHARE: Record<Role, number> = { intent: 1, shortlist: 1, formats: 0.7 };

/** The questions one search run puts to the models. They share one budget; the run's signal cancels the call in flight. */
export function createAiRun(models: Models, signal: AbortSignal, totalMs = AI_TIMEOUT_MS) {
  const deadline = Date.now() + totalMs;

  async function call(model: AiModel, system: string, user: string, ms: number, temperature?: number): Promise<Record<string, unknown>> {
    if (ms <= 0 || signal.aborted) throw new AiUnavailable('no time left');
    const ctl = new AbortController();
    const stop = () => ctl.abort();
    signal.addEventListener('abort', stop, { once: true });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unavailable = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { ctl.abort(); reject(new AiUnavailable('timeout')); }, ms);
      ctl.signal.addEventListener('abort', () => reject(new AiUnavailable('aborted')), { once: true });
    });
    unavailable.catch(() => undefined);
    try {
      // No output cap: a thinking model's reasoning counts toward it, and a small cap ends the answer before the JSON.
      const answer = Promise.resolve(model.doGenerate({
        prompt: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }] }],
        responseFormat: { type: 'json' },
        ...(temperature === undefined ? {} : { temperature }),
        abortSignal: ctl.signal,
      }));
      answer.catch(() => undefined);
      const result = await Promise.race([answer, unavailable]);
      const text = result.content.flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('');
      const json = extractJson(text);
      if (json === undefined) throw new AiUnavailable('no JSON in the answer');
      return json as Record<string, unknown>;
    } catch (e) {
      throw e instanceof AiUnavailable ? e : new AiUnavailable(errorMessage(e));
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
    }
  }

  return {
    /** The fast model's JSON answer; AiUnavailable for anything else. */
    async ask(role: Role, system: string, user: string): Promise<Record<string, unknown>> {
      if (!models.fast) throw new AiUnavailable('no model');
      const budget = Math.min(deadline - Date.now(), totalMs * SHARE[role]);
      return call(models.fast, system, user, budget, 0);
    },
  };
}
