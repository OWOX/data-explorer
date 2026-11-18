# Sheets Polish 2 Implementation Plan

**Goal:** Seven fixes from the user's review of v1.8.0 (item 7 skipped by the user).

## Global Constraints

1. No new dependencies; no change to plugin.json, src/sdk/types.ts or stored document shapes.
2. Colours from tokens in src/ui/bands/bands.css; dark mode keeps working.
3. Tests: `npx vitest run --maxWorkers=4`; e2e `PW_CHROMIUM=$(ls -d ~/Library/Caches/ms-playwright/chromium_headless_shell-1254/*/chrome-headless-shell | head -1) npx playwright test --workers=4 --trace off`; `npx tsc --noEmit`; `npx eslint .`. Max 4 workers.
4. Plain English in commits and comments, no em dashes. Tests updated, never deleted to get green.

### Task 1: Apply sends a request but the grid does not change (item 2)

> "Apply" button on aggregation and filter option send request to backend, but nothing happens after

Screenshot context: main mart "Contact | Entity" with a joined mart "User | Entity"; the member opened the column menu of a joined column ("Session's Count Bef…", from User | Entity) and applied Aggregate (Count Unique, Combined ticked); a filter is also set on Status. The network panel shows only small `s/` and `e/` requests answering `{status:"Ok"}` (probably telemetry, not rows). Find the root cause with evidence (joined-mart columns, blendable queries, aggregation/filter on joined columns, sanitizing that drops the rule, an error swallowed, a stale `asked` query). Reproduce in a failing test with the mock's joined marts, fix, and check Filter Apply on joined columns too.

### Task 2: UI fixes (items 1, 3, 4, 5, 6, 8)

1. Item 1: "when user click to cell and start moving cursor without releasing a mouse button, text starts selecting. But instead relevant cells must be selected, not texts". Drag from a cell selects the block of cells like Google Sheets (mousedown sets the active cell, moving over cells extends `to`, mouseup ends); no native text selection in the grid body during the drag. Auto-scroll at the edges is a nice-to-have.
2. Item 3: "column selection has wrong font, it must be like in google sheets". The Fields picker list (SheetsChecklist) uses a larger font than the column menu. Use the same font family, size and row height as the column menu rows (Sheets style) in all checklists.
3. Item 4: remove the "Fields · 6/22" header from the Fields popup.
4. Item 5: "Clear must unselect all fields, but delete entire data mart only after popup will be closed". In the Fields picker of a joined mart, Clear only unticks; the joined mart is removed only when the popup closes with nothing ticked. While open, the grid may hide the columns but must not drop the joined mart. The main mart keeps its existing rule (at least one column).
5. Item 6: remove the "Aggregate by" title from the Aggregate panel.
6. Item 8: "show "Prompt copied. Paste it into Claude Show prompt" as standard message, not add it to data section title". The Export menu's copy confirmation becomes a standard toast/notification (the app's existing toast if any, otherwise a small one in the page corner with role=status), with the "Show prompt" action in it; nothing is added to the Data band title. Same for the "Copied" confirmation of Copy to clipboard if it uses the title.
