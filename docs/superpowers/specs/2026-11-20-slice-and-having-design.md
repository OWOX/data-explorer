# Slices and HAVING filters in the explorer

Date: 2026-11-20. Status: approved in chat. This branch is stacked on #45 (search dropdown).

The model is the OWOX Sheets extension (`owox-data-marts-spreadsheets`, `src/features/reports/components/ReportColumnPicker`, v0.19.3). It has two kinds of rule that a member can create:

1. A **filter**, applied after the joins. This is today's explorer filter.
2. A **slice**, a pre-join filter (`placement: 'pre-join'`) on a joined data mart's field. It narrows that mart's rows before they are joined in.

It also keeps **HAVING filters**: a filter with `function` set, for example `SUM(net_revenue) > 100`. The extension shows, edits and removes a HAVING filter it loaded from a report, but cannot create one. The explorer does the same.

## Backend contract

The contract is already live and needs no backend change. Sources: `owox-data-marts/apps/backend/src/data-marts/dto/schemas/filter-config.schema.ts`, `.../blending/blended-filter-partition.ts`, `.../services/output-controls-validator.service.ts`.

1. A slice is a filter rule `{ column, operator, value?, placement: 'pre-join' }`. `column` is the blended (unified) field name, for example `customers__country_code`, which is the explorer's `Field.name` for a joined field.
2. The backend casts a slice's value by the field's raw pre-join type (`sourceFieldType ?? type`).
3. A slice on a non-joined (main) mart field is a 400. A slice with `function` set is a 400.
4. Slices need an explicit column list. The grid and the export always send one.
5. A HAVING filter is `{ column, operator, value, function }`. The `(column, function)` pair must match an aggregation the query sends. It has no `placement` (post-join).
6. `traverseData` takes the same rules in `filter` (`@owox/api-client` `TraverseDataFilterPlacement`). The explorer's own `TraverseFilter` type (`src/sdk/types.ts`) widens to carry `placement?` and `function?`.

## State

1. `GridState` gains `slices?: Record<string, ColumnFilter>`, keyed by field name, one slice per joined field. It is absent or `{}` when there are none. `filters` stays as it is.
2. `ColumnFilter` gains an optional `fn?: AggFn`. A filter with `fn` is a HAVING filter on that column's aggregate. Only filters carry `fn`; slices never do.
3. Every place that copies, compares, prunes, parks, resets or encodes `filters` does the same for `slices`. That covers the MartGrid change detection (`stable`), parked filters, Reset, Undo entries (they hold whole grids already), join-plan pruning and renaming (`src/state/join-plan.ts`), leaving joined marts (`src/state/leaving.ts`), card-click initialisers, view-link resolve pruning, and the AI view merge.
4. A slice on a field that is no longer offered is parked, as filters are.
5. A HAVING filter whose `(column, fn)` aggregation is removed is dropped in the same step, as the extension's `withoutHavingFiltersOrphanedBy` does. The same applies when the column itself is hidden.

## The slice field

`sliceField(field: Field): Field` (in `src/filters/`) returns the field typed by its raw pre-join type: `type = field.joined?.sourceType ?? field.type`, and `category` re-derived from that type with the existing categorizer. Every slice uses this field for `operatorsFor`, `isComplete`, `toTraverseFilter`, `describeFilter` and the editor. It is the extension's `getRawFieldType`.

## Turning rules into queries

1. `toTraverseFilters(schema, filters, slices?)` returns, in order, the complete filters and then the complete slices.
   1. A slice becomes `{ ...toTraverseFilter(f, sliceField(field)), placement: 'pre-join' }`, and only when `field.joined` is set. A slice on a main-mart field is dropped.
   2. A filter with `fn` becomes `{ ...toTraverseFilter(f, havingField), function: fn }`, where `havingField` types the value by the aggregate's result: numeric for COUNT, COUNT_DISTINCT, SUM, AVG and percentiles, and the column's own type for MIN, MAX and ANY_VALUE. It is sent only when the query's aggregations contain `(column, fn)`. Otherwise it is dropped.
2. Every consumer goes through it, so they all gain slices and HAVING:
   1. the grid rows (`buildRowQuery`, `buildGroupedQuery` in `src/ui/explorer/useMartRows.ts`);
   2. charts (`MartGrid` `traverseFilters`);
   3. the Sheets export (`buildReportPayload`, `filterConfig`);
   4. Copy SQL, which reads the run of the grid's own query.
   The export cap `MAX_EXPORT_FILTERS` counts filters and slices together.
3. Create Data Mart (`src/datamart/build-sql.ts`) builds its own SQL:
   1. A slice on alias path P becomes a predicate on P's raw mart rows wherever P is read: inside P's dedup CTE (`FROM <mart P> AS t WHERE <slice on t.<originalName>>`) and in every raw join of P that a sleeve uses (`LEFT JOIN (SELECT * FROM <mart P> WHERE ...)` or an extra `AND` in the `ON`). Use the dialect's `renderFilter` with the raw column reference and `sliceField(field)`. The result is a LEFT JOIN that keeps the main rows and empties P's columns where the slice fails. It does not filter main rows out.
   2. A HAVING filter becomes `HAVING <aggregate expression> <op> <value>` on the grouped query, using the same aggregate expression the SELECT uses for `(column, fn)`. A HAVING filter in an ungrouped query is dropped. That case can't happen, because the filter is dropped along with its aggregation.
   3. The golden files in `src/datamart/__golden__` gain cases for one slice and one HAVING filter.
4. The view link (`src/state/view-link.ts`) adds a key `sl` with the same tuple shape as `fl`, and a fourth tuple slot for `fn` in `fl`. Old links decode unchanged. The resolver prunes slices like filters, and a slice on a non-joined field is skipped.
5. The AI prompt context (`src/api/ai-prompt.ts`) lists slices under their own "Slices (before the join):" heading, and HAVING filters as "SUM(net_revenue) > 100".

## Report load (`src/search/report-load.ts`)

1. A rule with `placement: 'pre-join'` loads into `slices` through `fromTraverseFilter(rule, sliceField(field))`, when the field is joined. Otherwise it is skipped and counted under `slices`.
2. A rule with `function` loads into `filters` with `fn`, when `(column, function)` is in the report's `aggregationConfig`. Otherwise it is skipped and counted under `having`.
3. The round trip `buildReportPayload` → `reportToGrid` keeps slices and HAVING filters.

## Column menu

1. The root menu (`ColumnMenu.tsx`) gets a **Slice** row directly under **Filter**, with the lucide `Layers` icon, only when `field.joined` is set. It is active when the field has a slice.
2. The Slice submenu is a `Panel` like Filter's, labelled "Slice of {title}". It holds the `FilterEditor` for `sliceField(field)`, with this banner above it: "Slices filter the joined data mart before it is joined, reducing the rows pulled in." Apply and Clear set or remove the slice.
3. The Filter editor on a HAVING filter shows the note "Filters the {FN} after grouping" (the extension's `havingFilterNote` wording, with the function's label). It edits the condition only, and the rule keeps its `fn`. The value input is numeric for the numeric-result functions.
4. Column header (`ColumnControls`):
   1. An active slice shows a `Layers` button next to the Funnel, with the tooltip "Slice: {describeFilter}". Clicking it opens the Slice submenu.
   2. A HAVING filter's Funnel tooltip reads "Filter: SUM greater than 100".
   3. A slice also counts toward `active`.
5. A submenu switches after `HOVER_MS`, as the other rows do.

## Mock (`src/sdk/mock/ctx.ts`)

1. `traverseData` applies a slice as a LEFT JOIN would: on a row whose joined values for that alias path fail the slice, every field of that alias path (and of its descendants) becomes null. No row is removed.
2. A HAVING filter is applied to the grouped rows, on the aggregate's output column.
3. A slice on a main-mart field, or with `function`, throws a 400-shaped error, as the backend does.

## Tests

1. Unit tests:
   1. `sliceField`.
   2. `toTraverseFilters` with slices and HAVING, including dropping a HAVING filter without its aggregation and a slice on a main field.
   3. The view-link round trip, and decoding old links.
   4. Report-load round trips.
   5. HAVING orphan removal.
   6. Join-plan pruning of slices.
   7. The mock's slice and HAVING semantics.
   8. Create Data Mart golden cases.
   9. The column menu: the Slice row only on joined columns; apply, clear and the header icon; the HAVING note and edit.
2. e2e: open `orders`, join `customers`, add a slice on a customers field, and check that the joined column empties on rows whose customer fails it while the row count stays the same.
