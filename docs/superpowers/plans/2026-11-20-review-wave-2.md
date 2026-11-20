# Review wave 2

No spec: the requirements are the user's list of 2026-11-20, quoted under each task.

## Global constraints

1. Vitest only with `npx vitest run <files> --poolOptions.threads.maxThreads=4`. Never the default worker count.
2. Playwright only with `npm run e2e -- <spec> --trace off` (the script already sets `--workers=1`).
3. No new dependencies. No changes to `plugin.json`.
4. Code comments and commit messages: plain sentences, no em dashes, sentence case. Commit subjects follow the repo style (`Area: what changes, in a sentence`).
5. Keep existing tests green; update a test only when it asserted the behaviour this task changes.
6. Scratch files go in the project's `tmp/`, never `/tmp`.

## Task 1: Column header and the column menu's second-level panels (Data section)

User's words:
- "Do not show right click menu on click on column title, only by icon."
- "Show note in 2-level context menu in Data section under 'Cancel' / 'Apply' buttons."
- "Make all 2-level layers the same width, wrap note at Slice into two lines."

Files to look at first: `src/ui/explorer/MartGrid.tsx`, `src/ui/explorer/ColumnMenu.tsx`, `src/ui/explorer/MenuParts.tsx`, `src/ui/explorer/FilterEditor.tsx`, `src/ui/explorer/AggregationEditor.tsx`, `src/styles.css`.

Requirements:
1. Clicking the column title (left click on the header text/cell) no longer opens the column menu. The menu opens only from the header's menu icon button. If a `contextmenu` (right click) handler on the header opens it today, remove that too: the user wants the icon as the only way in. Keyboard access through the icon button stays.
2. Every second-level panel of the column menu (Filter, Slice, Aggregation, Format, or whatever the submenus are) shows its explanatory note below the Cancel / Apply button row, not above it.
3. Every second-level panel has the same fixed width (pick the width of the widest one today, read from the CSS). The Slice note wraps onto two lines at that width; if it does not wrap naturally, the panel width or the note's text width must make it two lines, not one long line.
4. Update or add vitest tests: header click does not open the menu, icon click does; note renders after the buttons.

## Task 2: Data Sources click switches to Grid; open-link moves into the card title tooltip

User's words:
- "When user click on card on data sources, switch to Grid view in Data Marts section."
- "Move data mart link from top right corner to top right corner of tooltip. Do not close tooltip immediately, add 0.5s delay to let user move mouse."

Files to look at first: `src/ui/bands/CardBands.tsx`, `src/ui/bands/cards.tsx`, `src/ui/Tooltip.tsx`, `src/ui/bands/bands.css`.

Requirements:
1. A click (or Enter) on a card in the Data Sources band sets the Data Marts view to Grid if it is on Canvas. Use the same path as the view switch (`pickView` in CardBands) so the choice is saved to preferences like a manual switch. A click that leaves the view on Grid changes nothing.
2. Data mart card: remove the "Open in OWOX" (ExternalLink) button from the card's top-right corner. The card's title tooltip (the bubble that opens over the title) now shows the title and, in the bubble's top-right corner, the same ExternalLink button with `aria-label="Open in OWOX"` that calls `onOpenApp`. This applies on every card where the link existed, including Canvas cards and ghost cards.
3. That bubble stays open 500 ms after the pointer leaves the title, and stays open while the pointer is over the bubble, so the user can move onto the link and click it. Other tooltips keep their current behaviour (the provider sets `disableHoverableContent`; override per tooltip, do not change the global default).
4. The title tooltip must open on every card now, not only when the title is truncated, because it carries the link.
5. Keyboard: the link stays reachable. Focusing the title or card should be able to open the bubble, or keep an equivalent focusable control; do not leave keyboard users without a way to open the mart. Explain the choice in the report.
6. Update tests that click `Open in OWOX` on a card (vitest and e2e) to open the bubble first, and add a test for the 500 ms close delay with fake timers.

## Task 3: Canvas ghosts: click toggles, hover is instant, ghosts chain

User's words:
- "Click by card on canvas must show dimmed data marts which clicked data can be joined to. Second click hides them."
- "By hover on data mart card on canvas show joinable data marts right away, not with 1s pause as now."
- "By hover on dimmed joinable data mart on canvas (which is not used yet), show next joinable data mart to hovered data mart. It must work as a chain."

Files to look at first: `src/ui/bands/MartsCanvas.tsx`, `src/state/join-tree.ts` (`ghostSources`), `src/ui/bands/canvas-layout.ts` (`layoutTree`), `src/ui/bands/bands.css` (`.dm-ghost`), `src/ui/bands/marts-canvas.test.tsx`, `e2e/marts-canvas.spec.ts`.

Requirements:
1. Ghost cards (joinable marts not yet in the report) render dimmed (reduced opacity) as well as dashed.
2. Click on a tree card pins its ghosts. A second click on the same card unpins them. Clicking a different card moves the pin. Escape and a click on empty canvas still clear the pin.
3. Hovering a tree card shows its ghosts with no delay, including when moving from one card to another. Find what makes it feel like about 1 s today (the 400 ms leave timer, a CSS transition, the tooltip, or a layout animation) and remove it for the show. Keep a short grace period only for leaving a card toward its ghost, so the pointer can cross the gap.
4. Chain: hovering a ghost shows that ghost's own joinable marts (sources whose parent alias path is the ghost's alias path) as a further column of ghosts to its right, wired from it with dashed lines. Hovering one of those shows the next level, and so on. The chain is the list of ghost paths from the anchor tree card to the hovered ghost; moving back to an earlier link trims the chain after it. Leaving the whole chain falls back to the pinned card's ghosts, or none.
5. Clicking a ghost at any depth adds it to the report at its alias path (existing `click(g.martId, { addAt: g.aliasPath })`). If adding a deep ghost needs its intermediate ghosts added first, check what `click` with `addAt` does for a path whose parent is not in the tree, and make it add the chain correctly; report what you found.
6. Tests: vitest for toggle-pin, instant hover, and a two-level chain (hover ghost shows its children). Update e2e if any spec relies on the old timing.

## Task 4: Canvas zoom from mouse and touchpad

User's words: "add zoom-in / zoom-out from mouse / touchpad on canvas view".

Files to look at first: `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/useCanvasDrag.ts`, `src/ui/bands/canvas-drag.ts`, `src/ui/bands/wires.ts`, `src/ui/bands/bands.css` (`.dm-tree`), `src/ui/bands/marts-canvas.test.tsx`.

Requirements:
1. Ctrl+wheel and Cmd+wheel on a mouse, and pinch on a touchpad (browsers send it as a `wheel` event with `ctrlKey`), zoom the Canvas view in and out. Plain wheel and two-finger scroll keep scrolling the canvas as today. Call `preventDefault` on the zoom wheel events (non-passive listener) so the browser does not zoom the page.
2. Zoom keeps the point under the pointer fixed on screen (adjust the scroll box's scrollLeft/scrollTop).
3. Scale range 0.5 to 2, multiplicative steps scaled by `deltaY` so a pinch feels smooth. The scroll box's scrollable area follows the scaled size of the tree.
4. Everything still lines up at any scale: wires between cards, ghost wires, the drag line and drop-target pick in useCanvasDrag (pointer coordinates must be divided by the scale), card hover and click.
5. Zoom is per session in memory (not saved to preferences). Switching to Grid and back may reset it to 1.
6. Tests: vitest for the wheel handler (ctrl+wheel changes scale within bounds, plain wheel does not) and for drag coordinates at a scale other than 1.
