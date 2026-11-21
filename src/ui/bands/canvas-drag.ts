import type { JoinedSource } from '../../api/blendable';
import { rejoinTargets, type JoinTree, type Rejoin } from '../../state/join-tree';
import { CARD_H, CARD_W, type Placed } from './canvas-layout';

/** The target whose card centre is closest to the point (canvas coordinates); null with no targets. */
export function closestTarget(targets: Rejoin[], placed: Placed[], x: number, y: number): Rejoin | null {
  let best: Rejoin | null = null;
  let bestD = Infinity;
  for (const t of targets) {
    const p = placed.find((q) => q.path === t.target);
    if (!p) continue;
    const d = Math.hypot(p.x + CARD_W / 2 - x, p.y + CARD_H / 2 - y);
    if (d < bestD) { bestD = d; best = t; }
  }
  return best;
}

/** Where a card may be dropped: the rejoin targets, plus its current parent as a no-op target (empty moves). */
export function dropTargets(tree: JoinTree, sources: JoinedSource[], path: string): Rejoin[] {
  const out = rejoinTargets(tree, sources, path);
  const parent = tree.nodes.get(path)?.parent ?? null;
  if (parent !== null && !out.some((t) => t.target === parent)) out.push({ target: parent, moves: new Map() });
  return out;
}

/** The path data of a dashed line from the card in hand to a target card, both in canvas pixels: it leaves the side that faces the target. */
export function dragLinePath(from: Placed, to: Placed): string {
  const y1 = from.y + CARD_H / 2;
  const y2 = to.y + CARD_H / 2;
  // Two cards in one column: both lines bow out on the right.
  if (to.x === from.x) {
    const x = from.x + CARD_W;
    const bow = x + 48;
    return `M${x} ${y1} C${bow} ${y1} ${bow} ${y2} ${x} ${y2}`;
  }
  const dir = to.x > from.x ? 1 : -1;
  const x1 = dir === 1 ? from.x + CARD_W : from.x;
  const x2 = dir === 1 ? to.x : to.x + CARD_W;
  const pull = Math.max(40, Math.abs(x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dir * pull} ${y1} ${x2 - dir * pull} ${y2} ${x2} ${y2}`;
}
