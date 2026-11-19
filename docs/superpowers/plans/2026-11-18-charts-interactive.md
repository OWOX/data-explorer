# Charts: every mart's measures, fixed scorecards, letter menu, click-to-filter

Date: 2026-11-18. Branch `feat/charts-interactive`.

Ground rules (all tasks): every number on screen comes from a `traverseData` query (`readRows`); the plugin never sums,
counts or buckets values itself. Tests: `npx vitest run <files>` (vitest already caps workers at 4; never raise it).
Typecheck: `npx tsc -b`. Lint: `npx eslint <files>`. Keep the code style: short JSDoc comments that say why, no
narration. Commit per task with a plain message.

## Task A: right-click a column letter opens the column menu

Files: `src/ui/explorer/MartGrid.tsx` (letter row, ~line 643), `src/ui/explorer/ColumnMenu.tsx` (`ColumnMenuEnv`,
`ColumnControls`), tests next to them (`ColumnMenu.test.tsx` or a new `letter-menu.test.tsx`).

1. `onContextMenu` on each letter `<th>` (A, B, C…) calls `preventDefault()` and opens the same root menu the green
   menu icon (`[data-menu-icon]`) of that output's header opens. Works in Table and in Charts mode.
2. No DOM `.click()` hacks: add a request to `ColumnMenuEnv` (e.g. `menuRequest: { key: string; seq: number } | null`,
   keyed by the output key, since one column can have several outputs). `ColumnControls` opens its root menu
   (anchored to its own menu icon, as a click would) when the request names its output and the seq is new.
3. Right-clicking another letter while a menu is open closes the old one and opens the new one. The outside-press
   handler must not immediately close the menu the right-click just opened.
4. Test: right-click letter B opens "Menu of <B's title>"; Escape closes it.

## Task B: scorecards and every mart's Unique Records as a measure

Files: `src/charts/fields.ts`, `queries.ts`, `settings.ts`, `Scorecards.tsx`, `TimeSeriesPanel.tsx`, `PiePanel.tsx`,
`ChartsBody.tsx`, `charts.css`, their tests.

1. Scorecard width: a card no longer stretches to fill its mart's cell. Each card is `flex: 0 1 10rem` (at most 10rem,
   may still shrink in a narrow group so it never widens the column), `min-width: 0`. Value text keeps its current
   no-truncation rule (only the label truncates).
2. Measures: `Measure`'s records kind carries the mart's alias path: `{ kind: 'records'; aliasPath: string; martId:
   string }`. The list of measures is, per chart mart in group order: its Unique Records when `hasPk`, then its metrics.
   Add a helper (e.g. `measuresOf(cf)`) used by both panels.
3. Time series "Metric" menu and the Pie "Metric" menu both offer that full list, so any mart's measure pairs with any
   mart's date / dimension. The pie keeps metrics to SUM-able ones (summed), plus every Unique Records.
4. Labels: main mart's records "Unique Records"; a joined mart's "<group title> · Unique Records". ChartMart gets a
   `title` (pass group titles into `chartFields` from `ChartsBody`; it already has `groups`).
5. Queries: `uniqueCount: [aliasPath]` and the key `uniqueKey(aliasPath)` for any mart, in top values, series, series
   Other, pie slices and pie Other (pie Other today only takes a metric: generalise it to a Measure). Sort by
   `measureKey` for records (already done for main).
6. Settings: the saved value for records stays `'records'` for the main mart (back compat); a joined mart's is
   `records:<martId>` (same as its card id, `recordsCardId`). `resolveCharts` resolves `pie.metric` the same way.
   `ResolvedCharts.pieMetric` becomes `pieMeasure: Measure | null`.
7. Pie slice value text for records: `formatNumber` like the time series does.
8. Update the spec table in `docs/superpowers/specs/2026-11-17-data-explorer-charts-design.md` (Fields, Queries,
   Saved settings) to match.

## Task C (after A and B): clicking a chart segment filters the grid

Files: `src/charts/svg/BarChart.tsx`, `svg/PieChart.tsx`, `TimeSeriesPanel.tsx`, `PiePanel.tsx`, `ChartsBody.tsx`,
`src/ui/explorer/MartGrid.tsx`, tests.

1. `ChartsBody` gets `onFilter(add: ColumnFilter[])`. In `MartGrid` it does what a filter edit does: `markEdit()`,
   merge into `filters` (one filter per column, so a new one replaces that column's), `setLimit(PAGE_SIZE)`. That makes
   it an `editGrid` step, so Undo / Redo cover it with no extra work. Verify with a test: click a slice, Undo removes
   the filter, Redo puts it back.
2. Pie slice → the dimension's filter: string `{ op: 'eq', value }`, boolean `is_true` / `is_false`. "Other" is not
   clickable (no `not_in` operator in the filter catalogue).
3. Bar: clicking a bucket filters the date column to that bucket: `{ op: 'between', value: { from, to } }` with
   `from` the bucket's start as returned (date part, `YYYY-MM-DD`) and `to` the bucket's last day (start + 1 day /
   7 days / 1 month / 3 months / 1 year, minus a day; date arithmetic on the bucket label only, never on values).
   When stacked, clicking a segment also adds the stack dimension's filter for that segment's series (not for
   "Other"). The hover band rect sits on top of the segments, so pick the segment from the pointer position in the
   band's click handler, or move the click onto segments and keep the band for the bucket-only click.
4. Pointer cursor on clickable marks; each clickable mark is keyboard reachable (`tabIndex=0`, Enter/Space) with an
   `aria-label` like "Filter to <value>".
