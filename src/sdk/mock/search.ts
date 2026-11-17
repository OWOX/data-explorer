// A stand-in for GET /api/search (OWOX's keyword + semantic engine): keyword scoring over a mart's title and description.
// It answers the shape SearchResultResponseApiDto has, and 400s a query outside the backend's 2 to 256 characters.
import type { Fixtures } from './fixtures';

const STOP = new Set(['of', 'the', 'and', 'on', 'to', 'for', 'in', 'who', 'are', 'our', 'we', 'by', 'with', 'from', 'all', 'show', 'me', 'my', 'is', 'at', 'as', 'it', 'us', 'last', 'this', 'month', 'week', 'year', 'day', 'days', 'big', 'top', 'new']);

export const words = (s: string): string[] => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && !STOP.has(w));
const stem = (w: string) => w.replace(/(ies|es|s)$/, '');

export function mockSearch(f: Fixtures, query: Record<string, string> | undefined): unknown[] {
  const q = (query?.q ?? '').trim();
  if (q.length < 2 || q.length > 256) throw Object.assign(new Error(`Query must be between 2 and 256 characters`), { payload: { code: 'HTTP_ERROR', status: 400 } });
  const limit = Math.min(50, Math.max(1, Number(query?.limit) || 25));
  const wanted = (query?.entityTypes ?? 'DATA_MART').split(',');
  if (!wanted.includes('DATA_MART')) return [];
  const qs = words(q).map(stem);
  return f.marts
    .map((m) => {
      const title = new Set(words(m.title.replace(/_/g, ' ')).map(stem));
      const desc = new Set(words(m.description ?? '').map(stem));
      const keywordScore = qs.reduce((n, w) => n + (title.has(w) ? 20 : 0) + (desc.has(w) ? 8 : 0), 0);
      return { entityType: 'DATA_MART', entityId: m.id, title: m.title, description: m.description, finalScore: keywordScore, keywordScore, semanticScore: null };
    })
    .filter((r) => r.finalScore > 0)
    .sort((a, b) => b.finalScore - a.finalScore)
    .slice(0, limit);
}
