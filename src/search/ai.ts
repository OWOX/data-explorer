import type { AiModel, Ctx } from '../sdk/types';

/** One search run waits this long for the model, all its questions together; past it the run goes on as if no AI were configured. */
export const AI_TIMEOUT_MS = import.meta.env.MODE === 'test' ? 400 : 20_000;

/** The model could not answer this run (a timeout, an error, an answer that is no JSON, or the run was cancelled). Never shown to the member. */
export class AiUnavailable extends Error {}

/** The `reasoning` model when the project has one, else `fast`, else null (no AI configured). */
export function pickModel(ctx: Ctx): AiModel | null {
  const ai = ctx.credentials?.ai;
  return ai?.reasoning ?? ai?.fast ?? null;
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

/** The questions one search run puts to the model. They share one deadline, and the run's signal cancels the one in flight. */
export function createAiRun(model: AiModel, signal: AbortSignal, timeoutMs = AI_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  return {
    /** The model's JSON answer; AiUnavailable for anything else. */
    async ask(system: string, user: string): Promise<Record<string, unknown>> {
      const left = deadline - Date.now();
      if (left <= 0 || signal.aborted) throw new AiUnavailable('no time left');
      const call = new AbortController();
      const stop = () => call.abort();
      signal.addEventListener('abort', stop, { once: true });
      let timer: ReturnType<typeof setTimeout> | undefined;
      const unavailable = new Promise<never>((_, reject) => {
        timer = setTimeout(() => { call.abort(); reject(new AiUnavailable('timeout')); }, left);
        call.signal.addEventListener('abort', () => reject(new AiUnavailable('aborted')), { once: true });
      });
      try {
        const answer = Promise.resolve(model.doGenerate({
          prompt: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }] }],
          responseFormat: { type: 'json' },
          temperature: 0,
          maxOutputTokens: 1200,
          abortSignal: call.signal,
        }));
        answer.catch(() => undefined);
        const result = await Promise.race([answer, unavailable]);
        const text = result.content.flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('');
        const json = extractJson(text);
        if (json === undefined) throw new AiUnavailable('no JSON in the answer');
        return json as Record<string, unknown>;
      } catch (e) {
        throw e instanceof AiUnavailable ? e : new AiUnavailable(e instanceof Error ? e.message : String(e));
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', stop);
        unavailable.catch(() => undefined);
      }
    },
  };
}
