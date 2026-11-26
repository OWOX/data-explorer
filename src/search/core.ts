import type { Model } from '../model/types';
import type { SearchHits } from './endpoint';
import { overlap } from './words';

export type CoreSignals = { inbound: number; outbound: number; neighbours: number; keyAgreement: number; score: number };
export const SHORTLIST_MAX = 20;
const ZERO: CoreSignals = { inbound: 0, outbound: 0, neighbours: 0, keyAgreement: 0, score: 0 };

/**
 * How much a mart looks like a core entity, from relationships alone: many joins in and out, many neighbours, and inbound joins
 * that agree on one key field. No title or name is read.
 */
export function coreSignals(model: Model): Map<string, CoreSignals> {
  const inbound = new Map<string, number>();
  const outbound = new Map<string, number>();
  const neighbours = new Map<string, Set<string>>();
  const keys = new Map<string, Map<string, number>>();
  const add = (m: Map<string, number>, id: string) => m.set(id, (m.get(id) ?? 0) + 1);
  for (const e of model.edges) {
    add(outbound, e.source);
    add(inbound, e.target);
    (neighbours.get(e.source) ?? neighbours.set(e.source, new Set()).get(e.source)!).add(e.target);
    (neighbours.get(e.target) ?? neighbours.set(e.target, new Set()).get(e.target)!).add(e.source);
    const key = e.joins.map((j) => j.targetField).sort().join(',');
    const byKey = keys.get(e.target) ?? keys.set(e.target, new Map()).get(e.target)!;
    add(byKey, key);
  }
  const out = new Map<string, CoreSignals>();
  for (const id of model.marts.keys()) {
    const i = inbound.get(id) ?? 0;
    const o = outbound.get(id) ?? 0;
    const n = neighbours.get(id)?.size ?? 0;
    if (!i && !o) { out.set(id, ZERO); continue; }
    const agree = i ? Math.max(...(keys.get(id)?.values() ?? [0])) / i : 0;
    out.set(id, { inbound: i, outbound: o, neighbours: n, keyAgreement: agree, score: Math.log2(1 + i) + Math.log2(1 + o) + 0.5 * Math.log2(1 + n) + agree });
  }
  return out;
}

/** Whether a search hit is this mart, or a report built on it. */
export const isHit = (hits: SearchHits, martId: string): boolean => hits.marts.includes(martId) || hits.reports.some((r) => r.martId === martId);

/** 3 for a search hit (a mart hit or a report's mart), plus 1 per subject that shares a word with the title or description. */
export function relevance(martId: string, model: Model, hits: SearchHits, subjects: string[]): number {
  const hit = isHit(hits, martId);
  const m = model.marts.get(martId);
  const text = `${m?.title ?? ''} ${m?.description ?? ''}`;
  return (hit ? 3 : 0) + subjects.filter((s) => overlap(s, text) > 0).length;
}

/** The marts step 1 may choose from: accessible ones, by relevance, then by core score, then catalogue order. */
export function shortlist(model: Model, signals: Map<string, CoreSignals>, hits: SearchHits, subjects: string[], max = SHORTLIST_MAX): string[] {
  return [...model.marts.values()]
    .filter((m) => m.accessible)
    .map((m, i) => ({ id: m.id, i, r: relevance(m.id, model, hits, subjects), c: signals.get(m.id)?.score ?? 0 }))
    .sort((a, b) => b.r - a.r || b.c - a.c || a.i - b.i)
    .slice(0, max)
    .map((x) => x.id);
}
