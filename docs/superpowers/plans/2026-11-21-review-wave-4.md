# Review wave 4

No spec: the requirements are the user's list of 2026-11-21 (items 1 to 9), quoted under each task.

## Global constraints

1. Vitest only with `npx vitest run <files> --maxWorkers=2` (two agents may run at once; this machine overheats).
2. Playwright only with `npm run e2e -- <spec> --trace off`; when two lanes run, the worktree lane uses `PW_PORT=4393`.
3. No new dependencies. No changes to `plugin.json`.
4. Code comments and commit messages: plain sentences, no em dashes, sentence case. User-facing texts the user dictated are used exactly as given.
5. Keep existing tests green; update a test only when it asserted the behaviour this task changes.
6. Scratch in the project's `tmp/`. Stage only your own files. Never run bare `git stash`.
7. Grid and Graph card logic stays the same in both views.

## Task 1: Card highlight, menu separators, icon, notes (items 1, 7, 8, 9)

User's words:
- "Only selected card must be highlighted by background, not all of them"
- "created data mart icon to data mart icon"
- "show horizontal line separator between AIs, google sheet extensions and other items. I asked about it twice!!!!"
- "slice note is a way shorter in google sheet: 'Slices filter the joined data mart before it is joined — reducing the rows pulled in.' update it and do not invent yours!. Update filter note accordantly. Use bold font instead of caps"

Files: `src/ui/bands/bands.css`, `src/ui/bands/cards.tsx`, `src/ui/explorer/ExportMenu.tsx`, `src/ui/explorer/ColumnMenu.tsx`, `src/ui/explorer/FilterEditor.tsx`.

Requirements:
1. Only the selected card has the tone background: the focused card in Grid (`[data-focused]`) and the pinned card in Graph. Other cards in the report keep their single 1px tone border and the normal card background. With nothing focused or pinned, no card has the tone background.
2. Export menu: the "Create Data Mart" item uses the same icon the app uses for a data mart (find it: the default mart icon on cards / `PickedIcon` fallback, or the icon in the group header of the Data grid). Not `DatabaseZap`.
3. Export menu: a visible 1px horizontal line separates the AI items (Claude, ChatGPT), the Google Sheets destinations, and the other items (Copy to clipboard, Copy SQL, Create Data Mart). `role="separator"` elements already exist in ExportMenu.tsx (`.dm-menu-sep`, bands.css ~490 and ~578) but the user does not see them: find out why (zero height in a grid/flex parent, a colour equal to the background, a `display` rule, an overflow clip) and make them visible in the real browser. Prove it with a Playwright screenshot of the open menu at deviceScaleFactor 2 saved to `tmp/w4t1-export-menu.png`, with destinations present if the mock has any.
4. Notes, exact text, bold instead of capitals:
   - Slice: "Slices filter the joined data mart **before** it is joined — reducing the rows pulled in." (the em dash is the user's; keep it)
   - Filter: "Filters narrow the final result — applied **after** all joins." (built from the OWOX Filter text "Filters narrow the final result — applied to the SELECT after all JOINs", shortened the same way)
   Render bold with `<strong>`. No capitalised words.
5. Tests for 1, 3 (separator elements present between the three groups), 4 (exact text).

## Task 2: Joins through a middle mart (items 4, 5, 6)

User's words:
- "when user clicks to mart connected indirectly (pageview in screenshot), do not add columns from inter connected data mart (Page)"
- "if middle data mart is deleted, but columns from inter-connected data marts are shown (a → b → c, b deleted, just hide b's columns, but keep shown c's columns)"
- "what does error 'the join to... could be resolved'?" (the Export menu's Create Data Mart / Copy SQL tooltip: `The join to "<mart>" could not be resolved`, from `src/datamart/build-sql.ts:158`)

Files: `src/ui/bands/useCardClick.ts`, `src/state/join-plan.ts`, `src/state/join-tree.ts`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/CardBands.tsx`, `src/datamart/build-sql.ts`, `src/api/blendable.ts`.

Requirements:
1. Adding a mart reached through a middle mart (a ghost at depth 2 or more, in Graph or Grid) adds only that mart's default columns. The middle marts on its path get no columns of their own. The report still joins through them (their alias path is part of the added mart's path). Today the deep add adds each ancestor's default columns (`pathsToAdd` / the ancestor loop in useCardClick): stop that.
2. The middle mart still shows as a card in the tree (Graph) and the report band (Grid), joined, with no columns, so the user sees the chain.
3. The × on a middle mart b in a → b → c removes only b's own columns. c stays, with its columns, still joined through b. If b then has no columns and no descendants with columns, b's card goes too. Today × removes the whole subtree (`subtreePaths`): change that for a middle mart. A leaf × is unchanged.
4. Create Data Mart and Copy SQL must build SQL for a chain whose middle mart has no columns. Find why `build-sql.ts` reports `The join to "<label>" could not be resolved` for such a hop (no entry in `sources` for the middle path, because the blendable list keeps only paths with fields? the parent mart lookup? the edge lookup?) and fix it so the middle hop resolves from the model's relationships. Write the cause in the report; the user asked what the error means.
5. The grid's own rows query (traverseData with joins) must work for the same chain; check it with the mock and with how `joins`/alias paths are sent.
6. Tests: deep add adds no middle columns; × on a middle mart keeps the leaf's columns; SQL builds for a chain with an empty middle mart; tree and band still show the middle card.

## Task 3: Primary keys (items 2, 3)

User's words:
- "do not load PK fields by default, if others text fields are available"
- "fix bug: if PK is no available for reporting, id doesn't mean it not exists at all, API should has it"

Files: `src/api/schemas.ts`, `src/model/columns.ts` (`defaultColumns`), `src/ui/explorer/useMartRows.ts`, `src/ui/bands/DataBand.tsx`, `src/records/relationships.ts`, `src/charts/fields.ts`, `src/api/row-counts.ts`, `src/ui/bands/cards.tsx`.

Background: `src/api/schemas.ts` drops every field with `isHiddenForReporting`, the primary key included, so a mart whose key is hidden for reporting reads as having no key: the Data band says "Preview only: this data mart has no primary key.", the card count badge may say it cannot count, and unique counts are off.

Requirements:
1. Default columns (a mart's first open, and a joined mart's default columns on add) leave out primary key fields when the mart has at least one other text field to show. With no other text field, keep today's choice.
2. Keep the knowledge that a key exists even when it is hidden for reporting: the schema loader records the mart's primary key names from the full field list (for example a separate `primaryKey` list on the loader's result or a flag), while hidden fields stay out of the pickable schema.
3. Then check, in the backend source at `/Users/flakss/Projects/owox-data-marts/apps/backend` (read only, do not edit it), whether the data traversal endpoint (`/api/external/http-data/data-marts/:id.ndjson`) accepts a hidden-for-reporting field in `sort` or `column`, and whether it orders or pages by the key on its own. Use the answer:
   - If the backend accepts the hidden key for sort, keep using it for stable paging, and the "Preview only" note no longer shows for such marts.
   - If it does not, do not send it. Change the note for such marts to say the key exists but is hidden for reporting (for example "Preview only: this data mart's primary key is hidden for reporting."), and write in the report what the backend would need to change.
   - Record counts and unique counts: use whatever the backend accepts; never a call the backend rejects.
4. Tests: default columns skip the key when another text field exists; a mart with a hidden key is not reported as keyless; the hidden key is never offered in the column picker.

## Task 4: A click outside an open menu only closes it (added mid-run)

User's words: "when context column menu is opens and user clicks, close context menu first, don't act as user click to selected are (like folding / unfolding section)"

Files: `src/ui/explorer/ColumnMenu.tsx`, `src/ui/explorer/MenuParts.tsx`, `src/ui/explorer/menuPlacement.ts`, `src/ui/bands/Band.tsx`, and every other menu or popover that closes on an outside press (the Export menu `details`, the storage filter, the search dropdown, the multi-select, `src/ui/Popover.tsx`).

Requirements:
1. While the column menu (any level) is open, a pointer press outside it closes the menu and does nothing else: the press and the click that follows do not reach the element under the pointer. No band folds or unfolds, no cell or column gets selected, no card is clicked, no sort toggles, no drag starts.
2. The same rule for the other menus and popovers that close on an outside press, so the app behaves the same everywhere. List each one you changed in the report.
3. A click inside the menu works as today. Escape still closes it and returns focus as today. A press on the menu's own trigger closes it (does not reopen it).
4. Scrolling (wheel) outside the menu is not blocked.
5. Tests: with the column menu open, a click on a band header closes the menu and does not fold the band; a click on a grid cell closes the menu and does not select the cell. One e2e test for the band header case.
