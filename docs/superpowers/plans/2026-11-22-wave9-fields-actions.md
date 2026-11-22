# Wave 9: field actions from the Fields list, mart-title marks, chart labels

No separate spec: the member's 8-point request (2026-11-22) and their answers below are the authority.

Answers:
1. Chart axis labels name the data mart the way the OWOX extension names columns: `{Field Name} | {Data Mart Name}`.
2. Chart menus: the selected mark is the green check, kept on the left.
3. A hidden field's action menu (opened from the Fields list) has all the header menu's rows. Filter and Slice keep the field hidden; Aggregate, Sort and Format show it as a column first, then apply.

## Global constraints

1. Vitest only with `--maxWorkers=4`. Playwright e2e: `npm run e2e -- <spec>` (uses `/?mock`). Type check: `npx tsc -b`.
2. eslint has about 4786 errors on main; add none in touched files (`npx eslint <files>` before and after).
3. Comments, test titles and commit messages follow the repo style: plain sentences that say what a thing does for the member.
4. Every behavior change gets a test (unit or e2e). Filters, slices, aggregations and sorts stay one Undo step each, as today.
5. Grep test output for `Test Files|Tests |FAIL`; never trust a tail of it.

## Task 1: Data mart title row (items 2, 3, 5)

Files: `src/ui/explorer/ColumnPicker.tsx`, `src/ui/explorer/MartGrid.tsx` (group header row near the `<th data-group ...>` markup), `src/ui/bands/bands.css` or `src/styles.css`, tests.

1. The Fields button (`Columns3` icon in `ColumnPicker`) loses its one-word tooltip `Fields` (the `tip="Fields"` on its Popover). Keep its aria-label `Fields of <title>`.
2. The `(i)` description hint next to a data mart title (`<Hint text={g.description} ...>` in the group header) shows only while the header cell is hovered or holds focus, like the other `dm-reveal` controls. It stays reachable by keyboard (focus reveals it).
3. When any field of that data mart (the group's fields, `fieldsOf(g)`) has an active filter, a Funnel mark shows after the title and before `(i)`; when any has an active slice, a Layers mark shows there too. Same icons and green "on" look as the column header marks (`dm-ctl dm-ctl-on`). Each mark has a tooltip listing the rules, one per line, e.g. `Filter: Country is Ukraine` (reuse `describeColumnFilter` / `describeFilter` + `sliceField` from `ColumnMenu.tsx`). A click on a mark opens that mart's Fields list. Marks count rules on hidden fields too (Task 2 makes those possible).

## Task 2: Actions on any field from the Fields list (items 1, 4)

Files: `src/ui/explorer/ColumnPicker.tsx`, `src/ui/SheetsChecklist.tsx` (row slot before the `extra` hint), `src/ui/explorer/ColumnMenu.tsx` (`MenuPopup`, `ColumnControls`), `src/ui/explorer/MartGrid.tsx` (the `ColumnMenuEnv` value), tests.

1. Each field row of the Fields list gets the column-menu icon (`FilterLinesIcon`, the same icon as the column header's menu button) before its `(?)` hint.
   - Green (the `dm-ctl-on` look) whenever the field has a filter, a slice, an aggregation (function or bucket) or a sort, whether or not it is shown.
   - Otherwise grey, and visible only while the row is hovered or focused.
   - A click opens the same column menu the header opens (`MenuPopup`), anchored to the icon, without ticking or unticking the row. The checklist's tick still toggles visibility as before.
   - The Count Unique lead row gets no icon.
2. Filter and Slice applied from that menu never change the columns: a hidden field stays hidden, a shown one stays shown. The rule applies to the query as it would for a shown column (a WHERE on the main mart, a pre-join rule for a slice).
3. Rules on hidden fields survive: they are saved with the view, show in the header marks of Task 1, are cleared by Reset, and are undoable. Today something may drop or ignore a slice (or a filter) whose field is not a column: find it (`pickOffered`, `buildRowQuery`, `buildGroupedQuery`, `toTraverseFilters`, the Charts queries, `keysPlan`, the saved-view pruning) and make a rule on a hidden field of a data mart that is on the grid apply. Charts must apply the same filters and slices as the table (see memory: charts match table data).
4. Aggregate, Sort and Format picked from that menu on a hidden field first show the field as a column (the same placement as ticking it in the list, one Undo step together with the change), then apply. On a shown field they behave as from the header.
5. Hide in that menu is the same as unticking. Move left/right is offered only for a shown field.
6. A slice on a field of a joined data mart that has no shown column: the mart is not joined, so the slice cannot apply. Keep today's behavior for that case (parked, with the existing note) and say so in a comment.

## Task 3: Chart menus and labels (items 6, 7, 8)

Files: `src/charts/kinds/sankey.tsx`, `src/charts/ChartMenu.tsx`, `src/ui/explorer/MenuParts.tsx` / `src/ui/bands/bands.css`, `src/charts/kinds/*.tsx` and `src/charts/svg/*.tsx` axis titles, `src/charts/fields.ts` / `src/charts/menuGroups.ts`, tests.

1. Sankey: each `Column N` submenu ends with a `Remove column` action row (Trash2 icon, after the mart groups, separated as the menus separate groups). It removes that column from the Sankey's dimensions (the following columns move up). It is not offered when the Sankey is at `SANKEY_MIN` columns.
2. Every chart axis title and Sankey column title reads `{Field Name} | {Data Mart Name}`, e.g. `Created | Contact | Entity`. Field name is what `columnTitle` gives today; the data mart name is the title the chart menus already use for that field's mart group (the main mart's title, or the joined mart's title as shown on its grid tab). A measure axis title (`yTitle` from the measure label) gets the same suffix from the measure's field's mart; a row count gets its counter's mart. Long titles keep clipping with the full text in `<title>`.
3. Chart menus show the selected choice with the green check on the left. The CSS already sets `.dm-menu-check` to `var(--sheet-green)`, yet the member sees a dark check in the Chart type submenu (screenshot): find why (scope of `--sheet-green`, an override, a different element) and fix it so every chart menu's selected mark is green, on the left. Confirm with a Playwright screenshot taken at deviceScaleFactor 1.
