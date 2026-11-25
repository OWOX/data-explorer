// The Sankey's geometry, pure: where each node and ribbon goes. No data is computed here beyond sizes; the values are the reads'.
import { isBlankKey, OTHER_KEY } from './blank';
import { columnColors } from './labelColor';

/** One flow between a node of column i (source) and a node of column i+1 (target). `origin` is the node of column 0 it started from (the source itself in the first pair); it colours the ribbon. Without one (fan-out mode, past the first pair) the ribbon takes its source node's colour. */
export type Flow = { source: string; target: string; value: number; origin?: string };
/** A column's node and its exact total. */
export type NodeSize = { key: string; value: number };
/** What colours a node: the colour its label starts from (see labelColor.ts), the blank grey or the muted Other. */
export type Tone = { kind: 'series'; color: string } | { kind: 'blank' } | { kind: 'other' };
export type SankeyNode = { col: number; key: string; x: number; y: number; w: number; h: number; value: number; tone: Tone };
export type SankeyLink = { pair: number; source: string; target: string; origin?: string; value: number; path: string; tone: Tone; x0: number; x1: number; y0: number; y1: number; w: number; w1: number };
export type SankeyLayout = { nodes: SankeyNode[]; links: SankeyLink[]; height: number };

/** The `origin` of a ribbon that stands for several small ribbons of one (source, target): their origins are not told apart. */
export const REST_ORIGIN = '\u0000rest';
/** A ribbon below this share of its pair's total is merged with the other small ones between the same two nodes. */
export const REST_SHARE = 0.005;

export const NODE_W = 12;
export const NODE_GAP = 8;
const MIN_H = 180;
const PER_NODE = 26;

const side = (k: string) => (isBlankKey(k) ? 0 : k === OTHER_KEY ? 2 : 1);
/** Blank first, "Other" last, the rest by size (largest first). */
const rankOf = (keys: string[], totals: Map<string, number>): string[] =>
  [...keys].sort((a, b) => side(a) - side(b) || (totals.get(b) ?? 0) - (totals.get(a) ?? 0));

/** Ribbons below REST_SHARE of the pair's total become one ribbon (origin REST_ORIGIN) per (source, target); a lone small ribbon stays as it is. Sums are unchanged. */
function mergeSmall(pair: Flow[]): Flow[] {
  const total = pair.reduce((s, f) => s + f.value, 0);
  const limit = total * REST_SHARE;
  const rest = new Map<string, Flow[]>();
  const kept: Flow[] = [];
  for (const f of pair) {
    if (f.value >= limit) { kept.push(f); continue; }
    const id = `${f.source}\u0001${f.target}`;
    rest.set(id, [...(rest.get(id) ?? []), f]);
  }
  for (const group of rest.values()) kept.push(group.length === 1 ? group[0]! : { source: group[0]!.source, target: group[0]!.target, ...(group.every((f) => f.origin === undefined) ? {} : { origin: REST_ORIGIN }), value: group.reduce((s, f) => s + f.value, 0) });
  return kept;
}

/**
 * Columns evenly spaced across `width` (the last one keeps `padRight` for its labels). A column's nodes run blank first, then by size, "Other" last;
 * a node is as tall as its exact column total (`columns`; without it, the larger of what flows in and out), never less than its ribbons. One scale for the whole chart.
 * With `fit` (fan-out mode) a node is exactly as tall as its column total, and when the ribbons leaving (or entering) it add up to more, they are scaled down
 * together so they fit inside it; a ribbon can then be thinner at one end. Without `fit` nothing is scaled and a node grows to hold its ribbons.
 * A node's ribbons leave it in the order of the opposite nodes' rank, which keeps neighbours from crossing. A ribbon takes the colour of its origin in column 0.
 */
export function layoutSankey({ flows, columns, width, padRight = 0, height, fit = false }: { flows: Flow[][]; columns?: NodeSize[][]; width: number; padRight?: number; height?: number; fit?: boolean }): SankeyLayout {
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
    const total = new Map((columns?.[c] ?? []).filter((n) => n.value > 0).map((n) => [n.key, n.value]));
    for (const k of new Set([...total.keys(), ...ins[c]!.keys(), ...outs[c]!.keys()])) m.set(k, fit && total.has(k) ? total.get(k)! : Math.max(total.get(k) ?? 0, ins[c]!.get(k) ?? 0, outs[c]!.get(k) ?? 0));
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
  const step = cols > 1 ? Math.max(0, (width - padRight - NODE_W) / (cols - 1)) : 0;

  // Tones: a node takes the colour its label hashes to. Labels that share a column differ while the palette lasts, a value in several columns has
  // one colour, and another column's values do not push a label off its colour, except a value that appears in both columns. Two labels that
  // never share a column may share a colour.
  const colors = columnColors(order.map((keys) => keys.filter((k) => !isBlankKey(k) && k !== OTHER_KEY)));
  const tones: Map<string, Tone>[] = order.map((keys) => new Map(keys.map((key): [string, Tone] => [key, isBlankKey(key) ? { kind: 'blank' } : key === OTHER_KEY ? { kind: 'other' } : { kind: 'series', color: colors.get(key)! }])));

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
  drawn.map((pair) => mergeSmall(pair)).forEach((pair, i) => {
    const outAt = new Map<string, number>();
    const inAt = new Map<string, number>();
    // Source slots run in the target's rank order, target slots in the source's: neighbours stay neighbours.
    const originOf = (f: Flow) => f.origin ?? (i === 0 || !fit ? f.source : undefined);
    const first = (f: Flow) => rank[0]!.get(originOf(f) ?? '') ?? Number.MAX_SAFE_INTEGER;
    const bySource = [...pair].sort((a, b) => rank[i]!.get(a.source)! - rank[i]!.get(b.source)! || rank[i + 1]!.get(a.target)! - rank[i + 1]!.get(b.target)! || first(a) - first(b));
    const byTarget = [...pair].sort((a, b) => rank[i + 1]!.get(a.target)! - rank[i + 1]!.get(b.target)! || rank[i]!.get(a.source)! - rank[i]!.get(b.source)! || first(a) - first(b));
    // Ribbons that add up to more than their node are scaled to fit it (fit mode only).
    const outSum = new Map<string, number>();
    const inSum = new Map<string, number>();
    for (const f of pair) { outSum.set(f.source, (outSum.get(f.source) ?? 0) + f.value); inSum.set(f.target, (inSum.get(f.target) ?? 0) + f.value); }
    const squeeze = (sum: number | undefined, node: SankeyNode) => (fit && sum !== undefined && sum * k > node.h && sum > 0 ? node.h / (sum * k) : 1);
    const outFit = new Map([...outSum].map(([key, sum]) => [key, squeeze(sum, at.get(`${i}|${key}`)!)]));
    const inFit = new Map([...inSum].map(([key, sum]) => [key, squeeze(sum, at.get(`${i + 1}|${key}`)!)]));
    const srcOff = new Map<Flow, number>();
    const tgtOff = new Map<Flow, number>();
    for (const f of bySource) { const o = outAt.get(f.source) ?? 0; srcOff.set(f, o); outAt.set(f.source, o + f.value * k * outFit.get(f.source)!); }
    for (const f of byTarget) { const o = inAt.get(f.target) ?? 0; tgtOff.set(f, o); inAt.set(f.target, o + f.value * k * inFit.get(f.target)!); }
    for (const f of bySource) {
      const s = at.get(`${i}|${f.source}`)!;
      const t = at.get(`${i + 1}|${f.target}`)!;
      const w = f.value * k * outFit.get(f.source)!;
      const w1 = f.value * k * inFit.get(f.target)!;
      const x0 = s.x + s.w;
      const x1 = t.x;
      const y0 = s.y + srcOff.get(f)!;
      const y1 = t.y + tgtOff.get(f)!;
      const mid = (x0 + x1) / 2;
      const n = (v: number) => v.toFixed(2);
      const path = `M${n(x0)} ${n(y0)}C${n(mid)} ${n(y0)} ${n(mid)} ${n(y1)} ${n(x1)} ${n(y1)}L${n(x1)} ${n(y1 + w1)}C${n(mid)} ${n(y1 + w1)} ${n(mid)} ${n(y0 + w)} ${n(x0)} ${n(y0 + w)}Z`;
      links.push({ pair: i, source: f.source, target: f.target, origin: originOf(f), value: f.value, path, tone: (originOf(f) !== undefined && tones[0]!.get(originOf(f)!)) || s.tone, x0, x1, y0, y1, w, w1 });
    }
  });
  return { nodes, links, height: h };
}
