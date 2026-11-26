import type { AiModel, Ctx, DecisionModel } from '../sdk/types';
import { errorMessage } from '../model/guards';

/** A fast-model question waits this long; past it the caller goes on as if no AI were configured. */
export const AI_TIMEOUT_MS = 30_000;

/** The model could not answer this run (a timeout, an error, an answer that is no JSON, or the run was cancelled). Never shown to the member. */
export class AiUnavailable extends Error {}

type Models = { fast?: AiModel; decision?: DecisionModel };

/** The models the project configured. null when there is no AI. */
export function pickModels(ctx: Ctx): Models | null {
  const ai = ctx.credentials.ai;
  const fast = ai?.fast;
  const decision = ai?.decision;
  return fast || decision ? { ...(fast ? { fast } : {}), ...(decision ? { decision } : {}) } : null;
}

/** The ad-hoc pipeline needs both models, the decision one able to answer choice and score questions; the manifest declares them together, so a project has both or neither. */
export const pipelineReady = (m: Models | null): m is Required<Models> => {
  if (!m?.fast || !m.decision) return false;
  const types = m.decision.supportedQuestionTypes;
  return types.includes('choice') && types.includes('score');
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

/** Runs one model call under a time limit and the caller's signal. Rejects with AiUnavailable on a timeout, an abort or any error, so a model that ignores its signal cannot hold the caller. */
export async function raceAi<T>(signal: AbortSignal, ms: number, run: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) ctl.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = new Promise<never>((_, reject) => {
    if (ctl.signal.aborted) { reject(new AiUnavailable('aborted')); return; }
    timer = setTimeout(() => { ctl.abort(); reject(new AiUnavailable('timeout')); }, ms);
    ctl.signal.addEventListener('abort', () => reject(new AiUnavailable('aborted')), { once: true });
  });
  unavailable.catch(() => undefined);
  try {
    const pending = run(ctl.signal);
    pending.catch(() => undefined);
    return await Promise.race([pending, unavailable]);
  } catch (e) {
    throw e instanceof AiUnavailable ? e : new AiUnavailable(errorMessage(e));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

/** The fast model's JSON answer to one question; AiUnavailable for anything else. */
export function askFast(model: AiModel, system: string, user: string, signal: AbortSignal, ms = AI_TIMEOUT_MS): Promise<Record<string, unknown>> {
  return raceAi(signal, ms, async (abortSignal) => {
    // No output cap: a thinking model's reasoning counts toward it, and a small cap ends the answer before the JSON.
    const result = await model.doGenerate({
      prompt: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }] }],
      responseFormat: { type: 'json' },
      temperature: 0,
      abortSignal,
    });
    const text = result.content.flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('');
    const json = extractJson(text);
    if (json === undefined) throw new AiUnavailable('no JSON in the answer');
    return json as Record<string, unknown>;
  });
}
