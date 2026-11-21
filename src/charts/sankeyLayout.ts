// The Sankey's geometry, pure: where each node and ribbon goes. No data is computed here beyond sizes; the values are the reads'.
import { isBlankKey, OTHER_KEY } from './blank';

/** One read flow between a node of column i (source) and a node of column i+1 (target). */
export type Flow = { source: string; target: string; value: number };
/** What colours a node: a series slot, the blank grey or the muted Other. */
export type Tone = { kind: 'series'; index: number } | { kind: 'blank' } | { kind: 'other' };
export type SankeyNode = { col: number; key: string; x: number; y: number; w: number; h: number; value: number; tone: Tone };
export type SankeyLink = { pair: number; source: string; target: string; value: number; path: string; tone: Tone; x0: number; x1: number; y0: number; y1: number; w: number };
export type SankeyLayout = { nodes: SankeyNode[]; links: SankeyLink[]; height: number };

export const NODE_W = 12;
export const NODE_GAP = 8;
const MIN_H = 180;
const PER_NODE = 26;

const side = (k: string) => (isBlankKey(k) ? 0 : k === OTHER_KEY ? 2 : 1);
/** Blank first, "Other" last, the rest by size (largest first). */
const rankOf = (keys: string[], totals: Map<string, number>): string[] =>
  [...keys].sort((a, b) => side(a) - side(b) || (totals.get(b) ?? 0) - (totals.get(a) ?? 0));

/**
 * Columns evenly spaced across `width` (the last one keeps `padRight` for its labels). A column's nodes run blank first, then by size, "Other" last;
 * a node is as tall as the larger of what flows in and out (each pair is read apart, so the two can differ). One scale for the whole chart.
 * A node's ribbons leave it in the order of the opposite nodes' rank, which keeps neighbours from crossing.
 */
export function layoutSankey({ flows, width, padRight = 0, height }: { flows: Flow[][]; width: number; padRight?: number; height?: number }): SankeyLayout {
  const cols = flows.length + 1;
  const ins: Map<string, number>[] = Array.from({ length: cols }, () => new Map());
  const outs: Map<string, number>[] = Array.from({ length: cols }, () => new Map());
  const drawn = flows.map((pair) => pair.filter((f) => f.value > 0));
  drawn.forEach((pair, i) => pair.forEach((f) => {
    outs[i]!.set(f.source, (outs[i]!.get(f.source) ?? 0) + f.value);
    ins[i + 1]!.set(f.target, (ins[i + 1]!.get(f.target) ?? 0) + f.value);
  }));
  const sizes = Array.from({ length: cols }, (_, c) => {
    const m = new Map<string, number>();
    for (const k of new Set([...ins[c]!.keys(), ...outs[c]!.keys()])) m.set(k, Math.max(ins[c]!.get(k) ?? 0, outs[c]!.get(k) ?? 0));
    return m;
  });
  const order = sizes.map((m) => rankOf([...m.keys()], m));
  const rank = order.map((keys) => new Map(keys.map((k, i) => [k, i])));
  const maxNodes = Math.max(1, ...order.map((o) => o.length));
  const h = height ?? Math.max(MIN_H, maxNodes * PER_NODE);
  // One scale: the column that needs the most room per unit sets it.
  const scale = Math.min(...order.map((keys, c) => {
    const sum = keys.reduce((s, k) => s + sizes[c]!.get(k)!, 0);
    return sum > 0 ? (h - Math.max(0, keys.length - 1) * NODE_GAP) / sum : Number.POSITIVE_INFINITY;
  }));
  const k = Number.isFinite(scale) ? Math.max(0, scale) : 0;
  const step = cols > 1 ? (width - padRight - NODE_W) / (cols - 1) : 0;

  // Tones: the first column takes series slots by rank; a later node takes the tone of the source of its largest incoming ribbon.
  const tones: Map<string, Tone>[] = Array.from({ length: cols }, () => new Map());
  let slot = 0;
  for (let c = 0; c < cols; c++) {
    for (const key of order[c]!) {
      if (isBlankKey(key)) tones[c]!.set(key, { kind: 'blank' });
      else if (key === OTHER_KEY) tones[c]!.set(key, { kind: 'other' });
      else {
        const best = c === 0 ? undefined : drawn[c - 1]!.filter((f) => f.target === key).sort((a, b) => b.value - a.value)[0];
        tones[c]!.set(key, (best && tones[c - 1]!.get(best.source)) || { kind: 'series', index: slot++ });
      }
    }
  }

  const nodes: SankeyNode[] = [];
  const at = new Map<string, SankeyNode>();
  order.forEach((keys, c) => {
    let y = 0;
    for (const key of keys) {
      const node: SankeyNode = { col: c, key, x: c * step, y, w: NODE_W, h: sizes[c]!.get(key)! * k, value: sizes[c]!.get(key)!, tone: tones[c]!.get(key)! };
      nodes.push(node);
      at.set(`${c}|${key}`, node);
      y += node.h + NODE_GAP;
    }
  });

  const links: SankeyLink[] = [];
  drawn.forEach((pair, i) => {
    const outAt = new Map<string, number>();
    const inAt = new Map<string, number>();
    // Source slots run in the target's rank order, target slots in the source's: neighbours stay neighbours.
    const bySource = [...pair].sort((a, b) => rank[i]!.get(a.source)! - rank[i]!.get(b.source)! || rank[i + 1]!.get(a.target)! - rank[i + 1]!.get(b.target)!);
    const byTarget = [...pair].sort((a, b) => rank[i + 1]!.get(a.target)! - rank[i + 1]!.get(b.target)! || rank[i]!.get(a.source)! - rank[i]!.get(b.source)!);
    const srcOff = new Map<Flow, number>();
    const tgtOff = new Map<Flow, number>();
    for (const f of bySource) { const o = outAt.get(f.source) ?? 0; srcOff.set(f, o); outAt.set(f.source, o + f.value * k); }
    for (const f of byTarget) { const o = inAt.get(f.target) ?? 0; tgtOff.set(f, o); inAt.set(f.target, o + f.value * k); }
    for (const f of bySource) {
      const s = at.get(`${i}|${f.source}`)!;
      const t = at.get(`${i + 1}|${f.target}`)!;
      const w = f.value * k;
      const x0 = s.x + s.w;
      const x1 = t.x;
      const y0 = s.y + srcOff.get(f)!;
      const y1 = t.y + tgtOff.get(f)!;
      const mid = (x0 + x1) / 2;
      const n = (v: number) => v.toFixed(2);
      const path = `M${n(x0)} ${n(y0)}C${n(mid)} ${n(y0)} ${n(mid)} ${n(y1)} ${n(x1)} ${n(y1)}L${n(x1)} ${n(y1 + w)}C${n(mid)} ${n(y1 + w)} ${n(mid)} ${n(y0 + w)} ${n(x0)} ${n(y0 + w)}Z`;
      links.push({ pair: i, source: f.source, target: f.target, value: f.value, path, tone: s.tone, x0, x1, y0, y1, w });
    }
  });
  return { nodes, links, height: h };
}
