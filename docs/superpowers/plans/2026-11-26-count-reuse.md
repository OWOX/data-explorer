# Plan: fewer count, range and value reads

Goal: the grid's total row count, the scorecard read and the smart search's value reads answer the asks that today send their own query. Four changes, all in the plugin; no API, schema or rule change. Options 5 (HAVING keys from the grid's groups) and 6 (distinct counts across multiplying joins) were dropped by the member: `answers` in `src/charts/answers.ts` and `ownTotal` in `MartGrid.tsx` stay as they are.

## Global Constraints

1. Every `traverseData` / `readRows` call is a billed warehouse query, and `includeTotalRowCount: true` costs one more. A change may remove reads; it must never add one. The one exception is Task 2's recount on the grid's Refresh, which the member asked for (see there).
2. A reused result must be the exact answer to the new ask: same mart, same `version`, same filters, same sort, same grouping. Rows of one shape never stand in for another's (see `shapeOf` in `src/ui/explorer/useMartRows.ts`).
3. `version` busts every cache (Refresh, mart reload). Retry always reads again. A failed or aborted read is never cached.
4. Caches are per ctx (`perCtx` from `src/sdk/per-ctx.ts`), in memory, LRU by entry count, like `CHART_CACHE_LIMIT` in `src/charts/useChartQuery.ts`.
5. Tests: Vitest, `npx vitest run <files> --maxWorkers=4` (this Vitest version rejects `--poolOptions`). Never run Vitest without the worker cap. `npx tsc -b` and `npx eslint <changed files>` must pass.
6. Comments and README text follow the repo's existing style: plain, short sentences, no marketing words.
7. Commit per task, message in the repo's style (a plain sentence summary line). End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
8. Run the tasks in order, one at a time. Tasks 1, 2 and 4 all edit `src/ui/explorer/MartGrid.tsx`; Tasks 2 and 4 both edit `src/ui/useModelData.ts`; every task edits the README's "What it costs" paragraph.
9. Each test listed under a task must fail on the code before that task and pass after it.

## Task 1: A new main-mart column keeps the grid's total row count

Files: `src/ui/explorer/useMartRows.ts`, `src/ui/explorer/MartGrid.tsx`, `src/ui/explorer/useMartRows.test.tsx`, `README.md`.

Today: `useMartRows.ts:150` decides whether the last count covers this read:
`covered = !!c && c.base === base && sent.every((n) => c.columns.includes(n)) && (!(exact || c.exact) || sent.length === c.columns.length)`.
A column that the counted read did not carry makes `covered` false, so the read asks `includeTotalRowCount` again (`useMartRows.ts:154`). For a plain read the count is the number of main rows that pass the filters, and `base` (`useMartRows.ts:125`) already holds the filters, so a column of the main mart's own table cannot change it: it adds no join. OWOX joins every subsidiary mart rolled up to one row per key and LEFT JOINed (backend `abstract-blended-query-builder.ts`, "the result never exceeds the main data mart's row count"), so a joined column would keep it too, but the member asked to keep the re-ask for joined columns; leave that as it is.

How a column's owner is known: joined fields are `Field.joined` set (`src/model/types.ts:20`), named `alias__field` by `withJoined` in `src/api/blendable.ts`; `MartGrid` gets the main mart's own schema as `native` (`MartGrid.tsx:120`) and builds the joined schema with `withJoined(native, sources)` (`MartGrid.tsx:140`). A calculated field has `isCalculated` (`types.ts:12`); OWOX may group a read that names one, so it is never treated as plain.

Change:
1. `useMartRows` takes one more argument, `own: ReadonlySet<string>`: the main mart's non-calculated field names. Default an empty set, so other callers (if any; `git grep -n "useMartRows("`) behave as today.
2. In `covered`, a sent column is covered when the counted read carried it, or when the read is plain and the column is in `own`:
   `sent.every((n) => c.columns.includes(n) || (!grouped && own.has(n)))`. Keep the `exact` clause as it is: a read that names a calculated field still needs the same set.
3. Nothing else changes: `totalColumns` stays the counted read's columns (`useMartRows.ts:161`), so `ownTotal` in `MartGrid` (`MartGrid.tsx:750-751`) keeps judging the read that made the count.
4. `MartGrid.tsx:409`: pass `own`, memoised: `useMemo(() => new Set(native.filter((f) => !f.isCalculated).map((f) => f.name)), [native])`. `openRow` builds the same set inline (`MartGrid.tsx:784`); have it use the memo.

Tests (`useMartRows.test.tsx`; follow the file's existing helpers for counting `readRows` calls and the `includeTotalRowCount` flag):
1. Counted read of `[id, a]`, then `[id, a, b]` with `b` in `own` → the second read is sent without `includeTotalRowCount`, and `total` is the first read's.
2. The same with a joined column `j__x` (not in `own`) → the second read asks again.
3. The same with a calculated field `calc` (not in `own`, `exact` true) → asks again.
4. A grouped read with an added group key → asks again (its `base` differs; guards a regression).
5. A different filter with an added own column → asks again.

README, "What it costs": change "In an ungrouped grid, hiding a column and showing a loaded one reuse it too." to "In an ungrouped grid, hiding a column, showing a loaded one and showing a new column of the main data mart (not a calculated one) reuse it too." In the next sentence, change "and a column that was never loaded ask again" to "and a never-loaded column of a joined data mart or a calculated field ask again".

Reads saved: one total row count per new main-mart column shown in a plain grid.

## Task 2: The grid's total fills the card's record count, and Refresh recounts the card

Files: `src/api/row-counts.ts`, `src/ui/useModelData.ts`, `src/ui/App.tsx`, `src/ui/bands/DataBand.tsx`, `src/ui/explorer/SeededGrid.tsx`, `src/ui/explorer/MartGrid.tsx`, tests (`src/api/row-counts.test.ts`, `src/ui/useModelData.test.tsx`, `src/ui/explorer/matched-cards.test.tsx` or a new `src/ui/explorer/card-count.test.tsx`), `README.md`.

Today:
1. The card count is `countOptions` (`row-counts.ts:11-17`): `uniqueCount: ['']` when `hasPrimaryKey(schema)` (`src/records/relationships.ts:13`), else a `COUNT` of the first text, boolean or other field. `count()` serves the `row-counts` collection doc when it is under 24 h old (`row-counts.ts:38-41`), else reads.
2. `useCardStatus` (`useModelData.ts:34-145`) holds the card states in `counts`, queues reads (`enqueue`, `:94`), and recounts only when the model reloads (`:124-137`). `App.tsx:142` owns it; `recount` reaches the cards as `onRetryCount` (`App.tsx:250`).
3. The grid's Refresh (`MartGrid.tsx:808`) forgets the grid's rows and the schema and raises the grid's own version. It never touches the card, so the card can show a count up to 24 h old next to a fresh grid.

The equivalence: the grid's total is `COUNT(*)` of the rows the plain read would return without a limit (the mock does exactly that, `src/sdk/mock/ctx.ts:249`). The card's count is `COUNT(DISTINCT key)` of the main mart. They are the same number when the read is:
1. plain: no `aggregation`, `dateTrunc` or `uniqueCount` (no Unique Count column, which also groups);
2. unfiltered: no `filter` at all (no filter, slice or HAVING rule reaches the query);
3. main mart only: every column is a field of `native` (no joined column, so no join);
4. with no calculated field among its columns or filters (`counted.exact` false);
5. on a mart with a primary key (`hasPrimaryKey(native)`, the same test `countOptions` uses);
6. and the key is unique and never NULL in the warehouse.

Ruling needed: point 6 is not checked by anyone. OWOX does not enforce a declared key, and `COUNT(DISTINCT)` skips NULL keys while `COUNT(*)` counts their rows. On a mart with duplicate or NULL keys the card would show the larger row count, and keep it for 24 h. The plugin already relies on the same equality for the main mart's match badge (`ownTotal`, `MartGrid.tsx:748-761`, divides the grid's total by the card's count). Options:

| # | Option | Pros | Cons |
|---|---|---|---|
| 1 | Accept the equality (Recommended) | 🟢 Saves the card's count read whenever the grid answers first. 🟢 Same assumption the match badge already makes. | 🟡 A mart with duplicate or NULL keys shows its row count on the card for up to 24 h. |
| 2 | Refresh part only: no total into the card | 🟢 The card never shows anything but its own query's answer. | 🟡 No read saved; Refresh always costs one count read. |

Plan for option 1; with option 2, skip steps 2–4 of the change and have Refresh always recount (step 5's else branch).

Change:
1. `RowCounter` gets `store(id: string, count: number): Promise<void>`: `col.put(id, { dataMartId: id, count, at: now })`, errors swallowed like `measure` (`row-counts.ts:33`).
2. `useCardStatus` returns `offer(id: string, value: number)`:
   1. raise the id's `seq` (so a count read already under way, older than this value, cannot overwrite it; `current()` at `:53` drops it);
   2. drop a queued request for the id from `queue.current` (that read is no longer needed; this is the saved read);
   3. `asked.current.set(id, generation.current)`, so the card's `request` on scroll-in does not read again this generation;
   4. set the state to `{ state: 'ok', value }` (not stale);
   5. `counter.store(id, value)`.
   A read already running is not aborted (it is billed anyway); its answer is ignored.
3. `GridProps` (`MartGrid.tsx:96`) gets `onTotal?: (total: number) => void`; `SeededGrid.tsx:32-40` passes it through; `DataBand` takes `onCount?: (martId: string, n: number) => void` and wraps it like `showMatched` (`DataBand.tsx:40`); `App.tsx:256` passes `offer`.
4. In `MartGrid`, after `useMartRows`: `plainTotal = !charts && !grouped && !!asked && !asked.filter?.length && mainKey && counted.total !== null && !counted.exact && counted.columns.every((c) => own.has(c))` (`own` from Task 1, `mainKey` at `MartGrid.tsx:661`). `counted` is only set for this very base (`useMartRows.ts:184`), and `base` holds the filters, so an unfiltered `asked` means an unfiltered count. A layout effect calls `onTotal(counted.total)` when `plainTotal` holds, once per `version` and value (a ref of the last `${version}:${total}` sent).
5. Refresh (`MartGrid.tsx:808`): when the grid is in Table and the next read will qualify (the same test on `query` as step 4, without the `counted` parts), do nothing more: the read the Refresh starts asks the total (new `version`, new `base`), and step 4 sends it to the card. Otherwise call a new `onRecount?.()` prop, wired through `SeededGrid` and `DataBand` to `recount(martId)` (`useModelData.ts:144`), which queues the card's existing count read with its old value dimmed (`:99-104`).
6. Charts: the grid reads no rows there (`useMartRows` is paused, `MartGrid.tsx:409`), so a Refresh in Charts always takes the recount branch.

Why the recount is not an added read: Refresh is the member's explicit ask to read the mart again. Today it re-reads the rows, the joins and the schema and leaves the card stale; the recount makes the card follow, through the same count read the page's own Refresh (`useModelData.ts:137`) already sends. When the grid's next read qualifies, the card is refreshed from it at no cost.

Tests:
1. `row-counts.test.ts`: `store` writes a doc that `count` then serves without a read.
2. `useModelData.test.tsx`: `offer` while the card's count is queued → the queued read never runs, the card shows the value. `offer` while a read runs → its later answer does not replace the offered value. After `offer`, `request` for the id reads nothing.
3. Grid level: an unfiltered plain grid of a mart with a key → `onTotal` gets the total; with a filter, a joined column, a calculated column, a Unique Count column, or a mart without a key → `onTotal` is not called.
4. Refresh on a qualifying grid → no count read, the card shows the new total. Refresh with a filter set, or in Charts → exactly one count read.

README, "What it costs": after "counts are cached per member", add: "When the grid shows the main data mart's own columns with no filter, slice, grouping or calculated field and the data mart has a primary key, the card takes its record count from the grid's total, which assumes no two rows share a key. The grid's Refresh refreshes the card too: from that total when it qualifies, else with one count query."

Reads saved: the card's count read when the grid's unfiltered total arrives before it runs (a queued count, or an expired one on a later visit). Refresh: no read added when the grid qualifies; one count read otherwise, by request.

## Task 3: The scorecard read carries MIN and MAX of the Auto dates

Files: `src/charts/queries.ts`, `src/charts/useChartQuery.ts`, `src/charts/useBucket.ts`, `src/charts/Scorecards.tsx`, `src/charts/ChartsBody.tsx`, tests (`queries.test.ts`, `useChartQuery.test.tsx`, `useBucket.test.tsx`, `sharedReads.test.ts`), `README.md`.

Today:
1. `rangeQuery` (`queries.ts:79-81`) is `{ column: [date], aggregation: [MIN date, MAX date] }` with `withFilter(…, filter)`: the same rules `scorecardsQuery` (`queries.ts:58-69`) applies, since both name a column (a slice fits) and `fit` drops HAVING rules from both.
2. `useBucket` (`useBucket.ts:21-37`) reads it, under Auto, for: the charts' lead date (`ChartsBody.tsx:140`), a scorecard on its own date (`Scorecards.tsx:227`), and each Auto time series, line and heatmap (`kinds/timeSeries.tsx:35`, `kinds/line.tsx:26`, `kinds/heatmap.tsx:26`). It passes no `joins`, so only an identical cached read answers it. Same-date asks share one read through the flight and the cache.
3. A date whose rules forbid MIN or MAX is not rangeable (`useBucket.ts:23`, `allowedFunctions` in `src/model/aggregation.ts:60`, which reads `postJoinAggregations` for a joined field) and reads `monthsQuery` instead.
4. The scorecard read (`useScorecards`, `Scorecards.tsx:94-95`) and the lead range read go out side by side when Charts opens or a filter changes: two reads.

The joined-mart grain: OWOX rolls a joined mart up to one row per join key (a date by MAX by default, `aggregateFunction`) and LEFT JOINs it, so a join never adds or drops main rows. A joined date's MIN/MAX is then taken over the same rolled-up values, on the same main rows, whether the read is the bare range read or the scorecard read, whatever the join's `mainGrainMultiplication` or `mainGrainCollapse`. To keep the scorecard numbers exactly as they are, the change still carries a date only when the scorecard read already joins its mart, so no join is added to that read.

Change:
1. `scorecardsQuery(marts, filter, counter, kept, ranges: Field[] = [])`: each range date adds its name to `column` and `{ column, function: 'MIN' }`, `{ column, function: 'MAX' }` to `aggregation`, before `withCounter` (a query that now names a column needs no counter: its slice fits). `scoreQuery` passes `ranges` through. `MartGrid`'s Table badge (`MartGrid.tsx:745`) calls it without ranges, as today.
2. Export `rangeable(date)` from `useBucket.ts` (the test at `:23`).
3. In `ChartsBody`, the carried dates: the lead date when the lead bucket is Auto (`spark.date`, `ChartsBody.tsx:140`), and each scorecard's own date when that card ranges it (`own` in `ScoreCard`, `Scorecards.tsx:226`; compute the same set from `cf` and `spark` in `ChartsBody`, deduplicated by name). Keep a date only when it is rangeable, not calculated, and its mart (`joined?.aliasPath ?? ''`) is one the scorecard read already reads: a `cf.marts` entry with a metric or `hasPk`. Each of these dates sends a range read today, over the same rules, so the warehouse scans that column once instead of twice.
4. Order in `ChartsBody`: call `useScorecards` before the lead `useBucket` (effects of one component run in call order).
5. `useScorecards` asks the scorecard query with ranges, with `reuse` set to the same query without ranges (`useChartQuery`'s `reuse`, `useChartQuery.ts:31-41`). A cached Table badge read then still serves the cards with no read, as today; its rows lack the MIN/MAX keys, so the range asks read on their own (today's count).
6. A context, `CarriedRanges`, provided by `ChartsBody`: `(date: Field, filter: TraverseFilter[], version: number) => ChartResult | null`. It answers only for a carried date, the same version and the same rules (`stable(filter)`). It returns the scorecard `ChartResult` of the current key (never `previous`, `Scorecards.tsx:96-98`) when its rows hold both `rangeKeys(date)` keys, or while it is loading, held or failed; `null` when the rows came without those keys (the `reuse` case).
7. `useBucket`: under Auto with a rangeable date, a non-null `CarriedRanges` answer replaces its own query (`useChartQuery(…, null, …)`); `bucket`, `pending`, `error` and `retry` come from that result. Everything else, including `monthsQuery`, is unchanged. All callers (lead, own-date cards, time series, line, heatmap) gain this through the context, with no new argument.
8. Charts with a filter also run `MartGrid`'s badge ask (`MartGrid.tsx:758`, the query without ranges, with `joinGrain`). Today it shares the Charts scorecard flight because the keys are equal; after step 1 they differ. `useChartQuery` must therefore join a read in flight that answers the ask: store `martId`, `version` and `parts` on each `Flight`; when there is no cache hit, no exact flight and `joins` is given, join a flight whose parts `answers` the ask (or its `reuse`). The child's effect (ChartsBody) runs before the parent's (MartGrid), so the combined flight is there when the badge asks. Without this the change adds one read in Charts under a filter.
9. Watch `answers` for the badge ask against the combined read: the range dates are aggregated (not group keys) and their marts are already in the read, so no join is dropped. With a calculated metric among the scorecard columns, `ChartsBody`'s `joins` (`ChartsBody.tsx:128`) has no `isMetric` and would see it as a group key; pass the metric names as `MartGrid` does (`joinGrainOf(sources, metricNames)`, `MartGrid.tsx:755`) so `answers` reads it as a metric.

Ruling needed: the sparklines wait for the scorecard read instead of the bare range read. Today the lead range read scans one date column and usually answers first; the sparkline reads then start while the scorecard read still runs. After the change they start when the scorecard read answers, which scans every metric column too (and, with joined metrics, OWOX's metric sleeves). On a large table that can be seconds later, so "the sparklines must not wait longer than today" cannot be promised. Options:

| # | Option | Pros | Cons |
|---|---|---|---|
| 1 | Carry the range only when the scorecard read has no joined mart (no joined metric, no joined key) (Recommended) | 🟢 One read saved on every Charts open and filter change of a single-mart report. 🟢 The two reads scan the same table, so the wait grows by little. | 🟡 Still not "never longer": the scorecard read also scans the metric columns. 🟡 No saving once a joined mart is in the report. |
| 2 | Carry it always (as planned above) | 🟢 Saves the read in every report. | 🔴 Sparklines can wait for joined metric sleeves. |
| 3 | Drop the task | 🟢 Sparklines exactly as today. | 🟡 No read saved. |

Tests:
1. `queries.test.ts`: `scorecardsQuery` with a range date adds the column and MIN/MAX; with a slice and no metric it carries the slice and no counter column.
2. `useChartQuery.test.tsx`: an ask answered by a read in flight for a superset joins it (one `readRows` call); without `joins` it does not.
3. Charts open, no filter, Auto lead date of the main mart → one read for scorecards and range together (today two); the sparklines get the bucket from it.
4. A filter, Table first then Charts → reads as today (badge read, then one range read), cards with no skeleton.
5. Charts with a filter → the badge does not send its own read (step 8).
6. A date that forbids MIN → its `monthsQuery` still goes out. A date of a mart the scorecard read does not join → its own range read.
7. A time series on the lead date under Auto → no range read of its own.
8. The scorecard read fails → the bucket reports the error, and Retry on it retries the scorecard read.

README, "What it costs": after "Each chart is a `traverseData` query…", add: "The scorecard query also reads the first and last value of the date the sparklines use, so Auto picks its bucket with no query of its own; a date the scorecards do not read, or one that allows no MIN or MAX, is read on its own."

Reads saved: one range read per Charts open, filter change or Refresh (one per carried date), when no cached Table badge read already served the cards.

## Task 4: Smart search keeps its value reads, and they answer value suggestions

Files: `src/search/valueMatch.ts`, `src/ui/explorer/ValueInput.tsx`, `src/ui/explorer/MartGrid.tsx`, `src/ui/useModelData.ts`, tests (`src/search/valueMatch.test.ts`, `src/ui/explorer/ValueInput.test.tsx`, a MartGrid-level suggestion test such as `field-actions.test.tsx` or `FilterEditor.test.tsx`), `README.md`.

Today:
1. `readValues` (`valueMatch.ts:28-35`) reads `{ ...topValuesQuery(field, RECORDS, []), limit: 200 }`: the column, `uniqueCount: ['']`, sorted by it descending, no filter. No cache: each smart search re-reads up to `VALUE_COLUMNS` (6) columns (`src/search/steps/shape.ts:145-146`). It swallows errors and returns `[]` (`:32-34`).
2. A suggestion read (`valuesQuery`, `src/filters/valueSuggest.ts:27-30`) is the same column, the same `uniqueCount('')` sort, the grid's other rules plus `is_not_blank` on the column, limit 50. `MartGrid.valuesFor` (`MartGrid.tsx:661-672`) builds it only for a mart with a key; its results go to `valueCache` (`valueSuggest.ts:12`, module-wide, keyed by mart and query), and the input's reload deletes the key and reads again (`ValueInput.tsx:56`).

Change:
1. In `valueMatch.ts`, a per-ctx LRU (`VALUES_CACHE_LIMIT = 64`, exported): key `martId + '\u0000' + field.name`, entry `{ values: string[] (as today: non-null values as text, once each, in row order), complete: boolean (rows.length < 200) }`. `readValues` gets the entry when there is one, else reads; it stores an entry only on success. A failed or aborted read still returns `[]` to the search and stores nothing.
2. `forgetValues(ctx, martId)` and `forgetAllValues(ctx)`. The grid's Refresh calls `forgetValues` next to `forgetGridRows` (`MartGrid.tsx:808`); `useModel` calls `forgetAllValues` where a model reload clears the schemas (`useModelData.ts:23`). This is the cache's version: the search has no grid version to key by.
3. `suggestFromSearch(ctx, martId, field): string[] | null`: from the entry, the non-blank values (`trim() !== ''`) in order; return the first 50 when the entry is complete or holds at least 50 of them, else `null`. Export `SUGGEST_LIMIT` from `valueSuggest.ts` rather than repeating 50.
4. `ValueSource.load` (`ValueInput.tsx:10`) takes `(signal, fresh: boolean)`; the first read passes `false`, `reload` passes `true`.
5. `valuesFor` in `MartGrid`: when the rules for this column are empty (the `filter` built at `:669` is `[]`, so the read is the column's `is_not_blank` alone), `load` first tries `suggestFromSearch` unless `fresh`, and reads only when it returns `null`. A reload always reads.
6. Values with equal counts may come back in another order than a direct read; accepted. Also, if the backend's `is_not_blank` keeps whitespace-only values, a direct read can show fewer than 50 after `valuesOf` drops them, while the cached answer shows 50; accepted.

Tests:
1. Two smart searches on the same mart and columns → the second sends no value reads. A failed read → the next search reads again. After `forgetValues` or a model reload → reads again.
2. A search read of 200 rows with at least 50 non-blank values, then an unfiltered suggestion on that column → no read; the list is the first 50 non-blank in order. A complete read (fewer than 200 rows) with 10 non-blank values → no read, those 10.
3. A search read of 200 rows with fewer than 50 non-blank values → the suggestion reads. A suggestion with any other rule → reads. Reload → reads.

README, "What it costs": add: "A smart search reads the top values of up to six text columns once per session; Refresh reads them again. A value suggestion for a column with no other rule is taken from those values when they hold enough of them."

Reads saved: up to 6 value reads per repeated smart search on the same mart, and one suggestion read per column the search has already read.
