import type { Model } from '../model/types';
import type { Ctx } from '../sdk/types';

/** The backend (search.config.ts) answers 400 outside 2 to 256 characters of the trimmed query. */
export const MIN_QUERY = 2;
export const MAX_QUERY = 256;
/** Marts a search shows. */
export const MAX_FOUND = 5;
/** Asked of the engine: more than are shown, since ids the model does not hold (or the member cannot open) are dropped after. */
const REQUEST_LIMIT = 10;

/** Why a query cannot be sent, or null when it can. */
export function queryProblem(q: string): string | null {
  const n = q.trim().length;
  if (n < 1) return 'Type what you are looking for.';
  if (n > MAX_QUERY) return `Use at most ${MAX_QUERY} characters.`;
  return null;
}

/**
 * The data marts OWOX's own search engine ranks for the query (the engine behind the MCP tool get_relevant_data_marts_by_prompt),
 * best first, at most five, only those the member can open in this model. A failure or an odd answer finds nothing.
 */
export async function searchEndpoint(ctx: Ctx, query: string, model: Model, signal?: AbortSignal): Promise<string[]> {
  const q = query.trim();
  // A one-character query is a title match only: the backend refuses under its minimum.
  if (q.length < MIN_QUERY || queryProblem(q)) return [];
  let body: unknown;
  try {
    body = await ctx.owox.getJson<unknown>('/api/search', { q, entityTypes: 'DATA_MART', excludeDrafts: 'true', limit: String(REQUEST_LIMIT) });
  } catch (e) {
    console.warn('The OWOX search failed', e);
    return [];
  }
  if (signal?.aborted || !Array.isArray(body)) return [];
  const best = new Map<string, number>();
  for (const item of body) {
    if (typeof item !== 'object' || item === null) continue;
    const { entityType, entityId, finalScore } = item as Record<string, unknown>;
    if (entityType !== undefined && entityType !== 'DATA_MART') continue;
    if (typeof entityId !== 'string' || !model.marts.get(entityId)?.accessible) continue;
    const score = typeof finalScore === 'number' && Number.isFinite(finalScore) ? finalScore : -Infinity;
    if (!best.has(entityId) || score > best.get(entityId)!) best.set(entityId, score);
  }
  // Array.prototype.sort is stable: equal scores keep the order the engine gave them.
  return [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_FOUND).map(([id]) => id);
}
