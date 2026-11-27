# Main data mart may show no columns

**Spec (the member's words):** "If you Clear selected fields → don't show them. If you add a data mart → show default ones."

Today Clear on the main data mart's field list in the config menu does nothing while a joined data mart has columns:
`MartFields.apply` drops the main mart's own columns, then `orderColumns(..., fallbackOwn)` puts the main mart's
`defaultColumns` back (they are the same five fields), so the grid is unchanged.

## Global Constraints

1. The main data mart is always in the report whether or not it has a column: `inUsePaths` already always holds `''`. No new grid-state field, no change to `emptyPaths` (it never holds `''`), the saved view or the view link.
2. The main mart's default columns are added only when a data mart becomes the main one (a click that makes it main, a promotion, Make it main, a drop onto the main card): `planClick`'s promote branch (`src/state/join-plan.ts` ~line 299) and the make-main plan (~line 370) keep `env.ownColumns(...)` as `fallbackOwn`.
3. Everywhere else a column list with joined columns and none of the main mart's own stays that way: no fallback. That is `MartGrid.tsx` (the `shown` memo ~line 328 and `changeColumns` ~line 468), `SeededGrid.tsx` (~lines 71 and 131), `planAddAt` (~line 400) and the joinable branch of `planClick` (adding a joined mart while the main mart has no column keeps it with none; the added mart gets its own defaults as today).
4. A grid never has zero columns: Clear with no other mart's columns still keeps the first column (`visible.slice(0, 1)`), and a sole visible column stays disabled.
5. Remove the rule "the last own column of the main data mart cannot be unticked while a joined one is shown" (`locked` in `MartGrid.tsx` ~line 601): it existed only because the main mart could not be empty.
6. The config menu lists the main data mart first, with its fields panel, Unique Count row and Remove from report, also while it has no column. Today `configMarts` is built from the grid's column groups, which have no main group when the main mart has no column.
7. Writing style: comments and README follow the existing terse style. No em dashes in new text.
8. Tests: vitest with `--maxWorkers=4` always (machine overheats). `npx tsc --noEmit -p .` clean. `npx eslint` on touched files clean.

## Task 1: Let the main data mart show no columns

**Files:** `src/state/column-order.ts`, `src/state/join-plan.ts`, `src/ui/explorer/MartGrid.tsx`, `src/ui/explorer/SeededGrid.tsx`, `src/ui/explorer/MartFields.tsx`, their tests, `README.md`.

1. Apply Global Constraints 2-6.
2. If `orderColumns`' `fallbackOwn` parameter ends up used only by the promote paths, keep the parameter; update its doc comment to say it is for a mart becoming main.
3. Check every consumer of the grid's column groups that assumes "the first group is always the main one" (group header row, tabs, `several`, `remove` for the main mart, Unique Count placement after the main mart's own columns, card-count reuse conditions) still behaves when the main mart has no column. Fix what breaks; leave what works.
4. Tests (add or change, TDD where practical):
   1. `MartFields`: Clear on the main mart while another mart has columns calls `onChange` with only the other marts' columns.
   2. `MartFields`: Clear on the main mart with no other columns still keeps the first column.
   3. Integration (`ConfigMenu.test.tsx` or `joined-columns.test.tsx`, whichever already renders a grid with a joined mart): Clear on the main mart leaves only the joined columns on the grid; the config menu still lists the main mart first and its panel opens; ticking a main field brings it back.
   4. Unticking the main mart's last own column while a joined mart is shown is allowed (replace the test of the removed `locked` rule).
   5. `column-order.test.ts`: update the fallback test so it reflects the new contract.
   6. A test that a restored column list with no main-mart column (`SeededGrid`) stays without one.
   7. A test that adding a joined data mart (`planAddAt` / card click) while the main mart has no column does not add the main mart's defaults.
5. README: update the sentences that describe the old rule (section numbers 5 and 6 of the joined-marts list: "applied on ... a restore of saved columns"; "The last own column of the main data mart cannot be unticked while a joined one is shown"; and in the config-menu paragraph "Clear never leaves the grid without a column"). Say: the main data mart stays in the report with no columns after Clear or unticking its last one; its default columns come only when a data mart becomes the main one.
6. Run the full `src` test suite (`npx vitest run --maxWorkers=4`), tsc and eslint on touched files.

## Task 2: A filter or slice adds no column

**Spec (the member's words):** "Show columns in the Data section only if they are marked by the checkbox to be shown, not when a filter / slice is applied."

**Files:** `src/ui/explorer/MartGrid.tsx` (the rule handlers, `joinColumns` / `joinWith` ~lines 680-695), its tests, `README.md`.

1. `setFilter` / `setSlice` on a field of a joined data mart that is not in the report (no column, not in `emptyPaths`) joins the mart with no column: its alias path goes into `emptyPaths` (the same state Clear on a joined mart leaves), in the same edit as the rule, so one Undo takes both back. No column is added.
2. A filter on a field of the main mart, or of a mart already in the report, adds nothing (unchanged).
3. A filter set from a chart (`applyChartFilters`) follows the same rule: no column, and a mart not in the report joins with none.
4. Sort, Aggregate and Format on a hidden field still show it (unchanged).
5. Tests: filter on a field of a mart not in the report → mart in `emptyPaths`, columns unchanged, the query carries the filter, Undo removes both; same for a slice. Replace tests asserting the old column-adding behaviour.
6. README: replace "Ticking a field of a data mart that is not in the report joins it, and so does a filter or slice set from one of its fields" and any sentence saying a rule on a mart with no column adds its field, with the new behaviour.

## Task 3: Charts use any field of the report's data marts and add no column

**Spec (member's choice):** charts can use any field of the report's data marts; picking a field in a chart adds no column. Scorecards stay one card per shown metric.

**Files:** `src/charts/ChartsBody.tsx`, `src/charts/fields.ts`, `src/charts/kinds/*`, `src/charts/*` menus as needed, `src/ui/explorer/MartGrid.tsx` (`showColumns` prop use), tests, `README.md`.

1. Chart eligibility (Add chart list), `resolve`, and the default charts draw from every field of the report's data marts: the main mart, the joined marts in the report (with a column or kept empty), and the marts on their paths, i.e. what `cf.menu` lists today. With no date shown, Time series and Line are offered when the marts have a date and a measure.
2. The scorecards (Records + one card per metric) and the sparkline date default stay on the shown columns (`cf` as today). Spell out in a code comment which set each consumer uses.
3. Picking a field in a chart's menu or a scorecard's menu that is not a column adds no column: remove `showPicked` / `showCardPick` column adds and the `onShowColumns` prop if nothing else uses it; drop `ruleNewColumns` if it becomes unused.
4. A hidden metric's function in a chart: the function the grid's aggregation has for it, else `metricFn`'s default (SUM when allowed), as `chartFields` does today.
5. A chart reads with the grid's filters and slices as today. Check the chart query builders accept a field that is not a grid column (they build their own `traverseData` query); fix if not.
6. Tests: with no date column shown, Add chart lists Time series and the time series draws on a mart date; picking a hidden field in a chart menu leaves the grid columns unchanged; scorecards still list only shown metrics.
7. README: update the Charts paragraph ("Add chart ... lists the kinds the shown columns can draw") and any sentence saying a chart pick shows a column.
