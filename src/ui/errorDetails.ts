import type { TraverseOptions } from '../sdk/types';

/** What the caller knows about the request that failed. Shown in the copied details, never in the visible message. */
export type ErrorContext = { dataMartId?: string; options?: TraverseOptions | null; runId?: string | null };

declare const __APP_VERSION__: string | undefined;
const appVersion = (): string => (typeof __APP_VERSION__ !== 'undefined' && __APP_VERSION__ ? __APP_VERSION__ : 'unknown');

const SECRET_KEY = /token|secret|password|passwd|authorization|credential|api[-_]?key|cookie|bearer/i;
const REDACTED = '[redacted]';

/** Credentials that sit inside a string value: bearer headers, JWTs, and token-like query parameters of a URL. */
function maskString(v: string): string {
  return v
    .replace(/Bearer\s+\S+/gi, `Bearer ${REDACTED}`)
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+/g, REDACTED)
    .replace(/([?&][^=&\s]*(?:token|key|secret|signature|sig)[^=&\s]*=)[^&\s]*/gi, `$1${REDACTED}`);
}

/** JSON for the report with every credential-looking key blanked, at any depth. Cycles and unserialisable values never throw. */
function safeJson(value: unknown, space?: number): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (key, v) => {
      if (key && SECRET_KEY.test(key)) return REDACTED;
      if (v && typeof v === 'object') {
        if (seen.has(v)) return '[circular]';
        seen.add(v);
      }
      if (typeof v === 'string') return maskString(v);
      return typeof v === 'bigint' ? v.toString() : v;
    }, space) ?? String(value);
  } catch {
    return String(value);
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object';

function plainMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  // The host bridge may reject with a plain object ({ message } or { error }) rather than an Error.
  if (isRecord(e)) {
    const o = e as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    return safeJson(e);
  }
  return String(e);
}

/** The error followed down its `cause` links, outermost first. Capped so a looping chain ends. */
export function causeChain(e: unknown): unknown[] {
  const chain: unknown[] = [];
  let cur: unknown = e;
  while (chain.length < 8 && cur !== undefined && cur !== null && !chain.includes(cur)) {
    chain.push(cur);
    cur = isRecord(cur) ? (cur as { cause?: unknown }).cause : undefined;
  }
  return chain;
}

/** A transport error keeps the host's error in `payload`; an API error has `code` and `status` of its own. */
function codeAndStatus(e: unknown): { code?: string; status?: number } {
  if (!isRecord(e)) return {};
  const src = isRecord(e.payload) ? { ...e, ...e.payload } as Record<string, unknown> : e;
  const code = typeof src.code === 'string' || typeof src.code === 'number' ? String(src.code) : undefined;
  const status = typeof src.status === 'number' ? src.status : undefined;
  return { code, status };
}

/** The message a reader sees: the error's own, then each cause that adds something, with the host's code and status where it gave them. */
export function errorMessage(e: unknown): string {
  const [head, ...causes] = causeChain(e);
  let text = plainMessage(head);
  for (const c of causes) {
    const m = plainMessage(c);
    if (!m || text.includes(m)) continue;
    const { code, status } = codeAndStatus(c);
    const tags = [code, status].filter((x) => x !== undefined).join(', ');
    text += `: ${m}${tags ? ` (${tags})` : ''}`;
  }
  return text;
}

const nameOf = (e: unknown): string => (e instanceof Error ? e.name : isRecord(e) && typeof e.name === 'string' ? e.name : typeof e);

function describe(e: unknown): string[] {
  const lines = [`name: ${nameOf(e)}`, `message: ${plainMessage(e)}`];
  if (isRecord(e)) {
    const { code, status } = codeAndStatus(e);
    if (code !== undefined) lines.push(`code: ${code}`);
    if (status !== undefined) lines.push(`status: ${status}`);
    if (e.details !== undefined) lines.push(`details: ${safeJson(e.details)}`);
    if (e.payload !== undefined) lines.push(`payload: ${safeJson(e.payload)}`);
    else if (!(e instanceof Error)) lines.push(`value: ${safeJson(e)}`);
  }
  return lines;
}

/** The plain-text block the copy button writes: everything known about the failure, with credentials left out. */
export function buildErrorReport(error: unknown, context: ErrorContext = {}, now: Date = new Date()): string {
  const out = ['Data Explorer error report', `time: ${now.toISOString()}`, `plugin version: ${appVersion()}`, '', ...describe(error)];
  causeChain(error).slice(1).forEach((c, i) => out.push('', `cause ${i + 1}:`, ...describe(c).map((l) => `  ${l}`)));
  const request: string[] = [];
  if (context.dataMartId) request.push(`data mart id: ${context.dataMartId}`);
  if (context.runId) request.push(`run id: ${context.runId}`);
  if (context.options) request.push(`traverse options: ${safeJson(context.options, 2)}`);
  if (request.length) out.push('', 'request:', ...request);
  return out.join('\n');
}
