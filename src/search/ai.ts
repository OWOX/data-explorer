import type { AiModel, Ctx } from '../sdk/types';
import { errorMessage } from '../model/guards';

/** One search run waits this long for the models, all its questions together; past it the run goes on as if no AI were configured. */
export const AI_TIMEOUT_MS = 30_000;

/** The model could not answer this run (a timeout, an error, an answer that is no JSON, or the run was cancelled). Never shown to the member. */
export class AiUnavailable extends Error {}

export type Models = { fast?: AiModel; reasoning?: AiModel };

/** The models the project configured: `fast` and `reasoning`, whichever exist. null when there is no AI. */
export function pickModels(ctx: Ctx): Models | null {
  const ai = ctx.credentials?.ai;
  const fast = ai?.fast;
  const reasoning = ai?.reasoning;
  return fast || reasoning ? { ...(fast ? { fast } : {}), ...(reasoning ? { reasoning } : {}) } : null;
}

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

/** Which model a question prefers: picking a mart is easy (fast), choosing fields and filters benefits from reasoning. */
export type Role = 'discover' | 'fields' | 'filters' | 'formats';
/**
 * The share of the run's budget one question may take, so a slow question leaves the next one a chance. Discover is the only call
 * in its run. Fields and filters share a run, so fields keeps half and filters gets what is left. Formats is the number-format
 * picker's single call.
 */
const SHARE: Record<Role, number> = { discover: 0.9, fields: 0.5, filters: 0.9, formats: 0.7 };

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
      // No output cap: a reasoning model's thinking counts toward it, and a small cap ends the answer before the JSON.
      const answer = Promise.resolve(model.doGenerate({
        prompt: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }] }],
        responseFormat: { type: 'json' },
        // A reasoning model may refuse a temperature, so only the fast model gets one.
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
    /** The model's JSON answer; AiUnavailable for anything else. A `reasoning` model that fails (not cancelled) is retried once on `fast` in what is left of the budget. */
    async ask(role: Role, system: string, user: string): Promise<Record<string, unknown>> {
      const first = role === 'discover' ? models.fast ?? models.reasoning : models.reasoning ?? models.fast;
      if (!first) throw new AiUnavailable('no model');
      const budget = () => Math.min(deadline - Date.now(), totalMs * SHARE[role]);
      try {
        return await call(first, system, user, budget(), first === models.reasoning ? undefined : 0);
      } catch (e) {
        if (signal.aborted || first !== models.reasoning || !models.fast || models.fast === first) throw e;
        return call(models.fast, system, user, budget(), 0);
      }
    },
  };
}
