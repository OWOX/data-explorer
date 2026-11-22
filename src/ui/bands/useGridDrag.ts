import type { JoinedSource } from '../../api/blendable';
import type { JoinTree, Rejoin } from '../../state/join-tree';
import { boxLinePath, closestBy, dropTargets, type DragLine } from './canvas-drag';
import { martElementId } from './cards';

/** A place a joined card in hand can be dropped, with where its card is on the page (client pixels). */
export type GridTarget = { target: Rejoin; el: string; box: DOMRect };

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
