# Search dropdown: reports, data marts and an ad-hoc report

Date: 2026-11-19. Status: approved in chat.

This is the first of three pieces of work. The other two get their own specs:

1. Search dropdown (this spec).
2. Filter and Slice. It copies the OWOX Sheets extension (`owox-data-marts-spreadsheets`, `ReportColumnPicker`). The column's Funnel opens a popover with Filter and Slice tabs. A slice is a pre-join filter (`placement: 'pre-join'`) on a joined mart's field and uses the lucide `Layers` icon. HAVING filters (`function` set) from a loaded report can be shown, edited and removed, but not created. Copy SQL and Create Data Mart follow the same rules.
3. Unique count as a column the field picker and the column dropdown offer.

Until pieces 2 and 3 ship, a loaded report skips its slices, HAVING filters and unique count, and says so.

## Goal

The member types a request and sees, in one dropdown:

1. The saved reports that match.
2. The data marts that match.
3. An ad-hoc report built for the request.

Enter with nothing highlighted runs the ad-hoc report. Picking a report opens its data mart with the report's columns, filters, sorts and aggregations.

## Today

1. `src/search/endpoint.ts` calls `/api/search` with `entityTypes=DATA_MART` and returns mart ids.
2. `src/search/run.ts` (`smartSearch`) runs the search, then the AI discovery fallback, then one AI view question (`viewQuestion`, parsed by `parseAiView`).
3. `src/ui/bands/useSmartSearch.ts` runs on submit only and makes the best mart the main one.
4. `src/ui/bands/SearchBox.tsx` has no results list.
5. Nothing reads a saved report back into the explorer. `buildReportPayload` in `src/api/exports.ts` only writes one.

## Fetching while typing

1. Once typing pauses for 300 ms and the trimmed draft has at least 2 characters, the hook calls `/api/search` with `q`, `entityTypes=DATA_MART,REPORT`, `excludeDrafts=true` and `limit=20`.
2. A new keystroke aborts the request in flight and any AI call 1 (below) that belongs to it.
3. Under 2 characters the dropdown shows only the ad-hoc row, disabled, with "Type at least 2 characters". Enter keeps today's title-only match.
4. The backend sends report items with `entityType: 'REPORT'`, `entityId`, `title`, `finalScore` and `report: { dataMart: { id, title } }`. Mart items have `entityType: 'DATA_MART'`. The parser trusts nothing: an item without a string id, or one whose mart is not `accessible` in the model, is dropped.
5. `searchEndpoint` returns `{ reports: ReportHit[]; marts: string[] }`, each best first by `finalScore`. Equal scores keep the engine's order.
   1. `ReportHit` is `{ id, title, martId }`.
   2. There are at most 5 of each.
6. A failed request gives empty lists, as today.

## Rows

Rows appear in this order. Reports and marts keep their score order.

1. Report rows, up to 5. Icon `FileSpreadsheet`, report title, "of", the mart's `PickedIcon` and title, then the contexts.
2. Data mart rows, up to 5. The mart's `PickedIcon` and title, then the contexts.
3. One ad-hoc row, always last. Icon `Sparkles`, then "Ad-hoc report for", the mart's `PickedIcon` and title, then the contexts, then "with", `Funnel` and "filters".

**Contexts.** "from" followed by the first 3 of the mart's `contextIds` that exist in `model.contexts`, in that order. Each has its `PickedIcon` (default `Tags`) and name. Two are joined with "&", three as "A, B & C". A mart with no context shows no "from" part. A report uses its mart's contexts.

**Ad-hoc mart before the AI answers.** While AI call 1 runs, the mart part of the ad-hoc row shows a spinner. Without AI, or when call 1 fails or names nothing, the mart is:

1. the first mart hit;
2. otherwise the first report hit's mart.

With no mart at all the ad-hoc row is disabled and reads "No data mart found".

The ad-hoc row has no filter count. Filters are not known until the member picks the row.

## AI calls

| # | Call | Runs | Answer |
|---|---|---|---|
| 1 | `discoveryQuestion` | After `/api/search` returns, for that query | `{ ids }`. The first accessible id is the ad-hoc mart. |
| 2 | `fieldsQuestion` (new) | After the ad-hoc row is picked | `{ columns, aggregations, dateTrunc }` |
| 3 | `filtersQuestion` (new) | After call 2, which it receives as `columns` | `{ filters, sorts }` |

1. Call 1 gets the search hits as hints. They go in the user JSON as `searchHits: [{ id, title }]` (marts, then reports' marts, no repeats), and the system prompt says to prefer them when they fit.
2. Calls 2 and 3 never run before a pick. A test checks this.
3. `viewQuestion` and `parseAiView` are replaced:
   1. `fieldsQuestion` uses the same rules for columns, aggregations and dateTrunc.
   2. `filtersQuestion` uses the same rules for filters and sorts. Sorts may name only the columns from call 2.
   3. `parseAiView(raw, schema)` becomes `parseAiFields(raw, schema)` and `parseAiFilters(raw, schema, columns)`. Both keep today's validation and merge into one `GridState` that goes through `pruneGrid`.
4. `ai.ts` roles become `'discover' | 'fields' | 'filters'`.
   1. Call 1 is one `createAiRun` with role `discover`, which prefers the fast model.
   2. Calls 2 and 3 share a second run. `fields` and `filters` prefer the reasoning model, and their shares of the budget must leave call 3 time after call 2.
5. Without AI (`pickModels(ctx) === null`) none of the three run, and `AiHint` behaves as today.

## Keyboard and accessibility

1. The input is a combobox (`role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`). The list is a `listbox` and each row is an `option`. A disabled row has `aria-disabled` and is skipped by the arrows.
2. ↑ and ↓ move the highlight, wrapping. Typing clears the highlight.
3. Enter with nothing highlighted runs the ad-hoc row. Enter on a highlighted row picks it. The go button runs the ad-hoc row.
4. A click picks a row.
5. Escape closes the dropdown first, and the box on a second press.
6. The dropdown closes after a pick. The box then shows the applied query chip, as today.

## Picking a row

Every pick dispatches `smartFound { query, ids }`, where `ids` are the mart hits (or the picked mart when there are none). The band keeps showing what the search found.

### Report

1. `GET /api/reports/:id` loads the report. The mart's schema comes from `withJoined(schemas.get(martId), blendable.get(martId))`, as `useViewLink` does.
2. `reportToGrid(report, schema, nativeSchema)` in the new `src/search/report-load.ts` returns `{ grid: GridState | null; skipped: ReportSkipped }`.
   1. `columnConfig` becomes `columns`. If it is null or empty, `defaultColumns(nativeSchema)` is used.
   2. `sortConfig` becomes `sorts` (`column` to `field`).
   3. `aggregationConfig` and `dateTruncConfig` map one-to-one. A `dateTrunc` `timeZone` is kept when the explorer's rule type has one, else dropped.
   4. Each rule in `filterConfig` goes through the new `fromTraverseFilter(rule, field)`, the inverse of `toTraverseFilter`:
      1. `eq` on a day-type date field becomes `on`. On another date or time field, `lt` becomes `before` and `gt` becomes `after`.
      2. `relative_date` becomes `relative`.
      3. `between` on a date-time field whose bounds are `YYYY-MM-DD 00:00:00` and `YYYY-MM-DD 23:59:59` becomes a date-only range. Other bounds are kept.
      4. Every other operator must be in `operatorsFor(field)` with a value of the right shape. If it isn't, the filter is skipped and counted.
      5. A second filter on the same field is skipped and counted. `GridState.filters` holds one per field.
   5. These are skipped and counted, until pieces 2 and 3 ship:
      1. a rule with `placement: 'pre-join'` (a slice);
      2. a rule with `function` set (a HAVING filter);
      3. a non-empty `uniqueCountConfig`.
   6. `limitConfig` is ignored and not counted. `limit` is `PAGE_SIZE`.
   7. The grid then goes through `pruneGrid`, and what it drops is counted too.
3. One `setMarts { selection: { sourceKey, martId, record: null }, grids: { [martId]: grid } }` applies it, so one Undo takes it back. `sourceKey` is kept only when it still feeds the mart, as `useSmartSearch` does today. When `grid` is null, `selectMart` runs instead.
4. If anything was skipped, a notice under the search box says so, for example "Some parts of this report aren't shown: 1 slice, 2 filters, unique count." The member can dismiss it, and the next search clears it.
5. If the request fails, nothing changes and the notice reads "This report couldn't be opened."

### Data mart

`selectMart` runs, as a card click would. The mart opens in its default or remembered view.

### Ad-hoc

1. The hook reads the mart's native schema. `setMarts` then makes the mart the main one with the grid `{ columns: defaultColumns(schema), filters: {}, sorts: null, limit: PAGE_SIZE }`. That is the one Undo step.
2. If AI is configured, calls 2 and 3 run. Each result is stored with `saveGrid`, which adds no history entry, so one Undo still goes back to before the pick. The box shows the busy spinner meanwhile.
3. If the member edits the grid, picks another row or searches again before an answer arrives, the answer is dropped.
4. If call 2 or 3 fails, the mart stays in its default view. The notice reads "AI couldn't set up the view. Showing the default view."
5. Without AI the ad-hoc pick stops at step 1.

## Files

1. `src/search/endpoint.ts`: typed hits, both entity types, new limits.
2. `src/search/prompts.ts`: `discoveryQuestion` takes hints; `fieldsQuestion` and `filtersQuestion` replace `viewQuestion`.
3. `src/search/view.ts`: `parseAiFields` and `parseAiFilters` replace `parseAiView`.
4. `src/search/ai.ts`: the new roles.
5. `src/search/run.ts`: `smartSearch` is replaced by two functions. `findAdhocMart` is call 1 and its fallbacks. `buildAdhocView` is calls 2 and 3.
6. `src/search/report-load.ts` (new): `reportToGrid`, `fromTraverseFilter` and the skipped-notice text.
7. `src/ui/bands/useSmartSearch.ts`: debounced fetching, the rows, the highlight, the picks and the notice.
8. `src/ui/bands/SearchResults.tsx` (new): the listbox and its rows.
9. `src/ui/bands/SearchBox.tsx`: combobox wiring, the keyboard and the dropdown.
10. CSS next to the existing `dm-search` styles.
11. Mock: `src/sdk/mock/search.ts` returns report items as the backend does (`kwScore`, `vecScore`, `report.dataMart`). The mock serves `GET /api/reports/:id` for fixture reports, including one with a slice, a HAVING filter and unique count.

## Tests

1. `endpoint.test.ts`: both types requested; reports and marts parsed, ranked and capped; inaccessible marts and their reports dropped.
2. `report-load.test.ts`:
   1. Round trip. `buildReportPayload(grid)` fed to `reportToGrid` gives the same grid, for plain, date, relative, between and grouped grids.
   2. Each skipped kind is counted.
   3. Null `columnConfig` gives default columns.
3. `prompts.test.ts` and `view.test.ts`: the new questions and parsers.
4. `run.test.ts`:
   1. Call 1 picks the mart.
   2. It falls back without AI and on failure.
   3. A newer query aborts an older call 1.
5. `smart-search.test.tsx`:
   1. Rows render in order with contexts ("A, B & C", at most 3).
   2. The keyboard works: arrows, Enter with no highlight runs ad-hoc, Enter on a row picks it, Escape.
   3. Calls 2 and 3 never run before a pick.
   4. A report pick applies filters and sorts in one Undo step and shows the skipped notice.
   5. An ad-hoc pick is one Undo step even after the AI fills in.
   6. A member edit before the AI answers wins.
6. e2e (`e2e/smoke.spec.ts` or a new spec): type a query, pick a report, and the grid shows its filter.
