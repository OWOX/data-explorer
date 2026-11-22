# Card rules: Grid and Graph aligned

No spec: the requirements are the user's rules of 2026-11-21, quoted under each task.

## Global constraints

1. Vitest only with `npx vitest run <files> --maxWorkers=4`.
2. Playwright only with `npm run e2e -- <spec> --trace off`; run the specs you touch.
3. No new dependencies. No changes to `plugin.json`.
4. Comments and commit messages: plain sentences, no em dashes, sentence case.
5. Keep existing tests green; update a test only when it asserted behaviour this task changes.
6. Scratch in the worktree's `tmp/`. Stage only your own files. Never run bare `git stash`.
7. Grid (`src/ui/bands/CardBands.tsx`, `useGridFocus.ts`) and Graph (`src/ui/bands/MartsCanvas.tsx`, `useGhostChain.ts`) follow the same rules. Shared rules go in shared helpers, not copied code.

Terms: "path" = the report's join tree (main mart plus joined marts, including bare middle marts). "Joinable" = a mart that can join the path directly or through other marts. "Focus" = Grid focused card / Graph pinned card.

## Task 1: Which marts the Grid shows, and what a click adds

User's words: "in grid: If main data mart is assigned, show only data marts which can be joined directly or indirectly to existing path. Once clicked — add to path via shortest possible way to main (shortest — less data marts in chain). In grid: if main data mart is not assigned, show data marts matching search or context criteria."

Files: `src/graph/visible.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/useCardClick.ts`, `src/state/join-plan.ts`, `src/state/join-tree.ts`, `src/api/blendable.ts`.

Requirements:
1. With a main mart: the Grid band shows the path's marts plus every accessible mart reachable from the path through relationships at any depth (use the main mart's blendable sources, which list every alias path). Marts that cannot be reached are not shown (no more dimmed "Can't join" cards). Search and context filters still narrow this set.
2. A click on a shown mart not in the path adds it through the shortest chain to the main mart: the alias path with the fewest marts. Ties: prefer a chain that reuses marts already in the path, then the first by title. Middle marts on that chain join with no columns of their own (bare), as today for deep adds. After the add the new card is focused, as today.
3. Without a main mart: the band shows marts that match the search or context criteria, as today; a click makes it the main mart, as today.
4. Remove the hint texts and code paths that only existed for unjoinable cards in the band, if nothing else uses them.
5. Tests: reachable-at-depth-2 mart shown; unreachable mart hidden; click picks the shortest chain; tie rule; no-main behaviour unchanged.

## Task 2: Look rules, the same in both views

User's words:
- "main data mart always in top left corner"
- "if data mart is in focus — border is 2px as in Grid view now"
- "if data mart is not in path, it is not dimmed, but line is dashed and border is dashed"
- "the same line logic on grid and graph: solid — connected, dashed — can be connected, but not connected yet"
- "show joinable data marts to hovered. all others become 50% dimmed" / "the same hovering logic — show joinable data marts to the one is hovered"

Files: `src/ui/bands/bands.css`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/canvas-layout.ts`, `src/ui/bands/wires.ts`, `src/graph/visible.ts`.

Requirements:
1. Main mart: Grid shows it first (top-left) always, even when its storage is unticked in the storage filter. Graph places it top-left: first column, first row (not centred on its children).
2. Focus: 2px border in the card's tone, in both views (as Grid today). No other border change.
3. In the path: 1px tone border, full opacity. Lines between path marts are solid and always drawn, in both views.
4. Not in the path but joinable (Grid band cards outside the path, Grid focus/hover ghosts, Graph ghosts at any depth): full opacity (not dimmed), 1px dashed border, and the line from the mart it would join is dashed at full strength.
5. Hover, both views: hovering a card shows its joinable marts (Grid already shows hover ghosts; Graph shows its ghost column). Every card that is neither the hovered card, its path neighbours, nor its joinable marts is dimmed to 50%. Leaving the card restores everything (keep the 400 ms grace for moving onto a ghost).
6. Remove the Grid-wide `.dm-canvas.focused .dm-node { opacity: .25 }` dimming; dimming now means only the hover rule (50%) and the drag rule (Task 3).
7. Screenshots with Playwright of both views (resting, focused, hovered) to `tmp/rules-*.png`, looked at before reporting.
8. Tests for each rule in both views.

## Task 3: Drag to rejoin, the same in both views

User's words: "no drag to main data mart to make main. 'Make it main' button should be used instead. When non main data mart is moved, dim all non-joinable data marts with the one is moved and draw a line to closest one. Line to the data mart it is joined to at this moment is solid, all others are dashed. If user dropped card while other data mart is closer (connected with dashed line), update path accordingly."

Files: `src/ui/bands/useCardDrag.ts`, `src/ui/bands/useCanvasDrag.ts`, `src/ui/bands/canvas-drag.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/bands.css`.

Requirements:
1. Grid: remove drag-onto-main to make a mart main. "Make it main" in the section header is the only way.
2. Both views: dragging a non-main card that is in the path. Cards that the moved mart cannot join under are dimmed (Graph today: opacity .15 grayscale; use one shared look). The valid targets stay at full opacity.
3. Lines while dragging: from the moved card to every valid target. The line to the mart it is joined to now is solid; all others are dashed. The closest target's line is drawn stronger.
4. Drop: if the closest target is the current parent, nothing changes. If another target is closer, the mart is rejoined under it (existing `click(..., { moves })`), one Undo step.
5. Dragging a card not in the path: no drag (a click adds it).
6. Tests in both views: no make-main by drag in Grid; dimming of non-targets; solid line to current parent, dashed to others; drop on a closer target moves it; drop near the current parent changes nothing.
