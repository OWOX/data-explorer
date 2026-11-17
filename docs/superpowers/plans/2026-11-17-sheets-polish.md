# Sheets Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Eleven Google Sheets-style fixes to the Data Explorer grid, menus and band headers.

**Architecture:** React 18 + TypeScript plugin, Vite, Vitest and Playwright. Grid: `src/ui/explorer/MartGrid.tsx`; column menu: `src/ui/explorer/ColumnMenu.tsx`; band chrome: `src/ui/bands/`; global state and Undo history: `src/state/store.tsx`; styles: `src/ui/bands/bands.css`.

**Spec:** the user's request of 2026-11-17 (items 1–11, quoted in each task).

## Global Constraints

1. No new dependencies. No change to `plugin.json`, the SDK types in `src/sdk/types.ts`, or any stored collection's document shape.
2. Colours come from tokens in `bands.css` (`--sheet-green`, `--sheet-green-fg` and the existing ones), so dark mode keeps working. No hardcoded colours in component rules.
3. Everything that appears on hover also appears on keyboard focus (`:focus-within`) and stays visible on touch screens (`@media (hover: none)`).
4. Tests: `npx vitest run --maxWorkers=4` (never more than 4 workers). e2e: `PW_CHROMIUM=$(ls -d ~/Library/Caches/ms-playwright/chromium_headless_shell-1254/*/chrome-headless-shell | head -1) npx playwright test --workers=4 --trace off`. `npx tsc --noEmit` and `npx eslint .` must stay clean.
5. Commit messages and comments follow plain, direct English; no em dashes in new text.
6. Existing tests that encode old behaviour are updated, never deleted to get green.

## Rulings

1. Item 10 (Undo): Cmd/Ctrl+Z already undoes navigation. The ask is read as: grid edits (filter, sort, aggregation, hide/show columns, Reset) become Undo steps too. Cost if wrong: one revert of Task 6.
2. Item 9 (unit dropdown): the API only has `last_n_days` and `last_n_months`. Weeks map to 7n days, quarters to 3n months, years to 12n months. On reopen a `last_n_months` rule shows years when n % 12 = 0, quarters when n % 3 = 0, else months; a `last_n_days` rule reopens as weeks when n % 7 = 0, else days. `RELATIVE_MAX_N` applies to the converted n.
3. Item 8: "Last…" and "This…" are flyout rows inside the date filter panel, opening a third-level panel beside it, same look as the column menu submenus.
4. Item 3: one shared checklist component in Sheets style, used by the Fields picker, the Storage multi-select and the Aggregate function list.
5. Item 11: the overflow chip "+N {tag icon} more" opens a popover listing the hidden context badges, each still toggleable.

---

### Task 1: Aggregation Apply does not work (item 5)

> "fix "Apply" button on aggregation, it doesn't work. check others."

1. Reproduce first, in a failing test (unit or e2e) that ticks an aggregate function in the column menu, presses Apply, and expects the grid to aggregate (the rows request carries the aggregation and the header shows the Aggregate indicator). Use superpowers:systematic-debugging; find the root cause, do not guess.
2. Fix it.
3. Check every other Apply in the column menu (Filter: operator form, Last N days form, date range; Format if it has one) with the same kind of test. Fix any that fail.

### Task 2: Header hover icons and line-style indicators (items 1, 2, 4)

> 1. "column icon next to data mart title show only on hover to cell"
> 2. "column actions icon show by hover on column title cell or when some actions are activated. So if filter is applied, filter icon and actions icon must be in column title cell"
> 4. "when filters (filter, aggregation, sorting) active, show sign in header without green background, just a single line-kind"

1. The green Fields (column picker) icon in the first column's title cell is hidden until that header cell is hovered or has focus within, or its popover is open.
2. The column menu icon (`data-menu-icon`) is hidden until its header cell is hovered or has focus within, or its menu is open, or the column has any active action (filter, aggregation, sort, non-auto member format). With a filter applied the header shows the filter indicator and the menu icon.
3. Active indicators (filter, aggregate, sort, and the menu icon when active) show as plain green line icons: no filled or tinted background, no border. Hover may add a light neutral background.
4. Hidden icons keep their layout space only when shown (no empty gap when hidden) unless that makes the header jump on hover; prefer `visibility`/opacity with reserved width if the column width would otherwise change.
5. Tests: unit tests for the visibility class/attribute logic; update e2e that click the menu icon to hover the header first.

### Task 3: Sheets-style checklists (item 3)

> "show all dropdown blocks, like fields selection, in google sheets style with select all x clear, search and displaying x option like in google sheets"

1. New component `src/ui/SheetsChecklist.tsx` with: a top row "Select all N - Clear" (links, `--sheet-green`-free: Sheets uses blue links, use a token `--sheet-link`) on the left and "Displaying N" on the right; a search input with a magnifier icon on the right; the list where a selected item shows a check mark (not a checkbox) and the row is keyboard togglable (Space/Enter), with `role="option"`/`aria-selected` inside a `role="listbox"` with `aria-multiselectable`.
2. "Select all" selects every item matching the search; "Clear" unselects every item matching the search; N counts the matching items; "Displaying N" shows how many match.
3. Use it in `ColumnPicker.tsx` (Fields), `src/ui/bands/MultiSelect.tsx` (Storage) and the function list in `AggregationEditor.tsx`. Keep their existing rules (e.g. the Fields picker cannot hide the last visible column, if it has that rule; aggregation keeps Apply).
4. Update existing tests that query checkboxes.

### Task 4: Date filter submenus and unit dropdown (items 8, 9)

> 8. "in filter menu for date fields move "Last...", "This..." to next level menu"
> 9. "in Last X days. "Days" must be adjustable drop down (days / weeks / months / quarters / years)"

1. Date filter first level: Today, Yesterday, "Last…" ▸, "This…" ▸, Custom range…, On… (DATE only), Before…, After…, Is blank, Is not blank, Clear (when set).
2. "Last…" ▸ panel: Last 7 days, Last 14 days, Last 30 days, Last 90 days, Last week, Last month, Last quarter, Last 12 months, then the form "Last [n] [unit ▾] Apply" with units days, weeks, months, quarters, years.
3. "This…" ▸ panel: This week, This month, This quarter, This year.
4. The row of the active rule's group shows as active (the existing active styling); the active preset inside is pressed.
5. Unit mapping per Ruling 2. Put the conversion in `src/filters/catalogue.ts` as pure functions with unit tests (`toRule(n, unit)`, `fromRule(rule)`), and make `presetName` keep working.
6. Flyout placement reuses `menuPlacement.ts`; hover intent and keyboard (ArrowRight/Enter opens, ArrowLeft/Escape closes the third level only) match the column menu.

### Task 5: Copy selected cells (item 6)

> "when cell or several cells are selected, ctrl+c must copy this content to clipboard"

1. With a cell, a block, a whole column or a whole row selected and focus in the grid, Ctrl+C / Cmd+C puts the selection on the clipboard as TSV (rows by newline, cells by tab), using the displayed (formatted) text of each cell, header excluded for cell/block, header included for whole columns.
2. Use the `copy` event (`e.clipboardData.setData('text/plain', tsv)` + `preventDefault`) so it works in the sandboxed iframe; do not copy when focus is in an input or a menu, or when the user has a native text selection inside a cell.
3. Unit test with a fake ClipboardEvent; e2e check that the copy event yields the right text.

### Task 6: Undo/Redo for grid edits (item 10)

> "add Cmnd + Z, Cmnd + Shift + Z for undo / redo"

1. Per Ruling 1: a filter applied or cleared, a sort change, an aggregation applied or removed, a column hidden or shown (Fields picker or Hide column), and Reset each become one Undo step. Undo restores the grid to the state before the step; Redo re-applies it.
2. Use the existing history (`Entry.grids` in `src/state/store.tsx`): add an action (e.g. `editGrid`) that pushes the current selection with the mart's previous grid into `history`, empties `future`, and stores the new grid. Undo/Redo already swap `grids`; make `MartGrid` adopt a grid that changed under it (the `seenSaved` path) so the visible state follows.
3. Paging (limit) and row-open are not grid edits; they do not create steps. Column formats are out of scope.
4. Cmd/Ctrl+Z and Cmd/Ctrl+Shift+Z (and Ctrl+Y on non-Mac) work while focus is in the grid or anywhere outside a text field. Tooltips read "Undo (⌘Z)" / "Redo (⇧⌘Z)" on Mac and "Undo (Ctrl+Z)" / "Redo (Ctrl+Shift+Z)" elsewhere.
5. Tests: store reducer tests for the new action; a component test that applies a filter, undoes, redoes.

### Task 7: Full-screen button style and context badge overflow (items 7, 11)

> 7. "make full screen icon must be in the same border and background like other buttons on the left"
> 11. "crop the list of context badges next to "Data Mart" section title then horizontally space is not enough, show "+x {context icon} more" in this case"

1. The full-screen button in `Band.tsx` gets the same box as the Reset/Refresh/Export buttons: 32px high, 1px border, rounded-md, same background and hover. Icon-only, square.
2. Context badges in the Data Marts band title row fit one line: measure with a ResizeObserver, show as many badges as fit, then a chip "+N {Tag icon} more" with the same badge style. The chip opens a popover with the hidden badges (each toggles its context as before). Selected contexts count toward N as usual; if a selected one is hidden, the chip shows as active.
3. Tests: unit test of the fit calculation (pure function taking widths), component test of the chip and popover, e2e at a narrow width.
