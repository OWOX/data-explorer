import type { Rejoin } from '../../state/join-tree';
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
