# Clear keeps a data mart, rules are visible, cards say how much matches

## Decisions (the user's)

1. Clear only unticks. A joined data mart whose last column is unticked stays in the report with no columns. Remove from report is the only way out.
2. The empty mart is kept everywhere: grid state, Undo and Redo, the saved view, the view link.
3. Its filters and slices stay and keep being sent.
4. The data mart rows of the config menu show filter, slice and aggregation icons before the `>` when active.
5. The filter and slice badges leave the data mart title cell of the grid.
6. Filter, slice and aggregation badges sit next to the config icon, "{icon} 2 filters". A click lists the fields: first "{trash} Remove filters", a separator, then "{mart icon} {mart name} · {field name}" per field.
7. Data mart cards of the report show "12% match" next to "12.3K records" while a filter or slice applies. Never 100%. The percent is the filtered unique count divided by the card's total.

Hover on a field row still opens its editor, as today's list does. A column's (?) follows its title (done in 1331fd2).

## Facts

1. The backend joins a mart that only a filter or slice names. A slice is a LEFT JOIN filter: it never drops main rows.
2. `uniqueCount: ['', 'a', 'a.b']` with no `column` returns one row. A blended filter or slice needs an explicit `column` list (`withCounter` and `counter` in `src/charts/queries.ts` do this for charts; reuse that approach).

## Global rules

1. Tests first. Vitest: `npx vitest run --maxWorkers=4 <files>`. E2E: `--workers=1 --trace off`. Lint: `npx eslint src e2e`.
2. `src/sdk/sdk-decision.test.ts` fails on a clean checkout here (the SDK package is not installed), and so do `e2e/main-mart-slow.spec.ts`, `e2e/sankey.spec.ts:50` and `e2e/smoke.spec.ts:315`. Do not touch them.
3. Work only in this worktree. No new dependency. Code comments say what the code does in plain words, no em dashes.
4. Commit each task. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: the empty paths in the state

`GridState.emptyPaths?: string[]` (`src/state/store.tsx`): alias paths of joined marts kept with no column. Absent when none. Never holds a path that has a column in `columns`, and never `''`.

1. New `src/model/empty-paths.ts`: `keepEmpty(paths, schema, columns)`: first occurrence wins, only paths some schema field is joined by, without a column in `columns`.
2. `src/state/join-plan.ts`: `joinedMartIds`, `joinedPaths` and `inUsePaths` take an optional last argument `empty: readonly string[] = []` whose marts and paths come after those with columns. Every grid-based caller in `join-plan.ts` passes `grid.emptyPaths`.
3. `withoutPaths` and `withoutMart` drop the removed paths from `emptyPaths` (a grid that only has the path as empty counts as touched). `planAddAt` drops the path it adds. `planRejoin` maps them through `moves`. `planClick` on the main mart and `planMakeMain` carry an empty joined mart to the new main as empty, at the path `sourceOfMart` picks when the new main can join it; they never give it columns. An empty mart that becomes the main one opens with its own grid columns.
4. `src/state/join-tree.ts`: `buildJoinTree(mainId, columns, sources, empty = [])`. An empty path is a node with `empty: true` and not `bare`; middle marts above it are `bare` as today. Removing an empty node removes only its path.
5. Persist and prune exactly where `uniqueCount` is: `SavedView` and `encodeView`/`validView` in `src/api/grid-columns.ts` (key `ep`), `src/state/view-link.ts` (key `ep`, same cap, unsafe-name and duplicate checks, dropped entries not counted as aggregations but as columns), `pruneGrid` in `src/state/view-link-resolve.ts` through `keepEmpty`. Old documents and links load unchanged.
6. Callers outside the grid pass the empty paths: `src/ui/App.tsx`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/useCardClick.ts`.

Tests: each function with an empty path; a round trip through the saved view and the link; an old document; a path that is no longer offered.

## Task 2: the grid and the config menu

1. `MartGrid.tsx`: hold `emptyPaths` beside `uc`: seeded, late-view merge, Undo, `stable`, saved view, emitted grid. While the joined marts are unread, keep it as it is (as `uc` does).
2. `changeColumns`: a joined path that loses its last column becomes empty, from any way of hiding it (Clear, untick, Hide column). Its columns' sorts, aggregations, HAVING filters and Unique Count go, as for any hidden column. Its other filters and slices stay. It does not save an empty pick. It still calls `saveLastShown` with what the mart was showing. A path that gets a column leaves `emptyPaths`.
3. `inUsePaths`, `joinedMartIds`, `joinedPaths` and `buildJoinTree` calls pass the empty paths. A filter or slice on a field of an empty mart no longer adds a column.
4. Config menu: an empty mart is listed with the report's marts (`shown: true`), has Remove from report, and has no Unique Count row. `several` counts empty marts for the main mart's Remove. The main mart's last own column stays locked only while another mart has columns.
5. Delete the pending-empty code: `PendingEmpties`, `PendingEmptiesContext`, `hold`/`release`/`settle`, `emptied`, `flush`, `settleSoon`. Clear commits at once.
6. Remove from report on an empty mart takes its filters and slices with it (`withoutPaths` already does for a mart with columns).
7. Charts: an empty mart's fields are listed in the chart menus as a path mart's are (`pathMarts`).
8. Check `src/datamart/build-sql.ts`, `src/api/exports.ts` and the AI prompt with a filter on a field of an empty mart: the filter must still apply or be reported the way it is for a hidden field today. Add a test.

Tests: replace the ones that assert the old pending behaviour. Clear keeps the mart and its filters; tick again brings it back as a column; Remove drops it; one Undo reverts a Clear; a reload keeps it.

## Task 3: rules are visible

1. `ConfigMenu` rows (the report's marts and Joinable Data Marts): Funnel, Layers and Sigma before the arrow when a field of that mart has a filter, a slice, an aggregation or date bucket. They are in the row's `aria-description` ("Filtered", "Sliced", "Aggregated"). `Row` gets a `marks` slot. Live, not frozen.
2. Remove `MartRuleBadges` (and `BadgeRow` and `badgeReserve` when nothing uses them) from the group header cell, with its CSS and tests.
3. New `RuleBadges` next to the config button, rendered by `renderConfig` so Table and Charts both have it: "{Funnel} 2 filters", "{Layers} 1 slice", "{Sigma} 3 aggregations", each only when above 0, always with its label. A count is of fields, over every mart of the grid. Applied and parked filters both count.
4. A click opens the list: Row "Remove filters" / "Remove slices" / "Remove aggregations" with a trash glyph, a separator, then one row per field: the mart icon as glyph, label `${mart title} · ${field label}`, the (?) when the field has a description. Order: the marts in grid order, fields in schema order. Mart titles are `pathTitle`s, so two paths read apart. Hover, Right or click opens that field's editor: `RuleEditor` for filter and slice, the Aggregation editor for an aggregation.
5. Remove clears every rule of that kind in one Undo step, closes the list and focuses the config button (or the next badge). Removing filters includes HAVING filters; removing aggregations drops the HAVING filters that hang on them (`applyAgg` does). Removing aggregations leaves Unique Count alone.
6. A list whose rules are all gone (Undo) closes.

## Task 4: "12% match" on the cards

1. `matchQuery(paths, filter, counter)` next to `scorecardsQuery`: one query, `uniqueCount` of every report mart with a usable key (`''` when `hasPrimaryKey(native)`, a joined path when `source.uniqueCount`), the grid's filters and slices without HAVING, the `counter` column when a blended filter needs an explicit list. With HAVING filters or filters on calculated metrics only, no badge.
2. The read is made only while a filter or a slice is complete and applies; it is debounced with the grid's own change, aborted on a newer one, and cached by its query in memory. A failure shows no badge.
3. The card's badge is after the count badge: `floor(100 * matched / total)` + "% match". Nothing at `matched >= total`, when the total is unknown, or when the total is 0. Above 0 and below 1: "<1% match". 0: "0% match". Tooltip: "1,480 of 12,300 records match the filters and slices".
4. Both views (Grid cards and Graph). A mart joined at two paths shows its own path's number on the Graph, and no badge on the Grid card.

## Task 5: README and e2e

README "Config menu" and the card section say all of the above. E2E: Clear keeps the mart with its filter after a reload, Remove drops it; a badge lists and removes filters; a filtered card shows "% match". Update e2e specs that used the title cell badges.
