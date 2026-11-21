# Review wave 3

No spec: the requirements are the user's list of 2026-11-20 (items 1 to 15), quoted under each task.

## Global constraints

1. Vitest only with `npx vitest run <files> --maxWorkers=2` (two agents may run at once; this machine overheats). Never the default worker count.
2. Playwright only with `npm run e2e -- <spec> --trace off` (the script sets `--workers=1`).
3. No new dependencies. No changes to `plugin.json`.
4. Code comments and commit messages: plain sentences, no em dashes, sentence case. Commit subjects follow the repo style (`Area: what changes, in a sentence`).
5. Keep existing tests green; update a test only when it asserted the behaviour this task changes.
6. Scratch files go in the project's `tmp/`, never `/tmp`. Stage only your own files.
7. Grid and Graph are the two views of the Data Marts band (`src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx`). Their card logic must stay the same.

## Task 1: Card look (items 1, 2, 6)

User's words:
- "remove double borders, i don't need it. Apply light background the same tone as border instead"
- "back external link to top right corners of data marts cards. Show (i) icon from the left if exists"
- "joinable data marts always in grid and graph must have 1px border"

Files: `src/ui/bands/cards.tsx`, `src/ui/bands/bands.css`, `src/ui/Tooltip.tsx`, tests in `src/ui/bands/`.

Requirements:
1. Cards in the report (`aria-pressed='true'`, bands.css ~276) and the focused/pinned card (`[data-focused]`, ~282) lose the extra ring (`box-shadow: 0 0 0 1px var(--tone)`) and the outline. Instead a card in the report gets a light background in its tone (`color-mix(in oklab, var(--tone) 10%, var(--card))` or similar) and keeps one 1px border in the tone. The focused card (whose joinable marts show) gets a slightly stronger tone background (about 20%), no outline. Keyboard `:focus-visible` keeps a visible indicator.
2. Undo the title-tooltip link of the last wave: remove `TitleTip` and the keyboard twin button (`.dm-card-open`, `.dm-link-kbd`), and put the "Open in OWOX" ExternalLink button (`aria-label="Open in OWOX"`, Tooltip "Open this data mart") back in the card head's top-right, as it was before commit a78a911 (see `git show a78a911^:src/ui/bands/cards.tsx`). The title goes back to a plain name tooltip. Head order from the right edge: Open link, then to its left the (i) Description hint when the mart has a description, then the Make-main crown. The × remove button stays outside the card's top-right corner; make sure it does not cover the link.
3. Joinable marts (Graph ghosts and Grid hover/focus ghosts, `.dm-ghost` and Grid's joinable cards) have a 1px border in both views, the same width and style in Grid and Graph (keep dashed if that is the ghost style today, at 1px).
4. Update tests and e2e that open the link through the bubble back to clicking the corner button.

## Task 2: Card clicks (items 4, 5)

User's words:
- "click on used card on data mart grid and graph view must show / hide joinable data marts"
- "click on not used card on data mart grid and graph view must add it to path first and show joinable data marts."

Files: `src/ui/bands/CardBands.tsx`, `src/ui/bands/useGridFocus.ts`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/useGhostChain.ts`, `src/ui/bands/useCardClick.ts`.

Requirements:
1. A click on a card in the report toggles its joinable marts (Grid: focus toggle; Graph: pin toggle). This already holds; keep it and keep the tests.
2. A click on a card not in the report (Grid: an outside card or a joinable card; Graph: a ghost at any chain depth) adds it to the report, and once it is in, that new card becomes the focused (Grid) or pinned (Graph) card, so its joinable marts show at once. If the add fails or changes nothing, nothing is focused.
3. Only the × removes a card (unchanged).
4. Tests for both views: click outside card, it is added and its joinable marts show; click it again, they hide.

## Task 3: Graph drag, Graph height, Sources dimming (items 9, 10, 12)

User's words:
- "when user hold card on graph view, draw dashed lines to every card this data mart can be joined, make all data marts but closest dimmed. So once user release move data they hold will be join to the one is closest and not dimmed"
- "when in graph view extra height it required to show joinable data marts by hover, extend height of data mart block smoothly"
- "dimming logic of data sources cards must be the same in grid and graph views of data marts (dimmed if not applicable)"

Files: `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/useCanvasDrag.ts`, `src/ui/bands/canvas-drag.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/bands.css`.

Requirements:
1. While a Graph card is held (drag in progress), draw a dashed line from the held card to every valid drop target (`dropTargets`). Every card except the closest valid target is dimmed; the closest one is not dimmed and its line is drawn stronger. Release joins (moves) the held mart under that closest target (existing `closestTarget` and `click(..., { moves })`). The pointer-following line from the last wave can stay or be replaced by the line to the closest target; pick one, no duplicate line.
2. When hover or pin ghosts need more height than the Graph area has, the area grows to fit, with a smooth height transition (about 200 ms), and shrinks back smoothly when they hide. No jump of the content above.
3. Data Sources band cards are dimmed by the same rule in Grid and Graph views ("dimmed if not applicable"): find how Grid decides which source cards are dimmed (storage not usable by the main mart, or similar) and apply the identical rule when the Data Marts band is in Graph view. Report the rule you found.
4. Tests: drag shows N dashed target lines and dims all but the closest; release moves under the closest; Sources dimming identical in both views.

## Task 4: Column menu and Data header (items 7, 8, 11, 13)

User's words:
- "make 2 level menu for filter, aggregate, etc 30% narrow"
- "add note in filter sub menu. Use the same text for slice and filter and owox extension shows"
- "click by sorting icon in column header must change mode (asc / desc/ none), not open menu"
- "in data section next to data mart title show (i) first, column icon next"

Files: `src/ui/explorer/ColumnMenu.tsx`, `src/ui/explorer/FilterEditor.tsx`, `src/ui/explorer/MartGrid.tsx`, `src/ui/bands/bands.css` (`.dm-menu-sub`), tests in `src/ui/explorer/`.

Requirements:
1. `.dm-menu-sub` width goes from `min(28rem, …)` to `min(19.6rem, …)` (30% narrower). All second-level panels share it.
2. Notes, taken from the OWOX web app (`owox-data-marts/apps/web/.../ReportColumnPicker/OutputSettingsDropdown.tsx`, `SECTION_INFO`), with the words that point to OWOX's own layout ("below", "above") removed:
   - Filter panel note: "Filters narrow the final result, applied to the SELECT after all JOINs. Use slices to narrow a joined data mart BEFORE it is JOINed in."
   - Slice panel note: "Slices are pre-join filters: they narrow a joined data mart INSIDE its own subquery before the JOIN, reducing the rows pulled in. Because joins are LEFT JOINs, a slice does NOT reduce the number of rows in the final result: main-mart rows that no longer match a sliced row pass through with NULL on the joined columns. To drop those rows from the output, add a Filter on the joined column."
   Both sit in the sticky footer under the buttons (the `note` prop). The Filter note shows on every Filter panel; the existing HAVING note for an aggregated column stays and comes after it. Drop the `max-w-[18rem]` on the Slice note.
3. The sort icon in a column header: a click cycles that column's sort none, ascending, descending, none, and does not open the column menu. Find what opens the menu from the sort icon today and stop it. The title text keeps its current behaviour.
4. In the Data grid's group header (a data mart's title row, e.g. "Contact | Entity"), the order next to the title is: the (i) description hint first, then the column/picker icon. Find which icons render there today and reorder them; report what each icon is.
5. Tests for 1 to 4.

## Task 5: Move columns by drag and drop (item 14)

User's words: "make columns movable by drag and drop like in google sheets within single data mart"

Files: `src/ui/explorer/MartGrid.tsx`, `src/ui/explorer/ColumnDrag.tsx` (check what it does today), `src/api/grid-columns.ts`, `e2e/grid-drag.spec.ts`.

Requirements:
1. Press on a column's letter cell or header and drag sideways: the column follows the pointer as in Google Sheets (a translucent copy of the column and a vertical drop indicator between columns). Release moves the column there.
2. A column moves only within its own data mart group; a drop outside the group is clamped to the group's edges.
3. The new order is the grid's column order: saved like any other column change and undoable with the existing Undo.
4. Click without movement keeps today's behaviour (select or sort). Start dragging only after a 4px move.
5. Tests: vitest for the reorder helper (within group, clamped), e2e drag of one column in one group.

## Task 6: Copy error details (item 3)

User's words: "add copy to clipboard icon next to 'Failed to open OWOX Data Mart data stream' next to copy all know details to investigate error"

Files: `src/ui/ErrorBox.tsx`, `src/ui/explorer/useMartRows.ts`, `src/api/rows.ts`, `src/ui/explorer/clipboard.ts`.

Background: `@owox/api-client`'s `traverseData` wraps every host failure in "Failed to open OWOX Data Mart data stream"; the host's real error is in `error.cause` (a `PluginTransportError` with `payload` { code, message, status, ... }). `errorMessage()` shows only the outer message.

Requirements:
1. The visible message adds the cause when there is one: "Failed to open OWOX Data Mart data stream: <cause message> (<code>, <status>)". Walk the `cause` chain.
2. A copy icon button (lucide `Copy`, aria-label "Copy error details") next to the message in every ErrorBox. It copies a plain-text block with every known detail: time (ISO), plugin version or build (whatever the app knows), error name and message, each cause in the chain with name, message and payload JSON, `details` (e.g. dataMartId), run id when known, and the request (data mart id and the traverse options: columns, filters, sort, limit, joins) when the caller passes it. A short "Copied" confirmation follows.
3. The grid's rows error passes its request context to ErrorBox (data mart id, traverse options, run id).
4. Never include credentials or tokens.
5. Tests: errorMessage with a cause chain; copy writes the expected block.

## Task 7: Bar chart X axis title (item 15)

User's words: "in bar chart under time labels show field name for X"

Files: `src/charts/svg/BarChart.tsx`, `src/charts/TimeSeriesPanel.tsx`, `src/charts/charts.css`.

Requirements:
1. Under the X axis tick labels of the bar chart, show the X field's display name (as the field picker labels it), centred, muted, small. Room is reserved so it does not overlap the labels.
2. Same for any other chart that uses the same time axis, if they share the component.
3. Test that the label renders with the field name.
