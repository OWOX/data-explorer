# Grid: Unique Count as a data mart metric

Spec: the user's request in chat (2026-11-22). A data mart's primary key, hidden for reporting or not, is a property of the
data mart: the grid offers a data-mart-level **Unique Count** metric (the backend's `uniqueCount` option, `''` for the main
mart, an alias path for a joined one), the same way Charts, the OWOX web app and the OWOX Google Sheets extension do. The
column-level function **Count Unique** (`COUNT_DISTINCT` on a column) stays as it is, for any column that allows it.

## Global constraints

1. Labels follow OWOX: the data-mart-level metric is "Unique Count" (OWOX web `UNIQUE_COUNT_LABEL`); the column function
   stays "Count Unique" (`AGG_LABELS.COUNT_DISTINCT`).
2. Fields hidden for reporting are still never named in a column, filter or sort. The Unique Count metric names no field:
   it is sent as `uniqueCount: ['']` (main) or `uniqueCount: ['<aliasPath>']` (joined).
3. Availability: main mart when `hasPrimaryKey(native)` (src/records/relationships.ts, hidden key included); a joined mart
   when its blendable source has `uniqueCount: true` (src/api/blendable.ts).
4. Row keys of the answer: `uniqueKey(aliasPath)` in src/charts/queries.ts (`'Unique Count'` for the main mart,
   `<path with dots as _>__unique_count` for a joined one). Reuse it, do not redefine it.
5. Tests: Vitest with `--maxWorkers=4`, never more. Playwright e2e with `--trace off`.
6. Code comments follow the repo's existing style (full sentences, no em dashes in new text).

## Task 1: Unique Count metric in the Data grid

1. **State.** `GridState` (src/state/store.tsx) gains `uniqueCount?: string[]`, the alias paths whose Unique Count is on
   (`''` = main). Absent or empty means none. It is part of the grid state, so Undo, the member's saved view
   (src/api/grid-columns.ts) and the view link (src/state/view-link.ts, view-link-resolve.ts) carry it. Old saved views and
   links without it keep working. A path whose metric is no longer available is dropped when the grid is resolved, as an
   unavailable column is.
2. **Grouping.** A Unique Count groups the rows like any aggregation: everywhere the grid decides "grouped" from
   aggregations/dateTrunc (`isGrouped` in src/model/aggregation.ts and its callers), a non-empty `uniqueCount` counts too.
   With only Unique Count on and no other column rule, the shown columns become group keys, as with a column function.
3. **Query.** The grid's rows query (`buildRowQuery`, src/filters/build.ts, and src/ui/explorer/useMartRows.ts) sends
   `uniqueCount` when the state has it.
4. **Display.** Each Unique Count is a read-only numeric column in the grid, headed "Unique Count", shown in its mart's
   column group (after that mart's own columns), and it can be sorted (sort column = its row key). Its header menu offers
   removing it. It takes no filter and no function.
5. **Fields picker.** In src/ui/explorer/ColumnPicker.tsx the lead row becomes "Unique Count" and toggles the mart's
   metric (main or joined tab), shown whenever the metric is available (constraint 3), including a hidden key and a
   composite key. It no longer ticks the key column with `COUNT_DISTINCT`. The key column's own function menu still
   offers "Count Unique" when the field allows it.
6. **Export and reports.** The Sheets export (src/api/exports.ts) sends `uniqueCountConfig` from the grid state (null when
   none) instead of always null. Loading a report (src/search/report-load.ts) maps `uniqueCountConfig` (`true` means
   `['']`, an array is the paths) into the grid state instead of listing it as skipped; a path the grid cannot offer is
   still reported as skipped. TSV/clipboard export (src/export/tsv.ts) includes the column with its header.
7. **Charts handoff.** Where the grid passes its state to charts (`chartFields` in MartGrid), nothing must break; the
   charts' own Count Unique stays as it is.
8. **Tests.** Cover: a hidden-key mart (fixture with `isHiddenForReporting` on `id`, see the existing test in
   src/ui/bands/page.test.tsx "a mart whose primary key is hidden for reporting...") offers Unique Count in the Fields
   picker, ticking it sends `uniqueCount: ['']` and shows a "Unique Count" column with the count, the query still names
   no hidden field, Undo takes it back; a joined mart's Unique Count sends its alias path; saved view and view link round
   trip; report load maps `uniqueCountConfig`; export sends it. Update the existing tests that relied on the lead row
   ticking the key with `COUNT_DISTINCT`.
9. **Docs.** Update README.md where it describes Count Unique in the grid.
