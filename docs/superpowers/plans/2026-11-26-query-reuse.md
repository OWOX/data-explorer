# Plan: fewer reads, faster repaints

Goal: the grid, the charts and the Row band reuse what was already read. Four changes, all in the plugin; no API, schema or rule change.

## Global Constraints

1. Every `traverseData` / `readRows` call is a billed warehouse query. A change may remove reads; it must never add one.
2. A reused result must be the exact answer to the new ask: same mart, same `version`, same filters, same sort, same grouping. Rows of one shape never stand in for another's (see `shapeOf` in `src/ui/explorer/useMartRows.ts`).
3. `version` busts every cache (Refresh, mart reload). Retry always reads again. A failed or aborted read is never cached.
4. Caches are per ctx (`perCtx` from `src/sdk/per-ctx.ts`), in memory, LRU by entry count, like `CHART_CACHE_LIMIT` in `src/charts/useChartQuery.ts`.
5. Tests: Vitest, `npx vitest run <files> --maxWorkers=4` (this Vitest version rejects `--poolOptions`). Never run Vitest without the worker cap. `npx tsc -b` and `npx eslint <changed files>` must pass.
6. Comments and README text follow the repo's existing style: plain, short sentences, no marketing words.
7. Commit per task, message in the repo's style (a plain sentence summary line). End every commit message with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Task 1: Grid result cache, with smaller pages served from bigger reads

File: `src/ui/explorer/useMartRows.ts` (+ its test file; create `src/ui/explorer/useMartRows.test.tsx` if none covers the hook, else extend the existing one — check `git grep -l useMartRows -- '*.test.*'`).

Today the hook remembers only its last result, so Undo/Redo, toggling a filter off and on, Charts→Table, or switching back to an earlier main mart re-read rows that were just shown. Load more raises `limit` and re-reads everything; an edit resets `limit` to 200 and reads again.

Change:
1. Add a per-ctx LRU of resolved grid reads: `GRID_CACHE_LIMIT = 16` entries (exported). Entry: `{ martId, version, options (as sent, without includeTotalRowCount), rows (all rows the read returned, i.e. up to limit+1), columns: string[], exact: boolean, total: number | undefined, totalBase, totalColumns, totalExact, runId }`.
2. Store an entry when a read resolves (not aborted, no error).
3. Before reading a key, look for an entry that answers it:
   1. same martId and version;
   2. same options apart from `column` and `limit` (compare with a stable JSON of the options minus `column`, `limit`, `includeTotalRowCount`);
   3. columns: grouped read (aggregation/dateTrunc/uniqueCount) → same column list, in order; plain read → the entry's columns ⊇ the asked columns, and when `exact` (this ask) or the entry's `exact` is true, the same set (a calculated field may make OWOX group the read);
   4. limit: the entry answers when its row count reached past the asked page (`entry.rows.length > askedPageLimit`) or when it was complete (`entry.rows.length < entry.limit`, i.e. it returned fewer rows than it asked for: there are no more rows).
4. A hit sets the state as a read would: `rows = entry.rows.slice(0, pageLimit)`, `hasMore = entry.rows.length > pageLimit` (for a complete entry: false when all rows fit), `doneFor = key`, `runId = entry.runId`, the count fields from the entry (when the entry has a total), and `readKey.current = key`. It also seeds `counted.current` from the entry when the entry asked for a count, so the next read of the same base is covered. No read is sent, and the state is set synchronously in the effect (like the chart cache's hit path), so the grid shows no loading bar.
5. A hit re-inserts the entry (most recently used). Exceeding the limit drops the least recently used.
6. Retry and Refresh: Refresh bumps `version` (new key, no hit). Check how Retry reaches the grid (`git grep -n "retry\|Retry" src/ui/explorer/MartGrid.tsx`); a failed read is never cached, so a Retry after a failure always reads. Nothing else changes.
7. Copy SQL reads the SQL from the last run id (`state.runId`): a cache hit keeps the entry's run id, which is the run that returned these rows. Keep that.

Tests (each must fail without the change):
1. Undo case: ask A, then B, then A again → 2 reads, the third render shows A's rows with no read.
2. Smaller page: read with limit 1000 (`limit: 1001`) then the same query with `limit: 201` → no read; rows are the first 200; `hasMore` true.
3. Complete read answers a bigger limit: limit 200 returns 50 rows; the same query with limit 400 → no read, `hasMore` false.
4. A bigger limit than a full entry reads (limit 200 returned 201 rows; ask 400 → one read).
5. Different filter or sort → reads. Different `version` → reads.
6. Plain read: entry with columns [a,b,c] answers [a,b]; with `exact` it does not.
7. Grouped read: columns [a,b] does not answer [a].
8. Failed read is not cached: an error then the same key again (via Retry or remount) reads again.
9. LRU: after `GRID_CACHE_LIMIT + 1` distinct reads the first one reads again.
10. The cached hit keeps the total count (`counted`), and the next read of the same base does not ask `includeTotalRowCount` again.

README: in "What it costs", add one or two sentences: the grid keeps its last 16 results for the session, so Undo, Redo, a filter toggled back and Charts → Table show them again with no query, and a result with more loaded rows answers a smaller page. Refresh reads again.

## Task 2: Charts read only once they scroll near the view

Files: `src/charts/ChartsBody.tsx`, `src/charts/ChartPanel.tsx`, `src/ui/bands/inview.ts` (reuse `whenInView`, do not copy it), tests.

Today every chart panel reads as soon as Charts opens, including panels below the fold. Cards already wait (`src/ui/bands/cards.tsx` uses `whenInView`).

Change:
1. A context in `ChartPanel.tsx` (e.g. `ChartSeenContext: (() => void) | null`). `ChartPanel` calls `whenInView(section, onSeen)` when the context gives a callback; it always renders its `<section>` (even while loading), so there is an element to observe.
2. In `ChartsBody.tsx`, wrap each drawn panel in a small component holding `seen` state (starts false; set true once, never back). It provides the context and passes `idle={idle || !seen}` to `def.Panel`. Key it by `spec.id` like the frame, so a chart keeps its `seen` across renders.
3. Once seen, a panel stays live (a later filter change reads even if scrolled away): only the first read waits.
4. Scorecards (`MartCards`) are unchanged: they sit at the top.
5. While not seen the panel shows its usual skeleton (idle panels already render the loading skeleton; verify and keep it).
6. Without IntersectionObserver (`whenInView` calls back at once) behaviour is as today.

Tests: with a stubbed IntersectionObserver, a panel not yet intersecting sends no read; firing intersection sends one; scrolling away and changing the filter still reads (stays live). Without IntersectionObserver the panel reads at once.

README: in "What it costs", change "Each chart is a `traverseData` query, run only while Charts is shown and the band is open" so it also says a chart first reads when it scrolls near the view.

## Task 3: A chart keeps its last drawing while a new read runs

File: `src/charts/ChartPanel.tsx` (+ test).

Today a chart whose query changes (a filter, a click on a slice, Refresh) shows a skeleton until the read answers. The grid keeps its old rows meanwhile.

Change, in `ChartPanel` only (no change to `useChartQuery`, so no dependent read starts from stale rows):
1. Remember the last drawn body: when the panel renders its children (not loading, no error, not empty), keep that ReactNode in a ref.
2. While `loading` is true and a drawn body is remembered, render the remembered body instead of the skeleton, wrapped so it is visibly stale: `aria-busy="true"`, reduced opacity (a CSS class in `src/charts/charts.css`, e.g. `.dm-chart-stale { opacity: .5; pointer-events: none; }`; pointer-events none so no click-to-filter acts on old values), and the existing `dm-busybar` progress bar (see `RecordView.tsx` for its use: `<div role="progressbar" aria-label="Loading chart" className="dm-busybar" />`).
3. Drop the remembered body on an error or an empty result (they render as today), and when the chart's kind changes (`name` prop) — key the memory by `name`.
4. Copy to clipboard while stale says "Nothing to copy yet", as while loading today.

Tests: a panel drawn with children, then re-rendered with `loading` → the old children are still in the DOM with `aria-busy`, no skeleton; then loaded → new children. Loading after an error → skeleton. Kind change → skeleton.

## Task 4: The Row band shows the grid's row at once

Files: `src/ui/explorer/MartGrid.tsx` (`openRow`, ~line 769), `src/ui/explorer/RecordView.tsx`, a new small module for the hand-off (e.g. `src/records/seen-rows.ts`), tests.

Today a click on a row opens `RecordView`, which always reads the record by primary key with every schema column.

Change:
1. `openRow` stores the clicked grid row before it dispatches: a per-ctx map keyed by `martId` + stable JSON of `pk` → `{ row, columns }` where `columns` are the main mart's columns the grid read (the `column` of the grid's current query for that mart, without joined columns: names that are fields of the mart's schema). Keep at most 32 entries (drop oldest).
2. `RecordView`, on its first load (its own Refresh counter at 0) and when a seed exists for this mart and pk:
   1. When the seed's columns include every field of the schema, use the seed as the row: no read. Refresh still reads.
   2. Otherwise show the seed's values at once (the fields it lacks render empty) with the existing `dm-busybar` progress bar, and read as today; the read's row replaces it.
3. Rows from a grouped grid never open a record today (keep it so).
4. Values a joined column brought in are not mart fields and are not used.

Tests: a seed with every field → no read, the fields render; a seed with some fields → those values render before the read resolves, then the read's row; no seed → one read as today; Refresh with a full seed → one read.

README: under "Open a record", one sentence: the Row band shows the row the grid already loaded at once, and reads it only for fields the grid did not load or on Refresh. In "What it costs", the record read happens only then.

## Task 5: Everything that shows a previous read's value while a new read runs is dimmed

Files: found by audit; known places below. One shared style for "being replaced".

Today the grid dims its rows (`opacity-60`), charts dim theirs (`.dm-chart-stale`, opacity .5) and scorecard values dim (`opacity-40`). Other numbers show the previous read's value at full strength while a new read runs, so the member can't tell an old number from an updated one.

Change:
1. One shared class for content being replaced, e.g. `.dm-stale` in a shared CSS file: opacity 0.5 with the existing 200ms opacity transition. Use it for the grid rows, chart bodies and scorecard values in place of the three different opacities. Keep `aria-busy="true"` on each.
2. Audit every place that shows a number or a drawing from a read and can keep showing the previous one while the next read runs. Dim each while it does. Known places:
   1. The Data band's rows label ("200 of 1,234 rows", from `rowsLabel` in MartGrid via `onRows`): dim it while the grid reads.
   2. The card match badge ("12% match", cards.tsx `MatchBadge`, fed by MartGrid `matched`): while a new count is under way, show the previous badge dimmed rather than a full-strength old one, or a badge that vanishes and comes back.
   3. A card's record count while it is recounted (Refresh): dim the old count if it stays on screen.
   4. Scorecard sparklines: today a reloading trend becomes a pulsing placeholder. When the date and bucket are unchanged (a filter change), keep the old sparkline dimmed instead; a changed date or bucket keeps the placeholder.
   5. The Row band (RecordView): while it reads (Refresh, or a partial grid seed), the shown values are dimmed, next to the existing busy bar.
   6. Anything else the audit finds (value suggestions and the search list are lists, not numbers; include them only if they show a previous result as if current).
3. A value that is fresh is never dimmed: dimming ends on the same render the new value arrives.

Tests: for each place, a test that the previous value is shown with the stale class and `aria-busy` while the read is pending, and without them after it resolves.

README: one sentence where the Data band or Charts is described: a number or chart that is being updated is shown dimmed until the new value arrives.

## Task 6: Follow-ups from the final review

1. `src/sdk/mock/fixtures.ts:316`: `demoFixtures()` returns the module-level `s.fields` array, so `setup({ fields })` in tests pushes into shared state and fields leak between tests. Return a copy (`fields: [...s.fields]`, and copy any other array a caller mutates). Then make the calculated-seed test in aggregation.test.tsx independent of order (it can use any field name).
2. A wiring test: a time series and a line chart keep their dimmed drawing across an Auto bucket change (the title passes `def.title` as `memoKey`), at the ChartsBody level, not only ChartPanel.
3. A test that canvas cards observe against the viewport (no `[data-scroll-root]` ancestor on `.dm-tree-scroll`), so the count read waits until the card is on screen.
