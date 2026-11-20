// Where each card of the canvas goes: the column is the depth in the tree, leaves stack, a parent is centred on its children.
import type { JoinTree } from '../../state/join-tree';

export const CARD_W = 224; // 14rem, the grid's minimum card width
export const CARD_H = 112;
export const COL_GAP = 128;
export const ROW_GAP = 32;
export type Placed = { path: string; x: number; y: number };

const colX = (depth: number) => depth * (CARD_W + COL_GAP);
const rowY = (row: number) => row * (CARD_H + ROW_GAP);

/** One column of ghosts: `ids` hang from `path`, a tree node or a ghost of the level before. */
export type GhostColumn = { path: string; ids: string[] };

/**
 * Positions for every node, plus the ghosts: each column of them goes after its parent's column.
 * Real cards never move for ghosts: ghosts start at the parent's row or the first row below the cards already in that column, whichever is lower, and stack downward.
 * A column hangs from a ghost of an earlier column when its `path` is one of their ids, so the columns form a chain.
 */
export function layoutTree(
  tree: JoinTree,
  extra?: GhostColumn | GhostColumn[],
): { placed: Placed[]; ghosts: { id: string; x: number; y: number }[]; width: number; height: number } {
  const placed: Placed[] = [];
  const slot = new Map<string, { depth: number; row: number }>();
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
    slot.set(path, { depth, row });
    placed.push({ path, x: colX(depth), y: rowY(row) });
    return row;
  };
  if (tree.nodes.has('')) place('', 0);
  placed.reverse(); // the main mart first
  const ghosts: { id: string; x: number; y: number }[] = [];
  let bottom = nextRow;
  for (const column of extra === undefined ? [] : Array.isArray(extra) ? extra : [extra]) {
    const parent = slot.get(column.path);
    if (!parent || column.ids.length === 0) continue;
    const depth = parent.depth + 1;
    let firstFree = 0;
    for (const s of slot.values()) if (s.depth === depth) firstFree = Math.max(firstFree, s.row + 1);
    const startRow = Math.max(parent.row, firstFree);
    column.ids.forEach((id, i) => {
      ghosts.push({ id, x: colX(depth), y: rowY(startRow + i) });
      // A ghost is a parent for the column after it.
      slot.set(id, { depth, row: startRow + i });
    });
    maxDepth = Math.max(maxDepth, depth);
    bottom = Math.max(bottom, startRow + column.ids.length);
  }
  return { placed, ghosts, width: colX(maxDepth) + CARD_W, height: rowY(Math.max(bottom, 1)) - ROW_GAP };
}
