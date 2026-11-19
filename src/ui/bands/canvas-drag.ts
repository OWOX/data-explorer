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
