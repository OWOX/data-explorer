import type { Context, Mart, Schema } from '../model/types';

export function matchesSearch(mart: Mart, query: string, contexts: Context[], schema: Schema | undefined): { hit: boolean; field?: string } {
  const q = query.trim().toLowerCase();
  if (!q) return { hit: true };
  if (mart.title.toLowerCase().includes(q)) return { hit: true };
  const names = contexts.filter((c) => mart.contextIds.includes(c.id)).map((c) => c.name.toLowerCase());
  if (names.some((n) => n.includes(q))) return { hit: true };
  const f = schema?.find((x) => x.name.toLowerCase().includes(q) || (x.alias ?? '').toLowerCase().includes(q));
  return f ? { hit: true, field: f.name } : { hit: false };
}

export function matchesContexts(mart: Mart, contextIds: string[]): boolean {
  return contextIds.length === 0 || mart.contextIds.some((c) => contextIds.includes(c));
}
