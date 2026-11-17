# Column menu, formats and full screen: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** One Google Sheets-style menu per column (Filter, Aggregate, Format, Sort, Hide column), per-column display formats picked by the AI and overridable by the member, and a full-screen Data section.

**Architecture:** A pure format model (`src/format/`) resolves a column's format as member choice, then project pick, then none, and turns a value into display text. Two host collections store the picks. An AI pick runs once per mart on the reasoning model, for the eligible columns that have no project pick, and writes the project collection. MartGrid's header keeps the title and gets one menu icon. The existing filter, aggregation and sort UIs move into submenus.

**Tech stack:** React 18, TanStack Table, Vitest, Playwright, OWOX plugin SDK 0.43.

**Spec:** the user's request in chat (2026-11-17), restated under Global Constraints.

## Global constraints

1. The menu icon is Sheets' "filter lines" icon: three horizontal lines, each one shorter than the one above. It is green (#188038) at rest and white on a solid green (#188038) rounded square while any filter, aggregation, sort or non-default format is active on the column.
2. The menu looks like Google Sheets: white panel, 4px radius, shadow `0 2px 6px rgba(60,64,67,.3)`, 8px vertical padding, rows 32px high with 16px side padding, 14px "Google Sans", Roboto, Arial text in #202124, a row hover of #f1f3f4, 1px #dadce0 dividers, and a ▸ at the right of a row that opens a submenu. The submenu opens to the right of its row, or to the left when there is no room.
3. First level, in this order: Filter ▸, Aggregate ▸, Format ▸, Sort ▸, a divider, Hide column. Leave out a row that does not apply to the column: Aggregate when the column cannot aggregate, Format on text and boolean columns, Sort when the column cannot sort.
4. The submenus hold the current FilterPopover, AggregationPopover and sort controls with their behaviour unchanged (Apply, Clear, Escape, focus).
5. Next to the column title, the filter, aggregation and sort indicators show only while that setting is active. Clicking one opens the column menu with that submenu open.
6. The column-picker icon next to the data mart title gets the same green style as the menu icon.
7. Hide column removes the column from the visible columns the way unticking it in Fields does, so Undo restores it.
8. Formats by type (category from `categorizeFieldType`):
   1. number: `auto` (grouped `1,223`, today's look), `plain` (`1223`), `percent` (value × 100, up to 2 decimals, `12.5%`), `money` with an ISO currency (`Intl.NumberFormat` currency style, 2 decimals). The Money submenu lists USD, EUR, GBP and UAH. An AI pick may name another currency, which is shown as well.
   2. date and timestamp: `auto` (today's look), `date` (date only), `datetime`, `time`.
   3. string, boolean and other categories: no formats.
9. Formats change only what is shown. Clipboard and TSV export keep today's output: plain digits for numbers, dates as the grid's `auto` look.
10. Resolution order: the member's own choice, then the project pick, then `auto`.
11. Storage: add `{ "name": "column-formats-project", "scope": "project" }` and `{ "name": "column-formats-member", "scope": "member" }` to plugin.json `collections`. Do not touch `credentials`. The document id is the mart id. The document is `{ [columnName]: Format }`.
12. AI input per column: the data mart title, the column name, its alias and its description. No sample values. The model is `reasoning`, falling back to `fast`, through `createAiRun` in `src/search/ai.ts` with its 30 s budget. With no AI configured, nothing is called and nothing is stored. An AI failure is silent: no error UI.
13. The AI picks only for number and date columns that have no project pick yet. It runs once per mart per session, and its answer is validated: an unknown format or currency is dropped.
14. Full screen: an icon in the Data section title. In full screen, the Data section fills the plugin area at 100% height, its title row stays visible, and the other sections and the page header are hidden. The same icon or Escape (when no menu or popover is open) leaves full screen.
15. Tests: Vitest with `--poolOptions.threads.maxThreads=4`; Playwright e2e in `e2e/smoke.spec.ts`. Waits target a row or cell with text, never a row count.

## Review focus

1. A member's choice must win over a project pick that arrives later from the AI.
2. Copy and export must not change. Percent must never reach the clipboard.
3. The submenu must stay inside the plugin frame at the rightmost column and the bottom edge.
4. Escape must close a submenu, then the menu, and only then leave full screen.
5. Joined columns: the format key is the blended column name. The AI gets the joined mart's title for those columns.

---

### Task 1: Format model, storage and display

**Files:** create `src/format/formats.ts` and `src/format/formats.test.ts`, `src/format/store.ts` and `src/format/store.test.ts`; modify `plugin.json`, `src/ui/explorer/CellValue.tsx`, `src/sdk/mock/*` if collections must be registered.

**Produces:**
- `type Format = { kind: 'auto' } | { kind: 'plain' } | { kind: 'percent' } | { kind: 'money'; currency: string } | { kind: 'date' } | { kind: 'datetime' } | { kind: 'time' }`
- `formatsFor(type: string): Format['kind'][]`, which is empty for types with no formats
- `isValidFormat(f: unknown, type: string): f is Format`
- `resolveFormat(member?: Format, project?: Format): Format`
- `formatValue(v: unknown, type: string, f: Format): string`, which falls back to `displayText` for `auto` and for anything it cannot format
- `formatStore(ctx)` with `load(martId): Promise<{ member: Record<string, Format>; project: Record<string, Format> }>`, `setMember(martId, column, f | null)` (null removes the choice) and `setProject(martId, picks)` (merges picks into the document)
- a React hook `useColumnFormats(martId)` that returns `{ formatOf(column, type): Format; setMember(column, f|null) }`

- [ ] Test each format kind, invalid inputs, resolution order, and store round-trips with the mock ctx.
- [ ] Implement, and render CellValue through `formatValue` with the resolved format.
- [ ] Commit.

### Task 2: AI pick

**Files:** create `src/format/ai-pick.ts` and `src/format/ai-pick.test.ts`; wire it into `useColumnFormats`.

- [ ] Build the prompt from constraint 12. The answer is JSON `{ "<column>": { "kind": ..., "currency"?: ... } }`. Validate it with `isValidFormat` and keep only eligible columns that have no project pick.
- [ ] Run it once per mart per session after `load`, then `setProject` the valid picks. Never overwrite an existing project pick.
- [ ] Test: no models means no call; a failure is silent; invalid entries are dropped; existing picks are kept; a member choice still wins.
- [ ] Commit.

### Task 3: Column menu

**Files:** create `src/ui/explorer/ColumnMenu.tsx` and `ColumnMenu.test.tsx`; modify `MartGrid.tsx`, `FilterPopover.tsx`, `AggregationPopover.tsx`, `ColumnPicker.tsx`, `bands.css`, and e2e.

- [ ] Constraints 1–8: one menu icon per header, a Sheets-styled menu with submenus, the existing popovers rendered as submenu content, active-only header indicators that open the menu with their submenu, Hide column, a Format submenu with a check mark on the current format, and the green picker icon.
- [ ] Keyboard: arrows move through the rows, Right or Enter opens a submenu, Left or Escape closes it.
- [ ] Update the unit tests and e2e that clicked the old header icons.
- [ ] Commit.

### Task 4: Full screen Data section

**Files:** `src/ui/bands/DataBand.tsx`, `Band.tsx`, `App.tsx`, `bands.css`, tests, and e2e.

- [ ] Constraint 14. Test it and commit.

### Task 5: Docs

- [ ] Add the column menu, formats and full screen to the README. Commit.
