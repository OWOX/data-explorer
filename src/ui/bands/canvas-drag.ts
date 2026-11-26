import type { JoinedSource } from '../../api/blendable';
import { rejoinTargets, type JoinTree, type Rejoin } from '../../state/join-tree';
import { martElementId } from './cards';
import { CARD_H, CARD_W, type Placed } from './canvas-layout';

/** The target whose card centre is closest to the point; `centreOf` says where a target's card is, or undefined when it is not on the page. Both views pick the same way. */
function closestBy(targets: Rejoin[], centreOf: (target: string) => { x: number; y: number } | undefined, x: number, y: number): Rejoin | null {
  let best: Rejoin | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const c = centreOf(t.target);
    if (!c) continue;
    const d = Math.hypot(c.x - x, c.y - y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** The target whose card centre is closest to the point (canvas coordinates); null with no targets. */
export function closestTarget(targets: Rejoin[], placed: Placed[], x: number, y: number): Rejoin | null {
  return closestBy(targets, (path) => { const p = placed.find((q) => q.path === path); return p && { x: p.x + CARD_W / 2, y: p.y + CARD_H / 2 }; }, x, y);
}

/** Where a card may be dropped: the rejoin targets, plus its current parent as a no-op target (empty moves). */
export function dropTargets(tree: JoinTree, sources: JoinedSource[], path: string): Rejoin[] {
  const out = rejoinTargets(tree, sources, path);
  const parent = tree.nodes.get(path)?.parent ?? null;
  if (parent !== null && !out.some((t) => t.target === parent)) out.push({ target: parent, moves: new Map() });
  return out;
}

/** A card's box in the pixels of the canvas the line is drawn in. */
export type Box = { x: number; y: number; w: number; h: number };

/** One line from the card in hand to a target, as the drag layer draws it: solid to the mart it is joined under now, dashed to the others, the closest one stronger. */
export type DragLine = { target: string; d: string; current: boolean; closest: boolean };

/** The path data of a line from the card in hand to a target card, both in canvas pixels: it leaves the side that faces the target. */
export function dragLinePath(from: Placed, to: Placed): string {
  return boxLinePath({ ...from, w: CARD_W, h: CARD_H }, { ...to, w: CARD_W, h: CARD_H });
}

/** The same for boxes of any size (the Grid's cards are not the Graph's size). */
export function boxLinePath(from: Box, to: Box, arcRise?: number): string {
  // Cards in one row (the Grid): the line arcs over the cards between, higher the farther the target up to `arcRise`, so lines to neighbours do not run on top of each other.
  if (arcRise !== undefined && Math.abs(from.y - to.y) < 8 && to.x !== from.x) {
    const x1 = from.x + from.w / 2;
    const x2 = to.x + to.w / 2;
    // The curve peaks at 3/4 of the control height, so the control height is capped at 4/3 of the room (`arcRise`, the most the line may rise above the cards).
    // A negative `arcRise` is room below the row instead: the arc leaves the bottom edges.
    const side = arcRise < 0 ? 1 : -1;
    const h = ((Math.abs(arcRise) * 4) / 3) * (0.4 + 0.6 * Math.min(1, Math.abs(x2 - x1) / 800));
    const y = side === 1 ? from.y + from.h : from.y;
    const y2 = side === 1 ? to.y + to.h : to.y;
    return `M${x1} ${y} C${x1} ${y + side * h} ${x2} ${y2 + side * h} ${x2} ${y2}`;
  }
  const y1 = from.y + from.h / 2;
  const y2 = to.y + to.h / 2;
  // Two cards in one column: both lines bow out on the right.
  if (to.x === from.x) {
    const x = from.x + from.w;
    const bow = x + 48;
    return `M${x} ${y1} C${bow} ${y1} ${bow} ${y2} ${x} ${y2}`;
  }
  const dir = to.x > from.x ? 1 : -1;
  const x1 = dir === 1 ? from.x + from.w : from.x;
  const x2 = dir === 1 ? to.x : to.x + to.w;
  const pull = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dir * pull} ${y1} ${x2 - dir * pull} ${y2} ${x2} ${y2}`;
}

/** A place a joined card in hand can be dropped, with where its card is on the page (client pixels). */
type GridTarget = { target: Rejoin; el: string; box: DOMRect };

/** The drop targets of the card at `path` whose cards are on the page; a card in a folded band or leaving is no target. */
export function gridTargets(root: HTMLElement | null, tree: JoinTree | null, sources: JoinedSource[] | null, path: string): GridTarget[] {
  if (!root || !tree) return [];
  const out: GridTarget[] = [];
  for (const target of dropTargets(tree, sources ?? [], path)) {
    const node = tree.nodes.get(target.target);
    if (!node) continue;
    const el = martElementId(node.martId, target.target || undefined);
    const card = document.getElementById(el);
    if (!card || !root.contains(card) || card.closest('[hidden], [data-leaving]')) continue;
    out.push({ target, el, box: card.getBoundingClientRect() });
  }
  return out;
}

/** The target whose card is closest to the pointer (client pixels). */
export function closestGridTarget(targets: GridTarget[], x: number, y: number): Rejoin | null {
  return closestBy(targets.map((t) => t.target), (path) => { const b = targets.find((t) => t.target.target === path)?.box; return b && { x: b.left + b.width / 2, y: b.top + b.height / 2 }; }, x, y);
}

/** What the Grid shows while a joined card is in hand: the cards it can be dropped on (they stay lit, the rest dim) and the lines to them. */
export type GridDragView = { held: string | null; els: Set<string>; lines: DragLine[] };

/**
 * Measured on each pointer move: the lines run from the card in hand to every target (client boxes made relative to the canvas), solid to
 * the current parent and dashed to the others, the closest one stronger.
 */
export function measureGridDrag(root: HTMLElement | null, tree: JoinTree | null, sources: JoinedSource[] | null, path: string, x: number, y: number, inside: boolean): GridDragView {
  const held = tree?.nodes.get(path);
  const heldEl = held ? martElementId(held.martId, held.path || undefined) : null;
  const from = heldEl ? document.getElementById(heldEl)?.getBoundingClientRect() : undefined;
  if (!root || !held || !from) return { held: heldEl, els: new Set(), lines: [] };
  const targets = gridTargets(root, tree, sources, path);
  const pick = inside ? closestGridTarget(targets, x, y) : null;
  const origin = root.getBoundingClientRect();
  // The arcs stay inside the band body and rise at most 40px from the cards. A first-row card has next to no room above, so the arc
  // goes below the row (into the gap to the next row, or the band's bottom padding) when there is more room there.
  const body = root.querySelector('#band-marts .dm-band-body')?.getBoundingClientRect();
  const nextTop = Math.min(body?.bottom ?? Infinity, ...[...root.querySelectorAll('#band-marts .dm-band-body article')].map((a) => a.getBoundingClientRect().top).filter((top) => top > from.bottom));
  const above = body ? from.top - body.top - 4 : 0;
  const below = nextTop - from.bottom - 4;
  const rise = Math.max(3, Math.min(40, Math.max(above, below)));
  const box = (r: DOMRect) => ({ x: r.left - origin.left, y: r.top - origin.top, w: r.width, h: r.height });
  return {
    held: heldEl,
    els: new Set(targets.map((t) => t.el)),
    lines: targets.map((t) => ({ target: t.target.target, d: boxLinePath(box(from), box(t.box), below > above ? -rise : rise), current: t.target.target === held.parent, closest: pick?.target === t.target.target })),
  };
}
