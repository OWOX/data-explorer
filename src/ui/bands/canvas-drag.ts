import type { JoinedSource } from '../../api/blendable';
import { rejoinTargets, type JoinTree, type Rejoin } from '../../state/join-tree';
import { CARD_H, CARD_W, type Placed } from './canvas-layout';

/** The target whose card centre is closest to the point; `centreOf` says where a target's card is, or undefined when it is not on the page. Both views pick the same way. */
export function closestBy(targets: Rejoin[], centreOf: (target: string) => { x: number; y: number } | undefined, x: number, y: number): Rejoin | null {
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
