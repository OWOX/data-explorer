# Joins per path, delete with ×, click shows joinable marts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** A joined data mart is tracked by its alias path, so one mart can be in the report more than once; both views get a × to remove a joined mart and its subtree; a click on a report card never removes, it shows what can join under it.

**Architecture:** Pure helpers first (`join-plan.ts`, `join-tree.ts`), then card ids and the × in `cards.tsx` with a `removePaths` click option, then the canvas, then the Grid band, then the Data band's column groups, then end-to-end checks.

**Tech Stack:** React 19, TypeScript, Vite, Vitest + Testing Library (jsdom), Playwright, plain CSS in `src/ui/bands/bands.css`.

**Spec:** `docs/superpowers/specs/2026-11-19-marts-canvas-view-design.md`, section "Revision 1". It wins over earlier sections.

## Global Constraints

1. No new runtime dependency.
2. Vitest: `npx vitest run --maxWorkers=4 <files>`, never unbounded. `npm run lint` fails at baseline for unrelated reasons; use `npx tsc -b`.
3. Every grid change from a card (add, move, remove) is one `setMarts` dispatch, so Undo covers it.
4. Element ids: `dm-<martId>` for the main card and marts not in the report; `dm-<martId>@<aliasPath>` for a joined card. Selectors over these ids use `CSS.escape`.
5. A click never removes a mart in either view. The × (a circled x, top-left corner, shown on hover and on keyboard focus within the card) is the only remove action on a card. The main card has no ×.
6. Other people commit to this branch and leave uncommitted files (src/datamart/*, ExportMenu*, README hunks). Stage only your own files by path.
7. Comments and copy: plain sentences, no em dashes.

## Review Focus

1. A mart in the report twice: removing one copy with × leaves the other copy's columns, filters and sorts intact.
2. Removing a path whose subtree holds the only copy of a mart: the subtree's columns go too, and Undo restores all of them in one step.
3. Grid regressions: wires, hover ghosts and drag-to-main in Grid still work for marts not in the report and for the main card.
4. Ids with dots and `@` in `querySelector` (`CSS.escape`) in every lookup, including `useCardDrag` and `wires.ts`.
5. The Data band's column groups when two paths of one mart sit next to each other.

---

### Task 1: Pure helpers for paths

**Files:** `src/state/join-plan.ts`, `src/state/join-plan.test.ts`, `src/state/join-tree.ts`, `src/state/join-tree.test.ts`

**Produces:**

```ts
// join-plan.ts
/** The alias paths a grid's columns use, in the order their first column appears. */
export function joinedPaths(columns: string[], sources: JoinedSource[]): string[];
/** The grid with every field of these exact alias paths taken out: columns, filters, sorts, aggregations, buckets. A grid left with no column gets `own`. */
export function withoutPaths(grid: GridState, sources: JoinedSource[], paths: string[], own: string[]): GridState;
```

Changes in `join-tree.ts`:
1. `buildJoinTree`: every in-use path is a node, even when another path of the same mart is in use. Drop the one-path-per-mart rule. Replace the old tie-break test with: columns of both `a.c` and `b.c` give two nodes with martId `c`.
2. `ghostSources(tree, sources, path)`: exclude a source when its alias path is already a node, not when its mart is in the report. Dedupe by alias path.
3. `rejoinTargets`: a candidate is invalid when C's new path, or any rewritten subtree path, is already a node outside C's subtree.

Tests (write first): `joinedPaths` order and dedupe; `withoutPaths` removing `a.c` keeps `b.c`'s columns, filters and sorts when both are in use, drops filters/sorts/aggregations/dateTrunc of the removed paths, falls back to `own`; the three `join-tree` changes above, each with a case.

Commit: `Joins per path: joinedPaths, withoutPaths, a tree node per path in use`

### Task 2: Card ids, the × and the remove option

**Files:** `src/ui/bands/cards.tsx`, `src/ui/bands/useCardClick.ts`, `src/ui/bands/bands.css`, tests next to them (new `src/ui/bands/card-remove.test.tsx`).

**Produces:**

```ts
// cards.tsx
export const martElementId = (martId: string, path?: string) => (path ? `dm-${martId}@${path}` : `dm-${martId}`);
// MartCard gains: path?: string  (sets the element id and data-path); onRemove?: () => void  (renders the ×)
// useCardClick ClickOptions gains: removePaths?: string[]
```

1. `MartCard` with `onRemove` renders a button `aria-label="Remove <title> from the report"` with a lucide `CircleX` icon, absolutely positioned at the card's top-left corner, visible on card hover and when focus is within the card (CSS like the existing `.dm-card-reveal`). Its click stops propagation and calls `onRemove`. Presses on it never start a drag (the drag hooks already ignore `button`).
2. `useCardClick`: with `removePaths`, compute `withoutPaths(grid, sources, removePaths, own)` for the main mart, dispatch one `setMarts`, save the columns with `columnStore.save(main, columns)`, and remember each removed mart's own field names with `columnStore.saveLastShown` the way the existing remove path does (`ownNamesIn` over the removed columns, per mart).
3. Every existing `martElementId(id)` call keeps working (path is optional).

Tests: the × renders only with `onRemove`, has the label, and its click does not trigger `onSelect`; `useCardClick` with `removePaths` produces one `setMarts` whose grid lacks the removed paths' fields (drive it through a small harness or the app as `joined-marts.test.tsx` does).

Commit: `Cards: a × to remove a joined mart, ids per path, a removePaths click`

### Task 3: Canvas on paths

**Files:** `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/marts-canvas.test.tsx`, `e2e/marts-canvas.spec.ts`

1. Tree cards use `martElementId(martId, path)` for joined nodes and `martElementId(mainId)` for the main card; tree wires use the same ids. A mart can appear at several nodes.
2. Ghosts follow Task 1's `ghostSources` (a mart already in the report is offered under another parent).
3. Joined nodes get `onRemove={() => click(martId, { removePaths: subtreePaths(tree, path) })}`. The main node gets none.
4. Update the existing tests and the e2e spec to the new ids (`article#dm-countries@customers\.countries` via `CSS.escape` in tests, or `[data-path="..."]`).
5. New tests: hover Customers when Countries is under Stores shows a Countries ghost; adding it gives two Countries cards; × on the Stores card removes Stores and the Countries under it, and the Countries under Customers stays; Undo restores both.

Commit: `Canvas: a node per path, the same mart under two parents, × removes a subtree`

### Task 4: Grid on paths, click focuses

**Files:** `src/ui/bands/CardBands.tsx`, `src/graph/visible.ts` (only if needed), `src/ui/App.tsx`, `src/ui/bands/cards.tsx` (title with path), tests (`src/ui/bands/joined-marts.test.tsx` and a new `src/ui/bands/grid-focus.test.tsx`), e2e specs that look up joined cards by id.

1. The Data Marts band renders the main card, then one card per joined path (`joinedPaths` order) with `path` set, then the other visible marts that are not in the report (by mart id, as today). A joined card's title is the source label (`JoinedSource.label`, which already carries the path when two joins reach the mart).
2. Click on the main card or a joined card sets `focus` (a path; `''` for the main) instead of calling `click(id)`. It never deselects or removes. Clicking the focused card again, clicking the band's empty area, or Escape clears it.
3. While a card is focused: the sources one hop under its path that are not in use are its joinable set. Those marts that are already cards in the band keep their look; the ones not in the band show as ghost cards (reuse the existing ghost rendering). Every other card not in the report is dimmed (`unjoinable` styling). A click on a joinable card or ghost adds it with `click(martId, { addAt: source.aliasPath })`.
4. With no focus, a click on a card not in the report behaves as today.
5. Joined cards get the × (`onRemove` with `removePaths` = that path and every in-use path under it).
6. Relationship wires between report cards run parent card to child card along the paths in use (as on the canvas). Wires to and between marts not in the report stay as today.
7. Drag a joined card onto the main card: still makes that mart main (the drag hook reads `data-mart-id`, which stays the mart id).
8. `MartGrid.tsx:467` uses `cardClick(id, { only: 'deselect' })` for the column-picker remove path: leave it working.

Tests: one card per path when Countries is joined twice; clicking a joined card removes nothing and shows its joinable marts; clicking a ghost while focused adds under that path; Escape clears focus; × removes the subtree; clicking the main card no longer deselects. Update any test that relied on click-to-remove or click-main-to-deselect to the new behaviour (spec Revision 1 wins).

Commit: `Grid: a card per joined path, a click focuses and offers what joins under it, × removes`

### Task 5: Data band groups per path, end-to-end checks

**Files:** `src/ui/explorer/MartGrid.tsx` (group cells, around line 445), its tests, `e2e/*.spec.ts`, `README.md` (the Canvas paragraph and the Grid behaviour).

1. Group cells are keyed by alias path (`f.joined.aliasPath`, main `''`), titled with `f.joined.label` for joined paths and the mart title for the main mart. Two adjacent paths of one mart are two groups.
2. e2e: in Canvas, add Countries under Customers and under Stores, check two Countries cards and two Countries groups in the Data band; × on Stores removes Stores and its Countries; Undo restores. In Grid, click Orders card: nothing removed; click a joined card: its joinable marts show; × removes.
3. README: describe the × and click-to-show-joinable for both views; drop any text that says a click removes a mart.
4. Full checks: `npx vitest run --maxWorkers=4`, `npx tsc -b`, `npm run e2e`.

Commit: `Data band: a column group per path; end-to-end checks and README for joins per path`
