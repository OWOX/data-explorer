# Canvas view for the Data Marts band: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Grid / Canvas switch on the Data Marts band. Canvas draws the report as a tree (main mart left, joined marts right), adds marts through hover ghosts, and moves a joined mart under another one by drag and drop.

**Architecture:** Three pure modules carry the logic: `state/join-tree.ts` (tree, ghosts, valid drop targets), new functions in `state/join-plan.ts` (add at a path, move paths) and `ui/bands/canvas-layout.ts` (positions). A new `ui/bands/MartsCanvas.tsx` renders absolutely positioned `MartCard`s with `useWires`, a hover/pin ghost column and a canvas drag hook `useCanvasDrag.ts`. `CardBands` switches between the existing grid body and `MartsCanvas`.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (jsdom), Playwright, lucide-react, plain global CSS in `src/ui/bands/bands.css`.

**Spec:** `docs/superpowers/specs/2026-11-19-marts-canvas-view-design.md`

## Global Constraints

1. No new runtime dependency.
2. Vitest runs with at most 4 threads: `npx vitest run --poolOptions.threads.maxThreads=4 <files>`.
3. Playwright: `npm run e2e -- <spec>` (it already passes `--workers=1 --trace off`).
4. Every grid change from the canvas is one `setMarts` dispatch, so Undo covers it.
5. No card changes its border, colour or size during a drag. The dashed line is the only target mark.
6. Dimmed during a drag: opacity 0.15 plus `filter: grayscale(1)`.
7. The view choice is saved in collection `preferences`, document `marts-view`, shape `{ view: 'grid' | 'canvas' }`. Missing or unknown reads as `'grid'`.
8. Code comments and copy follow the repo's style: plain sentences, no em dashes in new text.
9. Scratch files go in the project's `tmp/`, never system `/tmp`.

## Review Focus

1. A mart whose columns came from a stale path (its parent left the report): the tree must still place it, hanging from the deepest in-use ancestor or the main mart.
2. Dropping C onto its own current parent, or onto a mart under C: no target, no line, no change.
3. Filters and sorts on a moved mart's fields: they follow the move with the new field names, and filters on fields the new path lacks are dropped, not left dangling.
4. A drag released outside the canvas, or Escape mid-drag: nothing changes and the next click is not lost.
5. Joined sources not loaded yet, or failed: the canvas shows the main card alone, no ghosts, no crash.

Each line has a test in the task that owns the code (Tasks 1, 1, 2, 6, 5).

---

### Task 1: The report tree, ghosts and drop targets (`join-tree.ts`)

**Files:**
- Create: `src/state/join-tree.ts`
- Test: `src/state/join-tree.test.ts`

**Interfaces:**
- Consumes: `JoinedSource` from `src/api/blendable.ts`; `parentPath` from `src/state/join-plan.ts`.
- Produces:

```ts
export type TreeNode = { path: string; martId: string; parent: string | null; children: string[] };
export type JoinTree = { nodes: Map<string, TreeNode> }; // keyed by alias path; '' is the main mart
export function buildJoinTree(mainId: string, columns: string[], sources: JoinedSource[]): JoinTree;
export function subtreePaths(tree: JoinTree, path: string): string[]; // path itself first, then descendants depth-first
export function ghostSources(tree: JoinTree, sources: JoinedSource[], path: string): JoinedSource[];
export type Rejoin = { target: string; moves: Map<string, string> }; // target path; old alias path -> new alias path, for C and every node under it
export function rejoinTargets(tree: JoinTree, sources: JoinedSource[], path: string): Rejoin[];
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/state/join-tree.test.ts
import { expect, test } from 'vitest';
import type { JoinedSource } from '../api/blendable';
import type { Field } from '../model/types';
import { buildJoinTree, ghostSources, rejoinTargets, subtreePaths } from './join-tree';

const field = (path: string, own: string): Field => ({ name: `${path.replaceAll('.', '__')}__${own}`, alias: own, type: 'STRING', category: 'string', description: null, isPrimaryKey: false, joined: { martId: path.split('.').at(-1)!, label: path, aliasPath: path, originalName: own } });
const src = (path: string, martId = path.split('.').at(-1)!): JoinedSource => ({ aliasPath: path, martId, label: martId, depth: path.split('.').length, fields: [field(path, 'name'), field(path, 'n')], uniqueCount: true });
const col = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;

// main joins a and b; both join c; c joins d (only under a); b also joins x.
const sources = [src('a'), src('b'), src('a.c'), src('b.c'), src('a.c.d'), src('b.x')].sort((p, q) => p.depth - q.depth);

test('builds the tree from the columns in use, children in column order', () => {
  const t = buildJoinTree('main', ['id', col('b'), col('a'), col('a.c')], sources);
  expect(t.nodes.get('')).toMatchObject({ martId: 'main', parent: null, children: ['b', 'a'] });
  expect(t.nodes.get('a')).toMatchObject({ martId: 'a', parent: '', children: ['a.c'] });
  expect(t.nodes.get('a.c')).toMatchObject({ martId: 'c', parent: 'a', children: [] });
});

test('a path whose parent is not in use hangs from the deepest in-use ancestor, else the main mart', () => {
  const t = buildJoinTree('main', ['id', col('a.c.d')], sources);
  expect(t.nodes.get('a.c.d')).toMatchObject({ parent: '' });
  expect(t.nodes.get('')!.children).toEqual(['a.c.d']);
});

test('a mart reached by two in-use paths is placed once: the shallowest, ties to the first in column order', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('b.c'), col('a.c')], sources);
  expect([...t.nodes.values()].filter((n) => n.martId === 'c').map((n) => n.path)).toEqual(['b.c']);
});

test('subtreePaths lists the node and everything under it', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('a.c'), col('a.c.d'), col('b')], sources);
  expect(subtreePaths(t, 'a')).toEqual(['a', 'a.c', 'a.c.d']);
});

test('ghosts are the sources one hop under a path whose mart is not in the report', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(ghostSources(t, sources, '').map((s) => s.aliasPath)).toEqual(['b']);
  expect(ghostSources(t, sources, 'a').map((s) => s.aliasPath)).toEqual(['a.c']);
  expect(ghostSources(t, sources, 'zzz')).toEqual([]);
});

test('rejoin: c under a can move under b; not onto a (its parent), c itself or main (no depth-1 c)', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c')], sources);
  const r = rejoinTargets(t, sources, 'a.c');
  expect(r.map((x) => x.target)).toEqual(['b']);
  expect([...r[0]!.moves]).toEqual([['a.c', 'b.c']]);
});

test('rejoin: the subtree must follow; with a.c.d in use, b is no target because b.c.d does not exist', () => {
  const t = buildJoinTree('main', ['id', col('a'), col('b'), col('a.c'), col('a.c.d')], sources);
  expect(rejoinTargets(t, sources, 'a.c')).toEqual([]);
});

test('rejoin: a node under the dragged one is never a target', () => {
  const s2 = [...sources, src('a.c.b', 'b2')];
  const t = buildJoinTree('main', ['id', col('a'), col('a.c'), col('a.c.b')], s2);
  expect(rejoinTargets(t, s2, 'a').map((x) => x.target)).toEqual([]);
});

test('rejoin: the main mart is a target when the mart has a depth-1 source', () => {
  const s3 = [...sources, src('c')].sort((p, q) => p.depth - q.depth);
  const t = buildJoinTree('main', ['id', col('a'), col('a.c')], s3);
  expect(rejoinTargets(t, s3, 'a.c').map((x) => x.target)).toEqual(['']);
});

test('the main mart cannot be dragged', () => {
  const t = buildJoinTree('main', ['id', col('a')], sources);
  expect(rejoinTargets(t, sources, '')).toEqual([]);
});
```

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/state/join-tree.test.ts`
Expected: FAIL, cannot resolve `./join-tree`.

- [ ] **Step 3: Implement**

```ts
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
    if (moved.includes(t.path)) continue;
    // The path C takes under T: a source of C's mart one hop under T.
    const under = sources.find((s) => s.martId === node.martId && parentPath(s.aliasPath) === t.path);
    if (!under || under.aliasPath === path) continue;
    const moves = new Map<string, string>([[path, under.aliasPath]]);
    let ok = true;
    for (const d of moved.slice(1)) {
      const next = under.aliasPath + d.slice(path.length);
      if (!exists(next, tree.nodes.get(d)!.martId)) { ok = false; break; }
      moves.set(d, next);
    }
    if (ok) out.push({ target: t.path, moves });
  }
  return out;
}
```

Note: a node placed under the main mart because its parent left (the "deepest in-use ancestor" case) still has its full alias path, so `d.slice(path.length)` keeps the right suffix for its own descendants, which share its alias path as a prefix.

- [ ] **Step 4: Run the tests and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/state/join-tree.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/state/join-tree.ts src/state/join-tree.test.ts
git commit -m "Canvas: the report as a tree, its ghosts and the marts a joined mart can move under"
```

---

### Task 2: Add at a path and move paths (`join-plan.ts`)

**Files:**
- Modify: `src/state/join-plan.ts` (append two exported functions at the end)
- Test: `src/state/join-plan.test.ts` (append)

**Interfaces:**
- Consumes: `fieldsFor`, `defaultJoinFields`, `ownNameOf`, `orderColumns`, `sortsOnColumns` (already in or imported by `join-plan.ts`); `JoinedSource`; `GridState`.
- Produces:

```ts
/** The grid with the mart of `aliasPath` added through that exact path. `remembered` are blended names chosen before, `shown` own names it showed when it last left a grid. */
export function planAddAt(grid: GridState, sources: JoinedSource[], aliasPath: string, own: string[], remembered?: string[], shown?: string[] | null): GridState;
/** The grid with every field of an old path swapped for the same own field on its new path. A field the new path lacks is dropped from columns, filters, sorts, aggregations and buckets. */
export function planRejoin(grid: GridState, sources: JoinedSource[], moves: Map<string, string>, own: string[]): GridState;
```

`own` is the main mart's own default columns, used by `orderColumns` and as the fallback when a grid would end with no column (same role as `withoutMart`'s `own`).

- [ ] **Step 1: Write the failing tests** (append to `src/state/join-plan.test.ts`; reuse the `src`/`col` helpers from Task 1 by copying them into this file under new names if the file has its own helpers)

```ts
import { planAddAt, planRejoin } from './join-plan';

const jf = (path: string, own: string) => ({ name: `${path.replaceAll('.', '__')}__${own}`, alias: own, type: 'STRING', category: 'string' as const, description: null, isPrimaryKey: false, joined: { martId: path.split('.').at(-1)!, label: path, aliasPath: path, originalName: own } });
const js = (path: string, owns = ['name', 'n']) => ({ aliasPath: path, martId: path.split('.').at(-1)!, label: path, depth: path.split('.').length, fields: owns.map((o) => jf(path, o)), uniqueCount: true });
const jc = (path: string, own = 'name') => `${path.replaceAll('.', '__')}__${own}`;
const rjSources = [js('a'), js('b'), js('a.c', ['name', 'n', 'only_a']), js('b.c')];
const base = { columns: ['id', jc('a'), jc('b'), jc('a.c'), jc('a.c', 'n'), jc('a.c', 'only_a')], filters: { [jc('a.c')]: { field: jc('a.c'), op: 'eq' as const, value: 'x' }, [jc('a.c', 'only_a')]: { field: jc('a.c', 'only_a'), op: 'eq' as const, value: 'y' } }, sorts: [{ field: jc('a.c', 'n'), direction: 'desc' as const }], limit: 100, aggregations: [{ column: jc('a.c', 'n'), function: 'SUM' as const }] };

test('planAddAt adds the mart through that exact path, with its default fields', () => {
  const g = planAddAt({ ...base, columns: ['id', jc('b')], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c', ['id']);
  // Both fields are text, so the default is the first text field alone.
  expect(g.columns).toContain(jc('b.c'));
  expect(g.columns).not.toContain(jc('b.c', 'n'));
  expect(g.columns.filter((c) => c.startsWith('a__c'))).toEqual([]);
});

test('planAddAt keeps remembered fields offered by the path', () => {
  const g = planAddAt({ ...base, columns: ['id'], filters: {}, sorts: null, aggregations: undefined }, rjSources, 'b.c', ['id'], [jc('b.c', 'n')]);
  expect(g.columns).toEqual(['id', jc('b.c', 'n')]);
});

test('planRejoin swaps columns, filters, sorts and aggregations to the new path and drops what it lacks', () => {
  const g = planRejoin(base, rjSources, new Map([['a.c', 'b.c']]), ['id']);
  expect(g.columns).toEqual(['id', jc('a'), jc('b'), jc('b.c'), jc('b.c', 'n')]);
  expect(Object.keys(g.filters)).toEqual([jc('b.c')]);
  expect(g.filters[jc('b.c')]).toEqual({ field: jc('b.c'), op: 'eq', value: 'x' });
  expect(g.sorts).toEqual([{ field: jc('b.c', 'n'), direction: 'desc' }]);
  expect(g.aggregations).toEqual([{ column: jc('b.c', 'n'), function: 'SUM' }]);
});

test('planRejoin with no moves returns the grid unchanged', () => {
  expect(planRejoin(base, rjSources, new Map(), ['id'])).toEqual(base);
});
```

If `AggFn` does not include `'SUM'`, use whatever value `src/model/aggregation.ts` defines for a sum.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/state/join-plan.test.ts`
Expected: FAIL, `planAddAt` is not exported.

- [ ] **Step 3: Implement** (append to `src/state/join-plan.ts`)

```ts
/** The grid with the mart of `aliasPath` added through that exact path. */
export function planAddAt(grid: GridState, sources: JoinedSource[], aliasPath: string, own: string[], remembered?: string[], shown: string[] | null = null): GridState {
  const source = sources.find((s) => s.aliasPath === aliasPath);
  if (!source) return grid;
  const names = new Set(source.fields.map((f) => f.name));
  let picked: string[] = [];
  if (shown) {
    const byOwn = new Map(source.fields.map((f) => [ownNameOf(f), f.name] as const));
    picked = shown.flatMap((n) => (byOwn.has(n) ? [byOwn.get(n)!] : []));
  }
  if (!picked.length) picked = (remembered ?? []).filter((n) => names.has(n));
  if (!picked.length) picked = defaultJoinFields(source).map((f) => f.name);
  const columns = orderColumns([...grid.columns, ...picked.filter((n) => !grid.columns.includes(n))], sources, own);
  return { ...grid, columns };
}

/** The grid with every field of a moved path swapped for the same own field on its new path; a field the new path lacks is dropped. */
export function planRejoin(grid: GridState, sources: JoinedSource[], moves: Map<string, string>, own: string[]): GridState {
  if (moves.size === 0) return grid;
  const byPath = new Map(sources.map((s) => [s.aliasPath, s] as const));
  const swap = new Map<string, string | null>();
  for (const [from, to] of moves) {
    const target = byPath.get(to);
    const byOwn = new Map((target?.fields ?? []).map((f) => [ownNameOf(f), f.name] as const));
    for (const f of byPath.get(from)?.fields ?? []) swap.set(f.name, byOwn.get(ownNameOf(f)) ?? null);
  }
  const map = (n: string) => (swap.has(n) ? swap.get(n)! : n);
  let columns = [...new Set(grid.columns.flatMap((c) => { const m = map(c); return m ? [m] : []; }))];
  if (columns.length === 0) columns = own;
  const filters = Object.fromEntries(Object.entries(grid.filters).flatMap(([k, f]) => { const m = map(k); return m ? [[m, { ...f, field: m }]] : []; }));
  const sorts = grid.sorts && grid.sorts.flatMap((s) => { const m = map(s.field); return m ? [{ ...s, field: m }] : []; });
  const aggregations = grid.aggregations?.flatMap((a) => { const m = map(a.column); return m ? [{ ...a, column: m }] : []; });
  const dateTrunc = grid.dateTrunc?.flatMap((d) => { const m = map(d.column); return m ? [{ ...d, column: m }] : []; });
  return {
    ...grid,
    columns,
    filters,
    sorts: grid.sorts && grid.sorts.length > 0 && sorts!.length === 0 ? null : sorts,
    aggregations: aggregations?.length ? aggregations : undefined,
    dateTrunc: dateTrunc?.length ? dateTrunc : undefined,
  };
}
```

Column order is kept as it was: `planRejoin` maps in place and does not call `orderColumns`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/state/join-plan.test.ts`
Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit**

```bash
git add src/state/join-plan.ts src/state/join-plan.test.ts
git commit -m "Canvas: add a mart through a chosen path, move a mart's fields to a new path"
```

---

### Task 3: Canvas layout (`canvas-layout.ts`)

**Files:**
- Create: `src/ui/bands/canvas-layout.ts`
- Test: `src/ui/bands/canvas-layout.test.ts`

**Interfaces:**
- Consumes: `JoinTree` from Task 1.
- Produces:

```ts
export const CARD_W = 224; // 14rem, the grid's minimum card width
export const CARD_H = 112;
export const COL_GAP = 96;
export const ROW_GAP = 16;
export type Placed = { path: string; x: number; y: number };
/** Positions for every node, plus `extra` children per path (the ghosts) placed in the next column after the real ones. */
export function layoutTree(tree: JoinTree, extra?: { path: string; ids: string[] }): { placed: Placed[]; ghosts: { id: string; x: number; y: number }[]; width: number; height: number };
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/bands/canvas-layout.test.ts
import { expect, test } from 'vitest';
import type { JoinTree, TreeNode } from '../../state/join-tree';
import { CARD_H, CARD_W, COL_GAP, ROW_GAP, layoutTree } from './canvas-layout';

const tree = (entries: [string, string | null, string[]][]): JoinTree => ({ nodes: new Map(entries.map(([path, parent, children]) => [path, { path, martId: path || 'main', parent, children } as TreeNode])) });
const at = (r: ReturnType<typeof layoutTree>, p: string) => r.placed.find((x) => x.path === p)!;

test('the column is the depth in the tree', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', ['a.c']], ['a.c', 'a', []]]));
  expect([at(r, '').x, at(r, 'a').x, at(r, 'a.c').x]).toEqual([0, CARD_W + COL_GAP, 2 * (CARD_W + COL_GAP)]);
});

test('leaves stack and a parent is centred on its children', () => {
  const r = layoutTree(tree([['', null, ['a', 'b']], ['a', '', []], ['b', '', []]]));
  expect(at(r, 'a').y).toBe(0);
  expect(at(r, 'b').y).toBe(CARD_H + ROW_GAP);
  expect(at(r, '').y).toBe((CARD_H + ROW_GAP) / 2);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
  expect(r.width).toBe(2 * CARD_W + COL_GAP);
});

test('a lone main mart sits at the origin', () => {
  const r = layoutTree(tree([['', null, []]]));
  expect(r.placed).toEqual([{ path: '', x: 0, y: 0 }]);
  expect([r.width, r.height]).toEqual([CARD_W, CARD_H]);
});

test('ghosts take the next column after their parent, stacked from the parent row', () => {
  const r = layoutTree(tree([['', null, ['a']], ['a', '', []]]), { path: 'a', ids: ['g1', 'g2'] });
  expect(r.ghosts).toEqual([
    { id: 'g1', x: 2 * (CARD_W + COL_GAP), y: 0 },
    { id: 'g2', x: 2 * (CARD_W + COL_GAP), y: CARD_H + ROW_GAP },
  ]);
  expect(r.width).toBe(3 * CARD_W + 2 * COL_GAP);
  expect(r.height).toBe(2 * CARD_H + ROW_GAP);
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands/canvas-layout.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/ui/bands/canvas-layout.ts
// Where each card of the canvas goes: the column is the depth in the tree, leaves stack, a parent is centred on its children.
import type { JoinTree } from '../../state/join-tree';

export const CARD_W = 224;
export const CARD_H = 112;
export const COL_GAP = 96;
export const ROW_GAP = 16;
export type Placed = { path: string; x: number; y: number };

const colX = (depth: number) => depth * (CARD_W + COL_GAP);
const rowY = (row: number) => row * (CARD_H + ROW_GAP);

export function layoutTree(tree: JoinTree, extra?: { path: string; ids: string[] }) {
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
```

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands/canvas-layout.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/ui/bands/canvas-layout.ts src/ui/bands/canvas-layout.test.ts
git commit -m "Canvas: lay the report tree out in columns by depth"
```

---

### Task 4: The Grid / Canvas switch and its saved choice

**Files:**
- Modify: `src/ui/bands/ViewSwitch.tsx` (options and label as props)
- Modify: `src/ui/bands/DataBand.tsx:44` (pass Table / Charts options)
- Modify: `src/api/preferences.ts` (two methods)
- Modify: `src/api/preferences.test.ts` (append)
- Modify: `src/ui/bands/CardBands.tsx` (switch in the Data Marts header; `view` state; body placeholder for Canvas until Task 5)
- Modify: `src/ui/bands/view-switch.test.tsx` (update to the new props)
- Test: `src/ui/bands/marts-view.test.tsx` (new)

**Interfaces:**
- Produces:

```ts
// ViewSwitch.tsx
export type SwitchOption<T extends string> = { value: T; label: string; icon: LucideIcon };
export function ViewSwitch<T extends string>(props: { label: string; options: SwitchOption<T>[]; value: T; onChange: (v: T) => void }): JSX.Element;
// preferences.ts (added to the Preferences interface)
loadMartsView(): Promise<'grid' | 'canvas'>;
saveMartsView(view: 'grid' | 'canvas'): void;
// CardBands.tsx
export type MartsView = 'grid' | 'canvas';
```

- [ ] **Step 1: Write the failing tests**

Append to `src/api/preferences.test.ts`, following the file's existing `stubCtx`/mock-ctx pattern for the round trip:

```ts
test('the Data Marts view round-trips through its own document, and an unknown value reads as grid', async () => {
  const ctx = createMockCtx(demoFixtures()); // use whatever ctx the first test in this file uses
  const p = createPreferences(ctx);
  expect(await p.loadMartsView()).toBe('grid');
  p.saveMartsView('canvas');
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
  // A fold write must not wipe it.
  p.saveFolded({ 'band-data': true });
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadFolded()).toEqual({ 'band-data': true }));
  expect(await createPreferences(ctx).loadMartsView()).toBe('canvas');
  const odd = { ...stubCtx(), collections: () => ({ get: async () => ({ document: { view: 'map' } }), put: async () => {} }) } as unknown as Ctx;
  expect(await createPreferences(odd).loadMartsView()).toBe('grid');
});
```

New `src/ui/bands/marts-view.test.tsx`, rendering the app as `src/ui/bands/joined-marts.test.tsx` does (copy its `renderApp` helper and imports):

```tsx
test('the Data Marts band opens in Grid, switches to Canvas, and saves the choice', async () => {
  const ctx = createMockCtx(demoFixtures());
  renderApp(ctx);
  const band = await screen.findByRole('region', { name: /Data Marts/ }); // or document.querySelector('#band-marts'), as the helper file does
  const group = within(band).getByRole('radiogroup', { name: 'Show data marts as' });
  expect(within(group).getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(within(group).getByRole('radio', { name: 'Canvas' }));
  expect(within(group).getByRole('radio', { name: 'Canvas' })).toHaveAttribute('aria-checked', 'true');
  await vi.waitFor(async () => expect(await createPreferences(ctx).loadMartsView()).toBe('canvas'));
});
```

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/api/preferences.test.ts src/ui/bands/marts-view.test.tsx`
Expected: FAIL, `loadMartsView` is not a function; no radiogroup named "Show data marts as".

- [ ] **Step 3: Implement**

`ViewSwitch.tsx`: replace the module-level `Mode` and `OPTIONS` with the props above. Keep the roving tabindex, arrow keys and `stopPropagation` exactly as now; use `label` for `aria-label`. `import type { LucideIcon } from 'lucide-react'`.

`DataBand.tsx`: define at module level

```ts
const DATA_VIEWS: SwitchOption<'table' | 'charts'>[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'charts', label: 'Charts', icon: ChartColumn },
];
```

and render `<ViewSwitch label="Show data as" options={DATA_VIEWS} value={...} onChange={setView} />`. Update `view-switch.test.tsx` to pass these props.

`preferences.ts`:

```ts
const VIEW_DOC_ID = 'marts-view';
type ViewDoc = { view?: unknown };
// in the object returned by createPreferences:
async loadMartsView() {
  try {
    const v = (await ctx.collections<ViewDoc>(PREFERENCES_COLLECTION).get(VIEW_DOC_ID))?.document?.view;
    return v === 'canvas' ? 'canvas' : 'grid';
  } catch (e) {
    console.warn('Reading the Data Marts view failed', e);
    return 'grid';
  }
},
saveMartsView(view) {
  Promise.resolve()
    .then(() => ctx.collections<ViewDoc>(PREFERENCES_COLLECTION).put(VIEW_DOC_ID, { view }))
    .catch((e) => console.warn('Saving the Data Marts view failed', e));
},
```

Add both to the `Preferences` interface with one-line doc comments. Any test stub that builds a `Preferences` by hand gets the two methods (`loadMartsView: async () => 'grid'`, `saveMartsView: () => {}`); find them with `grep -rn "loadFolded" src`.

`CardBands.tsx`:
1. `const { preferences } = useServices();` and `const [view, setView] = useState<MartsView>('grid');`
2. `useEffect(() => { let live = true; preferences.loadMartsView().then((v) => { if (live) setView((cur) => (touched.current ? cur : v)); }); return () => { live = false; }; }, [preferences]);` with `const touched = useRef(false)` set true on a user change, so a slow read never overrides a click.
3. `const pickView = (v: MartsView) => { touched.current = true; setView(v); preferences.saveMartsView(v); };`
4. Module-level `const MARTS_VIEWS: SwitchOption<MartsView>[] = [{ value: 'grid', label: 'Grid', icon: LayoutGrid }, { value: 'canvas', label: 'Canvas', icon: Workflow }];`
5. In the Data Marts `Band`, `afterHint={<>{contextBadges}<ViewSwitch label="Show data marts as" options={MARTS_VIEWS} value={view} onChange={pickView} /></>}`. Pass `toolbar={view === 'grid' ? storageFilter : undefined}` and `grid={view === 'grid'}`.
6. When `view === 'canvas'`, the band's children are `<div data-testid="marts-canvas" />` for now (Task 5 replaces it). The grid children render only for `'grid'`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/api/preferences.test.ts src/ui/bands/marts-view.test.tsx src/ui/bands/view-switch.test.tsx src/ui/bands`
Expected: PASS, and the other band tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/bands/ViewSwitch.tsx src/ui/bands/DataBand.tsx src/api/preferences.ts src/api/preferences.test.ts src/ui/bands/CardBands.tsx src/ui/bands/view-switch.test.tsx src/ui/bands/marts-view.test.tsx
git commit -m "Data Marts band: a Grid / Canvas switch, remembered per member"
```

---

### Task 5: The canvas: tree, wires, ghosts and adding a mart

**Files:**
- Create: `src/ui/bands/MartsCanvas.tsx`
- Modify: `src/ui/bands/CardBands.tsx` (render `MartsCanvas` for `view === 'canvas'`; pass it what it needs)
- Modify: `src/ui/bands/useCardClick.ts` (an `addAt` option)
- Modify: `src/ui/App.tsx` (pass `joinSources` and `mainColumns` down to `CardBands`)
- Modify: `src/ui/bands/bands.css` (canvas styles)
- Modify: `src/ui/bands/wires.ts` (a layer id parameter)
- Test: `src/ui/bands/marts-canvas.test.tsx`

**Interfaces:**
- Consumes: `buildJoinTree`, `ghostSources` (Task 1); `planAddAt` (Task 2); `layoutTree`, `CARD_W`, `CARD_H` (Task 3); `MartsView` (Task 4); `useWires`, `Wire` from `wires.ts`; `MartCard`, `martElementId` from `cards.tsx`.
- Produces:

```ts
// useCardClick.ts
export type ClickOptions = { only?: 'deselect'; mode?: 'makeMain'; /** Add the mart through this alias path (a canvas ghost). */ addAt?: string; /** Move marts to new alias paths (a canvas drop). */ moves?: Map<string, string> };
// MartsCanvas.tsx
export function MartsCanvas(props: {
  model: Model;
  mainId: string | null;
  columns: string[];
  sources: JoinedSource[] | null;
  counts: Map<string, CountState>;
  dq: Map<string, DqSummary>;
  onOpenApp: (id: string) => void;
  onRetryCount: (id: string) => void;
  onRequestCount: (id: string) => void;
  click: (id: string, options?: ClickOptions) => Promise<void>;
}): JSX.Element;
```

`moves` is declared here and handled in Task 6.

- [ ] **Step 1: Write the failing tests**

`src/ui/bands/marts-canvas.test.tsx`, rendering the app as `joined-marts.test.tsx` does with the demo fixtures (main mart `orders`). Switch to Canvas first through the radio.

```tsx
test('canvas shows the main mart and its joined marts as a tree', async () => {
  // Arrange: join customers in Grid (click its card), then switch to Canvas.
  // Assert: #band-marts contains article#dm-orders and article#dm-customers; no article for products (not in the report).
  // Assert: dm-customers' style.left is greater than dm-orders' style.left (it sits to the right).
});

test('hovering a card shows its ghosts; clicking a ghost adds that mart through that path', async () => {
  // Arrange: Canvas with only orders.
  // Act: userEvent.hover(article#dm-orders).
  // Assert: ghost articles ([data-ghost]) for customers, products and stores appear.
  // Act: userEvent.click(the customers ghost).
  // Assert: article#dm-customers now renders without data-ghost; the Data band grid has a column header from customers (as joined-marts.test.tsx checks headers).
});

test('clicking a card pins its ghosts; Escape lets them go', async () => {
  // Act: click article#dm-orders (no drag).
  // Assert: the main mart stays selected (no deselect), ghosts show and stay after userEvent.unhover.
  // Act: keyboard Escape. Assert: no [data-ghost] remains.
});

test('with joined sources not loaded, the canvas shows the main card alone', async () => {
  // Render MartsCanvas directly with sources={null}: one article, no ghosts, no throw on hover.
});
```

Write each test fully with `screen`, `within`, `userEvent` and `vi.waitFor`, in the style of `joined-marts.test.tsx`. The comments above say exactly what each must arrange and assert.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands/marts-canvas.test.tsx`
Expected: FAIL, no `article#dm-orders` inside the canvas.

- [ ] **Step 3: Implement**

`useCardClick.ts`: in `run`, after the loads and before `planClick`, handle the two new options. Both need `main`, its sources and its grid, which `load(main)` already reads:

```ts
if ((options?.addAt || options?.moves) && main) {
  const sourcesNow = sources.get(main) ?? [];
  const g = fresh(main) ?? { columns: [], filters: {}, sorts: null, limit: PAGE_SIZE };
  const own = defaultColumns(schemas.peek(main) ?? []);
  const next = options.addAt
    ? planAddAt(g, sourcesNow, options.addAt, own, picks.get(main)?.[sourcesNow.find((s) => s.aliasPath === options.addAt)?.martId ?? ''], columnStore.lastShown(id))
    : planRejoin(g, sourcesNow, options.moves!, own);
  if (next === g) { await rendered(); return; }
  dispatch({ type: 'setMarts', selection: now.selection, grids: { [main]: next } });
  columnStore.save(main, next.columns);
  await rendered();
  return;
}
```

(`fresh`, `now` and `PAGE_SIZE` are already in scope at that point; put the block right after `const fresh = ...`. Import `planAddAt` and `planRejoin` from `../../state/join-plan`.)

`App.tsx`: pass `joinSources={joinSources}` and `mainColumns={mainColumns ?? []}` to `CardBands`; add both props to `CardBands`.

`MartsCanvas.tsx`:
1. `const tree = useMemo(() => buildJoinTree(mainId, columns, sources ?? []), ...)` when `mainId`; with no `mainId` render the band's "Select a data mart." text.
2. Hover and pin state: `hovered: string | null` (a path), `pinned: string | null` (a path). `ghostOf = pinned ?? hoveredWithGrace`. Copy the grid's 400 ms grace from `CardBands.tsx` (the `ghostOf` effect): leaving a card keeps its ghosts for 400 ms; hovering a ghost keeps them.
3. `const ghosts = ghostOf !== null && sources ? ghostSources(tree, sources, ghostOf) : []`.
4. `const layout = layoutTree(tree, ghostOf !== null ? { path: ghostOf, ids: ghosts.map((g) => g.aliasPath) } : undefined)`.
5. Render a `div.dm-tree` with `ref={canvasRef}`, `style={{ width: layout.width, height: layout.height }}`, `position: relative`. For each placed node, a `MartCard` wrapped in `div.dm-tree-node` with `style={{ left: x, top: y, width: CARD_W }}`. Props: `selected={path === ''}`, `joined={path !== ''}`, `lit={false}`, `count`, `quality`, `freshness`, `contexts` exactly as `CardBands` passes them; `onSelect={() => setPinned(path)}`; no `onMakeMain`. For each ghost, a `MartCard` with `ghost`, `onSelect={() => { setPinned(null); void click(ghost.martId, { addAt: ghost.aliasPath }); }}`.
6. Wires (layer `#tree-wires`, see below): memoised `Wire[]`, one `{ id: 'tree:' + path, from: martElementId(parentMart), to: martElementId(mart), kind: 'relationship', title: parentTitle + ' → ' + title }` per non-root node, plus one per ghost from the `ghostOf` card. `key` joins every path and ghost path. Import `revisionOf` from where `CardBands` gets it.
7. Pointer: `onPointerOver` on the root sets `hovered` from the nearest `[data-tree-path]` (put `data-tree-path={path}` on each node wrapper and `data-ghost-path` on ghost wrappers); `onPointerLeave` clears it. A click on the empty canvas (target is the root) clears `pinned`. Escape (document `keydown`) clears `pinned` and `hovered`.
8. Element ids: a mart is in the tree once, so `martElementId(martId)` stays unique. The canvas replaces the grid body, so the grid's cards are not mounted at the same time.

`bands.css` (append):

```css
/* The Data Marts canvas: the report as a tree, cards placed by canvas-layout.ts. */
.dm-tree-scroll { overflow: auto; padding: 0.25rem; }
.dm-tree { position: relative; }
.dm-tree-node { position: absolute; }
.dm-tree-node > .dm-node { width: 100%; }
.dm-tree-node.dm-dimmed { opacity: 0.15; filter: grayscale(1); transition: opacity 120ms; }
#drag-line { position: absolute; inset: 0; pointer-events: none; overflow: visible; z-index: 2; }
#drag-line path { fill: none; stroke: var(--muted-foreground); stroke-width: 1.5; stroke-dasharray: 6 4; }
```

`wires.ts`: give `useWires` a fifth parameter, `layerId = 'wires'`, and pass it to `ensureLayer`, which looks for `canvas.querySelector(':scope > #' + layerId)` and creates the SVG with that id. The page keeps `#wires`; the canvas uses `#tree-wires`. In `bands.css`, extend every `#wires` selector to `#wires, #tree-wires` (for example `#wires path, #tree-wires path`).

`CardBands.tsx`:
1. For `view === 'canvas'`, the band's children are `<div className="dm-tree-scroll"><MartsCanvas ... click={click} /></div>`.
2. While the view is Canvas, the page-level `wires` memo keeps only `kind: 'source'` wires, so the grid's relationship lines are not drawn between canvas cards. Add `view` to that memo's dependencies.
3. The grid's ghost, hover-ghost and `useCardDrag` code stays as is; with no grid cards mounted it finds nothing to do.

`MartsCanvas.tsx` calls `useWires(treeRef, wires, { pinned: null, hovered: null }, revisionOf(key), 'tree-wires')`.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands src/state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/bands/MartsCanvas.tsx src/ui/bands/CardBands.tsx src/ui/bands/useCardClick.ts src/ui/App.tsx src/ui/bands/bands.css src/ui/bands/wires.ts src/ui/bands/marts-canvas.test.tsx
git commit -m "Data Marts canvas: the report as a tree, ghosts on hover and click, add a mart through a ghost"
```

---

### Task 6: Drag a joined mart under another one

**Files:**
- Create: `src/ui/bands/useCanvasDrag.ts`
- Create: `src/ui/bands/canvas-drag.ts` (pure: closest target)
- Modify: `src/ui/bands/MartsCanvas.tsx`
- Test: `src/ui/bands/canvas-drag.test.ts`, `src/ui/bands/marts-canvas.test.tsx` (append)

**Interfaces:**
- Consumes: `rejoinTargets`, `Rejoin` (Task 1); `ClickOptions.moves` (Task 5); `Placed`, `CARD_W`, `CARD_H` (Task 3).
- Produces:

```ts
// canvas-drag.ts
/** The target whose card centre is closest to the point (canvas coordinates); null with no targets. */
export function closestTarget(targets: Rejoin[], placed: Placed[], x: number, y: number): Rejoin | null;
// useCanvasDrag.ts
export type CanvasDrag = { path: string; x: number; y: number }; // pointer in canvas coordinates
export function useCanvasDrag(root: RefObject<HTMLElement | null>, canDrag: (path: string) => boolean, onDrop: (path: string, x: number, y: number) => void): CanvasDrag | null;
```

- [ ] **Step 1: Write the failing tests**

```ts
// src/ui/bands/canvas-drag.test.ts
import { expect, test } from 'vitest';
import { CARD_H, CARD_W } from './canvas-layout';
import { closestTarget } from './canvas-drag';

const t = (target: string) => ({ target, moves: new Map([['a.c', `${target}.c`]]) });
const placed = [{ path: 'a', x: 0, y: 0 }, { path: 'b', x: 0, y: 300 }, { path: '', x: -400, y: 150 }];

test('picks the target whose centre is closest', () => {
  expect(closestTarget([t('a'), t('b')], placed, CARD_W / 2, 280)!.target).toBe('b');
  expect(closestTarget([t('a'), t('b')], placed, CARD_W / 2, CARD_H / 2)!.target).toBe('a');
});

test('no targets, no pick', () => {
  expect(closestTarget([], placed, 0, 0)).toBeNull();
});

test('a target with no placed card is ignored', () => {
  expect(closestTarget([t('zzz')], placed, 0, 0)).toBeNull();
});
```

Append to `marts-canvas.test.tsx` (demo fixtures: main `orders`; `customers` and `stores` both join `countries`):

```tsx
test('dragging countries from customers onto stores moves its columns to the stores path', async () => {
  // Arrange (Grid): join customers, stores, then countries (it joins through customers.countries). Switch to Canvas.
  // Act: fireEvent.pointerDown on the countries card at its centre, pointerMove 40px away (past 5px),
  //      then pointerMove to the stores card centre.
  // Assert: during the drag, the products card is not in the report so is absent; the orders card wrapper has class dm-dimmed
  //      (orders has no depth-1 countries source); the stores wrapper has no dm-dimmed; svg#drag-line contains one path.
  //      No card wrapper got a new border class: the stores article's className is unchanged from before the drag.
  // Act: pointerUp at the stores centre.
  // Assert: the Data band's column headers include the stores-path countries field (name `stores__countries__<field>`)
  //      and none of `customers__countries__*`; in the canvas, countries now sits under stores (its wire is from dm-stores).
  // Act: click Undo (HistoryButtons). Assert: the customers-path columns are back.
});

test('Escape or a release away from any target changes nothing, and the next click still works', async () => {
  // Drag countries 40px, press Escape: no column change. Drag again and release over empty canvas far from every card:
  // the closest-target rule still picks one, so instead release outside the band (document.body): no change.
  // Then click the orders card: its ghosts pin (the click was not swallowed by a stale drag).
});
```

Write both fully with `fireEvent.pointerDown/pointerMove/pointerUp` (`{ clientX, clientY, button: 0, buttons: 1, pointerId: 1 }`). jsdom has no layout: stub `getBoundingClientRect` on the canvas root to `{ left: 0, top: 0 }` and compute card centres from their `style.left`/`style.top` plus `CARD_W / 2`, `CARD_H / 2`.

- [ ] **Step 2: Run and see them fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands/canvas-drag.test.ts src/ui/bands/marts-canvas.test.tsx`
Expected: FAIL, `closestTarget` not found; no `#drag-line`.

- [ ] **Step 3: Implement**

`canvas-drag.ts`:

```ts
import type { Rejoin } from '../../state/join-tree';
import { CARD_H, CARD_W, type Placed } from './canvas-layout';

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
```

`useCanvasDrag.ts`: model it on `useCardDrag.ts` (same 5 px start, same swallowed click after a drag, same Escape handling, same `pointercancel` and lost-button handling). Differences:
1. The press reads `[data-tree-path]` from the target, ignores `''` and anything `canDrag` refuses, and ignores presses on `button, a, input, [data-ghost]`.
2. Positions are canvas coordinates: `x = e.clientX - root.getBoundingClientRect().left + root.scrollLeft`, same for `y` with top and `scrollTop`. Use the `.dm-tree` element as `root`.
3. On release after a drag, call `onDrop(path, x, y)` whether or not the pointer is over a card; the caller decides the target. A release outside the root (`!root.contains(e.target)`) cancels instead.

`MartsCanvas.tsx`:
1. `const drag = useCanvasDrag(treeRef, (p) => p !== '', (path, x, y) => { const pick = closestTarget(rejoinTargets(tree, sources ?? [], path), layout.placed, x, y); if (pick) void click(tree.nodes.get(path)!.martId, { moves: pick.moves }); });`
2. While `drag` is set: `targets = rejoinTargets(tree, sources ?? [], drag.path)`; `valid = new Set(targets.map((t) => t.target))`; every node wrapper whose path is not `drag.path` and not in `valid` gets class `dm-dimmed`. Ghosts are hidden during a drag (set `ghostOf` to null).
3. `const pick = drag && closestTarget(targets, layout.placed, drag.x, drag.y)`. When `pick`, render inside `.dm-tree` an `<svg id="drag-line" aria-hidden>` with one dashed `path` from the dragged card's right edge centre to the target card's left edge centre (or right edge when the target is to the right of the pointer... keep it simple: from `(drag.x, drag.y)` to the target card's nearest vertical edge centre), drawn as a cubic like `curve()` in `wires.ts`.
4. Keep the existing `.dm-drag-ghost` title chip following the pointer (fixed position, client coordinates), as `CardBands` does.
5. No other class or style changes on any card.

- [ ] **Step 4: Run and see them pass**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/bands src/state`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/ui/bands/useCanvasDrag.ts src/ui/bands/canvas-drag.ts src/ui/bands/canvas-drag.test.ts src/ui/bands/MartsCanvas.tsx src/ui/bands/marts-canvas.test.tsx
git commit -m "Data Marts canvas: drag a joined mart under another one, a dashed line to the closest that can take it"
```

---

### Task 7: End-to-end check and README

**Files:**
- Create: `e2e/marts-canvas.spec.ts`
- Modify: `README.md` (the section that describes the Data Marts band: one paragraph on Canvas)

**Interfaces:**
- Consumes: everything above. Element ids `#band-marts`, `article#dm-<id>`, radio "Canvas" in group "Show data marts as", `svg#drag-line`.

- [ ] **Step 1: Write the spec**

```ts
// e2e/marts-canvas.spec.ts
import { expect, test } from '@playwright/test';

test('canvas: add a mart through a ghost, move countries from customers to stores, undo', async ({ page }) => {
  await page.goto('/?mock');
  const marts = page.locator('#band-marts');
  await marts.getByRole('radio', { name: 'Canvas' }).click();
  await expect(marts.locator('article#dm-orders')).toBeVisible();

  // Add customers and stores through the main card's ghosts.
  await marts.locator('article#dm-orders').hover();
  await marts.locator('article[data-ghost]#dm-customers').click();
  await marts.locator('article#dm-orders').hover();
  await marts.locator('article[data-ghost]#dm-stores').click();
  // countries through customers.
  await marts.locator('article#dm-customers').hover();
  await marts.locator('article[data-ghost]#dm-countries').click();
  const headers = page.locator('#band-data [role="columnheader"]');
  await expect(headers.filter({ hasText: /countries/i }).first()).toBeVisible();

  // Drag countries onto stores: a dashed line shows while dragging.
  const from = await marts.locator('article#dm-countries').boundingBox();
  const to = await marts.locator('article#dm-stores').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + 60, from!.y + 60, { steps: 4 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 6 });
  await expect(marts.locator('svg#drag-line path')).toHaveCount(1);
  await page.mouse.up();
  await expect(marts.locator('svg#drag-line')).toHaveCount(0);

  // Countries now hangs from stores: its tree wire comes from dm-stores.
  await expect(page.locator('#tree-wires path[data-from="dm-stores"][data-to="dm-countries"]')).toHaveCount(1);

  await page.getByRole('button', { name: /undo|back/i }).first().click();
  await expect(page.locator('#tree-wires path[data-from="dm-customers"][data-to="dm-countries"]')).toHaveCount(1);
});

test('the view choice survives a reload', async ({ page }) => {
  await page.goto('/?mock');
  await page.locator('#band-marts').getByRole('radio', { name: 'Canvas' }).click();
  await page.reload();
  await expect(page.locator('#band-marts').getByRole('radio', { name: 'Canvas' })).toHaveAttribute('aria-checked', 'true');
});
```

Adjust the Undo button's accessible name to what `HistoryButtons` renders, and the reload test to whether the mock ctx keeps collections across a reload (check `src/sdk/mock/ctx.ts`; if it does not persist, drop the second test and say so in the commit message).

- [ ] **Step 2: Run it**

Run: `npm run e2e -- e2e/marts-canvas.spec.ts`
Expected: PASS. Fix the app code, not the spec, when behaviour differs from the spec doc.

- [ ] **Step 3: README**

Add to the README section on the Data Marts band:

```markdown
The Data Marts band has two views. Grid lists the data marts as cards. Canvas draws the report as a tree: the main data mart on the left, each joined data mart to the right of the mart it joins through. Hover a card, or click it, to see the data marts that can join it as dimmed cards, and click one to add it. Drag a joined data mart to move it under another one: marts it cannot join are dimmed, and a dashed line points at the closest one that can take it. The band reopens in the view you picked last.
```

- [ ] **Step 4: Full checks**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 && npm run lint && npx tsc -b`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add e2e/marts-canvas.spec.ts README.md
git commit -m "Data Marts canvas: end-to-end check and README"
```
