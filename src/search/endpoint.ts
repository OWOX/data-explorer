import { MAX_FOUND } from '../config';
import type { Model } from '../model/types';
import type { Ctx } from '../sdk/types';

/** The backend (search.config.ts) answers 400 outside 2 to 256 characters of the trimmed query. */
export const MIN_QUERY = 2;
export const MAX_QUERY = 256;
/** Asked of the engine: more than are shown, since ids the model does not hold (or the member cannot open) are dropped after, and two kinds share the limit. */
const REQUEST_LIMIT = 20;

/** Why a query cannot be sent, or null when it can. */
export function queryProblem(q: string): string | null {
  const n = q.trim().length;
  if (n < 1) return 'Type what you are looking for.';
  if (n > MAX_QUERY) return `Use at most ${MAX_QUERY} characters.`;
  return null;
}

/** A saved report the engine found, with the data mart it reads. */
type ReportHit = { id: string; title: string; martId: string };
export type SearchHits = { reports: ReportHit[]; marts: string[] };

const score = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : -Infinity);
/** The best entries, best score first, at most five; Array.prototype.sort is stable, so equal scores keep the engine's order. */
const top = <T,>(m: Map<string, { score: number; hit: T }>): T[] => [...m.values()].sort((a, b) => b.score - a.score).slice(0, MAX_FOUND).map((e) => e.hit);
const keepBest = <T,>(m: Map<string, { score: number; hit: T }>, id: string, s: number, hit: T) => {
  if (!m.has(id) || s > m.get(id)!.score) m.set(id, { score: s, hit });
};

/**
 * The data marts and saved reports OWOX's own search engine ranks for the query (the engine behind the MCP tool
 * get_relevant_data_marts_by_prompt), each best first, at most five of each, only those on a mart the member can open in this model.
 * A failure or an odd answer finds nothing.
 */
export async function searchEndpoint(ctx: Ctx, query: string, model: Model, signal?: AbortSignal): Promise<SearchHits> {
  const none: SearchHits = { reports: [], marts: [] };
  const q = query.trim();
  // A one-character query is a title match only: the backend refuses under its minimum.
  if (q.length < MIN_QUERY || queryProblem(q)) return none;
  let body: unknown;
  try {
    body = await ctx.owox.getJson<unknown>('/api/search', { q, entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: String(REQUEST_LIMIT) });
  } catch (e) {
    console.warn('The OWOX search failed', e);
    return none;
  }
  if (signal?.aborted || !Array.isArray(body)) return none;
  const marts = new Map<string, { score: number; hit: string }>();
  const reports = new Map<string, { score: number; hit: ReportHit }>();
  for (const item of body) {
    if (typeof item !== 'object' || item === null) continue;
    const { entityType, entityId, title, finalScore, report } = item as Record<string, unknown>;
    if (typeof entityId !== 'string') continue;
    if (entityType === 'DATA_MART') {
      if (model.marts.get(entityId)?.accessible) keepBest(marts, entityId, score(finalScore), entityId);
    } else if (entityType === 'REPORT') {
      const martId = ((report as { dataMart?: { id?: unknown } } | null | undefined)?.dataMart)?.id;
      if (typeof martId !== 'string' || !model.marts.get(martId)?.accessible) continue;
      keepBest(reports, entityId, score(finalScore), { id: entityId, title: typeof title === 'string' ? title : entityId, martId });
    }
  }
  return { reports: top(reports), marts: top(marts) };
}
