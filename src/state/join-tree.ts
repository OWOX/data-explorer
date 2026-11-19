// src/state/join-tree.ts
// The report as a tree: the main mart at alias path '', each joined mart at the alias path its columns use.
import type { JoinedSource } from '../api/blendable';
import { parentPath } from './join-plan';

export type TreeNode = { path: string; martId: string; parent: string | null; children: string[] };
export type JoinTree = { nodes: Map<string, TreeNode> };

/** The tree a grid shows. A mart is placed once, at the shallowest path its columns use; a path hangs from its deepest in-use ancestor. */
export function buildJoinTree(mainId: string, columns: string[], sources: JoinedSource[]): JoinTree {
  const pathOf = new Map<string, JoinedSource>();
  for (const s of sources) for (const f of s.fields) if (!pathOf.has(f.name)) pathOf.set(f.name, s);
  // In-use paths in the order their first column appears.
  const used: JoinedSource[] = [];
  for (const c of columns) {
    const s = pathOf.get(c);
    if (s && !used.includes(s)) used.push(s);
  }
  // One path per mart: the shallowest, ties to the first in column order.
  const byMart = new Map<string, JoinedSource>();
  for (const s of used) {
    const have = byMart.get(s.martId);
    if (!have || s.depth < have.depth) byMart.set(s.martId, s);
  }
  const kept = used.filter((s) => byMart.get(s.martId) === s);
  const nodes = new Map<string, TreeNode>([['', { path: '', martId: mainId, parent: null, children: [] }]]);
  const inUse = new Set(kept.map((s) => s.aliasPath));
  // Parents before children: shallow first, column order within a depth.
  for (const s of [...kept].sort((p, q) => p.depth - q.depth)) {
    let up = parentPath(s.aliasPath);
    while (up !== '' && !inUse.has(up)) up = parentPath(up);
    nodes.set(s.aliasPath, { path: s.aliasPath, martId: s.martId, parent: up, children: [] });
  }
  // Children in column order.
  for (const s of kept) nodes.get(nodes.get(s.aliasPath)!.parent!)!.children.push(s.aliasPath);
  return { nodes };
}

export function subtreePaths(tree: JoinTree, path: string): string[] {
  const node = tree.nodes.get(path);
  if (!node) return [];
  return [path, ...node.children.flatMap((c) => subtreePaths(tree, c))];
}

/** What can join under a path and is not in the report yet: one source per mart. */
export function ghostSources(tree: JoinTree, sources: JoinedSource[], path: string): JoinedSource[] {
  if (!tree.nodes.has(path)) return [];
  const inReport = new Set([...tree.nodes.values()].map((n) => n.martId));
  const out: JoinedSource[] = [];
  for (const s of sources) {
    if (parentPath(s.aliasPath) !== path || inReport.has(s.martId) || out.some((o) => o.martId === s.martId)) continue;
    out.push(s);
  }
  return out;
}

export type Rejoin = { target: string; moves: Map<string, string> };

/** The nodes the mart at `path` can move under, with its subtree; each target says the new path of every moved node. */
export function rejoinTargets(tree: JoinTree, sources: JoinedSource[], path: string): Rejoin[] {
  const node = tree.nodes.get(path);
  if (!node || path === '') return [];
  const moved = subtreePaths(tree, path);
  const exists = (p: string, martId: string) => sources.some((s) => s.aliasPath === p && s.martId === martId);
  const out: Rejoin[] = [];
  for (const t of tree.nodes.values()) {
    if (moved.includes(t.path) || t.path === node.parent) continue;
    // The path C takes under T: a source of C's mart one hop under T. The first one the whole subtree can follow wins.
    for (const under of sources) {
      if (under.martId !== node.martId || parentPath(under.aliasPath) !== t.path || under.aliasPath === path) continue;
      const moves = new Map<string, string>([[path, under.aliasPath]]);
      let ok = true;
      for (const d of moved.slice(1)) {
        const next = under.aliasPath + d.slice(path.length);
        if (!exists(next, tree.nodes.get(d)!.martId)) { ok = false; break; }
        moves.set(d, next);
      }
      if (ok) { out.push({ target: t.path, moves }); break; }
    }
  }
  return out;
}
