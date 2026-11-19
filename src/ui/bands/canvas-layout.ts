// Where each card of the canvas goes: the column is the depth in the tree, leaves stack, a parent is centred on its children.
import type { JoinTree } from '../../state/join-tree';

export const CARD_W = 224; // 14rem, the grid's minimum card width
export const CARD_H = 112;
export const COL_GAP = 96;
export const ROW_GAP = 16;
export type Placed = { path: string; x: number; y: number };

const colX = (depth: number) => depth * (CARD_W + COL_GAP);
const rowY = (row: number) => row * (CARD_H + ROW_GAP);

/** Positions for every node, plus `extra` children per path (the ghosts) placed in the next column after the real ones. */
export function layoutTree(
  tree: JoinTree,
  extra?: { path: string; ids: string[] },
): { placed: Placed[]; ghosts: { id: string; x: number; y: number }[]; width: number; height: number } {
  const placed: Placed[] = [];
  let nextRow = 0;
  let maxDepth = 0;
  // Returns the node's row (fractional for a centred parent).
  const place = (path: string, depth: number): number => {
    const node = tree.nodes.get(path)!;
    maxDepth = Math.max(maxDepth, depth);
    let row: number;
    if (node.children.length === 0) row = nextRow++;
    else {
      const rows = node.children.map((c) => place(c, depth + 1));
      row = (rows[0]! + rows.at(-1)!) / 2;
    }
    placed.push({ path, x: colX(depth), y: rowY(row) });
    return row;
  };
  if (tree.nodes.has('')) place('', 0);
  placed.reverse(); // the main mart first
  const ghosts: { id: string; x: number; y: number }[] = [];
  let bottom = nextRow;
  if (extra && extra.ids.length) {
    const parent = placed.find((p) => p.path === extra.path);
    if (parent) {
      const depth = Math.round(parent.x / (CARD_W + COL_GAP)) + 1;
      const startRow = parent.y / (CARD_H + ROW_GAP);
      extra.ids.forEach((id, i) => ghosts.push({ id, x: colX(depth), y: rowY(startRow + i) }));
      maxDepth = Math.max(maxDepth, depth);
      bottom = Math.max(bottom, startRow + extra.ids.length);
    }
  }
  return { placed, ghosts, width: colX(maxDepth) + CARD_W, height: rowY(Math.max(bottom, 1)) - ROW_GAP };
}
