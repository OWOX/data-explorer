# Core review: simplification and optimisation

Scope: `src/state`, `api`, `sdk` (with `mock`), `search`, `filters`, `model`, `graph`, `records`, `export` at origin/main `48427cd`. About 6,300 lines without tests. Read-only, nothing was changed.

Every "unused" claim was checked with a word grep over `src` and `e2e`. "Test only" means the only callers are `*.test.ts` files.

## Totals

1. 24 findings: 1 correctness bug, 3 runtime savings, 20 simplifications.
2. About 340 lines removable from non-test code (5% of the scope), plus about 30 test lines for the dead code.
3. Effort: 17 small, 7 medium, 0 large.
4. Confidence: 16 high, 8 medium.

## Findings, ranked by impact ÷ effort

### 1. `clear()` on both loaders keeps reads in flight, so a refresh can serve the old schema

1. `src/api/schemas.ts:64`, `src/api/blendable.ts:82`. Called from `src/ui/useModelData.ts:23`.
2. `clear()` empties `done` but not `inflight`. A read started before Refresh still passes the `inflight.get(id) === p` check, writes its pre-refresh result into `done`, and a `get()` made after the refresh is handed that old promise.
3. Before: `clear() { done.clear(); }`. After: `clear() { done.clear(); inflight.clear(); }`. `invalidate(id)` already does this for one id.
4. The two loaders are the same 20 lines (`done`, `inflight`, `get`, `peek`, `invalidate`, `clear`, listeners). One `createKeyedLoader<T>(read: (id) => Promise<T>)` in `api/` used by both removes about 20 lines and holds the fix once. `readDoc` in `exports.ts:197-215` and `load` in `grid-columns.ts:78-84` repeat the same "share the read in flight" shape and could use it too.
5. Impact: fixes a stale schema or stale joins after Refresh until the member refreshes that mart by hand. Risk low. Effort S. Confidence high.

### 2. Dead code in api, model and state

1. `src/model/aggregation.ts:148-153` `describeColumn`: test only.
2. `src/api/schemas.ts:11-12, 21, 46, 57-62` `prefetch`, `subscribe` and the `listeners` set: test only. `SCHEMA_CONCURRENCY` in `src/config.ts:3` and the `runPool` import go with them.
3. `src/api/grid-columns.ts:16, 98` `picks(martId)` on the interface: test only (`grid-columns.test.ts:93`). Production uses `loadPicks`.
4. `src/state/store.tsx:57, 89`: `openRecord.sourceOf` is optional, but the one dispatch (`MartGrid.tsx:768`) always passes it, so the fallback line 89 in `sourceFor` is unreachable.
5. `src/export/tsv.ts:34` `typeOf` is a copy of `outputType` in `src/model/aggregation.ts:175-180`.
6. Before → after: delete items 1 to 3 with their tests; make `sourceOf` required and drop line 89; `tsv.ts` calls `outputType({ type: f.type }, o.fn)`.
7. Impact: about 30 lines plus about 30 test lines. Risk none. Effort S. Confidence high.

### 3. `isAggFn` and `isDateBucket` guards instead of 11 casted `includes` calls

1. `src/state/view-link.ts:206, 232, 239`; `src/api/grid-columns.ts:35, 37`; `src/search/report-load.ts:121, 150, 155`; `src/search/view.ts:84, 92`; `src/api/chart-settings.ts:32`.
2. Each site writes `(AGGREGATE_FUNCTIONS as readonly unknown[]).includes(x)` and then casts the value (`as AggFn`, `as DateBucket`, and `as never` twice in `grid-columns.ts`).
3. Before: `(AGGREGATE_FUNCTIONS as readonly unknown[]).includes(r.function) ? [{ column: r.column as string, function: r.function as never }] : []`. After, in `model/aggregation.ts`: `export const isAggFn = (v: unknown): v is AggFn => (AGGREGATE_FUNCTIONS as readonly unknown[]).includes(v);` and the same for `isDateBucket`; call sites become `isAggFn(r.function) ? [{ column, function: r.function }] : []`.
4. Impact: about 12 casts removed, two of them `as never`, which would hide a wrong field. Risk none. Effort S. Confidence high.

### 4. `join-plan.ts` refits a grid to new columns in five places

1. `src/state/join-plan.ts:136-156` (`withoutMart`), `159-181` (`withoutPaths`), `238-242` (`becomeMain`), `336-348` (`planMakeMain`), `386-394` (`planRejoin`). `planClick:277-281` does a partial version.
2. The same block is repeated: keep the sorts on the columns (null when all are lost), `keepVisible` the aggregation, turn empty lists into `undefined`, `dropOrphanHaving`. `withoutMart` and `withoutPaths` differ only in the name set.
3. Before: 8 to 12 lines per site. After:
   ```ts
   const refit = (grid: GridState, columns: string[], keep: (name: string) => boolean = () => true): GridState => {
     const kept = grid.sorts && sortsOnColumns(grid.sorts, columns);
     const agg = keepVisible({ aggregations: grid.aggregations ?? [], dateTrunc: grid.dateTrunc ?? [] }, columns);
     return { ...grid, columns,
       sorts: grid.sorts?.length && !kept!.length ? null : kept,
       aggregations: agg.aggregations.length ? agg.aggregations : undefined,
       dateTrunc: agg.dateTrunc.length ? agg.dateTrunc : undefined,
       filters: dropOrphanHaving(Object.fromEntries(Object.entries(grid.filters).filter(([k]) => keep(k))), agg.aggregations),
       slices: keepSlices(grid.slices, keep) };
   };
   const withoutNames = (grid, gone: Set<string>, own) => refit(grid, rest.length ? rest : own, (k) => !gone.has(k));
   ```
   `withoutMart` and `withoutPaths` become three lines each.
4. Impact: about 35 lines. It also gives `planClick:280` the aggregation and HAVING cleanup it skips today when it swaps the next main mart's columns (MartGrid cleans up later, so this is tidiness, not a known bug). Risk low, the plan tests cover every branch. Effort S to M. Confidence high.

### 5. The "field name to joined source" map is built in six functions

1. `src/state/join-plan.ts:14-15, 26-27, 59-60, 98-99`; `src/state/column-order.ts:9-10, 25-26`; `src/state/join-tree.ts:11-12`.
2. Each function loops over every field of every source to build the same first-wins map, then reads one property of it (mart id, alias path, or the source).
3. Before: `for (const s of sources) for (const f of s.fields) if (!owner.has(f.name)) owner.set(f.name, s.aliasPath);` six times. After, in `api/blendable.ts`:
   ```ts
   const owners = new WeakMap<JoinedSource[], Map<string, JoinedSource>>();
   export const sourceOfField = (sources: JoinedSource[]) => { /* build once per array, cache in the WeakMap */ };
   ```
   `joinedMartIds`, `joinedPaths`, `inUsePaths`, `orderColumns`, `groupMap`, `buildJoinTree` read `.martId` or `.aliasPath` from it.
4. Impact: about 15 lines. Runtime: `moveColumnBy` builds the map twice per call (`column-order.ts:52` and `37`), and `MartGrid.tsx:570` calls it per column and direction; a card click builds it four or more times. With the cache it is built once per `sources` array. Risk low: the loader returns the same array until `invalidate`. Effort S. Confidence high.

### 6. `preferences.ts` repeats one load and one save three times

1. `src/api/preferences.ts:29-70`. The save pattern is also in `src/api/chart-settings.ts:57-61` and `src/api/grid-columns.ts:128-141`.
2. Three documents each have a `try { get } catch { warn; return default }` and a `Promise.resolve().then(put).catch(warn)`, and `ctx.collections(...)` is called again on every use.
3. Before: 42 lines for six methods. After:
   ```ts
   const doc = <T,>(id: string, what: string) => {
     const col = ctx.collections<T>(PREFERENCES_COLLECTION);
     return {
       read: () => col.get(id).then((f) => f?.document, (e) => { console.warn(`Reading ${what} failed`, e); return undefined; }),
       write: (d: T) => { Promise.resolve().then(() => col.put(id, d)).catch((e) => console.warn(`Saving ${what} failed`, e)); },
     };
   };
   ```
   Each method becomes one line: `loadMartsView: async () => ((await view.read())?.view === 'canvas' ? 'canvas' : 'grid')`.
4. Impact: about 25 lines. Risk none. Effort S. Confidence high.

### 7. `undo` and `redo` are the same eleven lines with the two stacks swapped

1. `src/state/store.tsx:128-150`.
2. Both pop entries until `known` accepts one, apply its grids, and push the current selection onto the other stack.
3. Before: two `case` blocks. After: `const step = (state, from: 'history' | 'future', known) => { const to = from === 'history' ? 'future' : 'history'; ... return { ...state, selection, grids, [from]: stack, [to]: [...state[to], entry].slice(-HISTORY_LIMIT) }; }` and `case 'undo': return step(state, 'history', a.known); case 'redo': return step(state, 'future', a.known);`.
4. Impact: about 10 lines, and a later change to one direction cannot miss the other. Risk low, the reducer tests cover both. Effort S. Confidence high.

### 8. `Skipped` is an out-parameter, and its empty literal and `plural` are copied

1. `src/state/view-link-resolve.ts:23, 68, 117`; `src/search/view.ts:152`; `src/search/report-load.ts:87, 171-176`.
2. `pruneGrid` mutates a `Skipped` the caller must build. Two of the three callers build a nine-field empty literal only to throw it away (`view.ts`) or copy four counters out (`report-load.ts`). `plural` is defined twice with the same body.
3. Before: `const pruned: Skipped = { mart: false, source: false, columns: 0, ... }; const grid = pruneGrid(built, schema, pruned);`. After: `pruneGrid(grid, schema): { grid: GridState | null; dropped: { columns: number; filters: number; sorts: number; aggregations: number } }`; `resolveView` adds the counters to its own `Skipped`; `mergeAiView` reads `.grid`. Export `plural` once.
4. Impact: about 12 lines and a narrower type (the grid pruning cannot touch `mart`, `source`, `contexts`). Risk low. Effort S. Confidence high.

### 9. DTO and model types declared twice

1. `src/sdk/types.ts:30-31`: the `aggregation` and `dateTrunc` literal unions repeat `AggregationRule` and `DateTruncRule` (the file already imports `AggFn`).
2. `src/sdk/mock/aggregate.ts:5-6`: `Rule` and `Trunc` repeat them a third time.
3. `src/sdk/types.ts:123-132` `DqSummaryDto` and `src/model/types.ts:51-60` `DqSummary` are field for field the same.
4. `src/model/types.ts:47` repeats `StorageDto`.
5. `src/api/exports.ts:94-95` (`LiveReportDto`, `ReportDto`) and `src/search/report-load.ts:15-24` (`ReportDto`) describe the same `GET /api/reports/:id` answer in three partial types, two with the same name.
6. Before → after: `aggregation?: AggregationRule[]; dateTrunc?: DateTruncRule[]`; `export type DqSummary = DqSummaryDto`; one `ReportDto` in `sdk/types.ts` with all optional parts.
7. Impact: about 25 lines; a new aggregate function is added in one place, not three. Risk none (compile-time only). Effort S. Confidence high.

### 10. Core modules import from `ui`

1. `src/search/view.ts:10`, `src/search/report-load.ts:12`, `src/search/run.ts:5` import `defaultColumns` from `ui/explorer/useMartRows` (a React hook module that imports the store). `src/export/tsv.ts:5` imports `displayText` from `ui/format`. `src/api/chart-settings.ts:2` imports a type from `charts`.
2. Three lines of pure logic live in a hook file, so the search parsers pull React and the store into their module graph and their tests.
3. Before: `import { defaultColumns } from '../ui/explorer/useMartRows';`. After: move `defaultColumns` to `src/model/columns.ts` (or `model/types.ts`) and re-import it in `useMartRows`, `useCardClick`, `useSmartSearch`, `MartGrid`.
4. Impact: no lines saved; removes the only runtime `core → ui` imports besides `displayText`. Risk none. Effort S. Confidence high. `displayText` belongs to the format reviewer's scope, so it is only named here.

### 11. Every export re-reads all of the mart's remembered reports

1. `src/api/exports.ts:359-365` (the `finally` of `run`), with `touch` at `:391` and `:418`.
2. After an export settles, the mart's cache is deleted and `load` starts one `GET /api/reports/:id` per remembered report, although only one report changed and `mutate` (`:229-240`) has already updated its `usedAt` and read a new one.
3. Before: `caches.delete(a.martId); load(a.martId); emit(a.martId);`. After: `const cache = caches.get(a.martId); if (cache?.started && result) void read(a.martId, cache, result.report.reportId); emit(a.martId);` and keep the full reload only for a rejected run.
4. A second request to drop: `:422` reads the report before the run to see `lastRunStatus` and `lastRunAt`. For `new` and `existing` the report was created two lines earlier and `created` (`:409`) already carries both fields, so `pre` can be `created` there.
5. Impact: with N remembered reports, N + 1 GETs per export become 1, and each new export saves one more round trip before the run starts. Risk medium: a report edited in OWOX during the export shows its old title until the next `invalidate()`. Effort M. Confidence medium.

### 12. Aggregation and date-bucket rules are validated in four places with four rule sets

1. `src/state/view-link.ts:225-246`, `src/api/grid-columns.ts:33-39`, `src/search/report-load.ts:148-158`, `src/search/view.ts:79-94`.
2. Each parses `{ column, function }` and `{ column, unit, timeZone? }` from untrusted input. They disagree: only the link caps and dedupes, only `grid-columns` and the link enforce "functions or a bucket, never both", `view.ts` drops the time zone, `report-load` keeps an invalid zone out but does not dedupe.
3. Before: four loops. After, in `model/aggregation.ts`: `parseAggregation(rawAgg: unknown, rawTrunc: unknown, o?: { max?: number; known?: (column: string) => boolean }): Aggregation & { dropped: number }` with one rule set (known function, known unit, valid zone, no repeat, bucket only on a column without functions). The link decoder maps its tuples to objects first and adds `dropped` to `droppedAggregations`.
4. Impact: about 30 lines and one behaviour. Risk medium: the stricter common rules can drop a rule one of the four paths accepts today (for example a repeated function in a stored report), though `sanitizeAggregation` already drops most of them one step later. Effort M. Confidence medium.

### 13. `createColumnStore` keeps one document in eight maps

1. `src/api/grid-columns.ts:48-57, 78-122, 131`.
2. `cache`, `picked`, `patches`, `shownBy`, `aggBy`, `timers`, `reads`, `readOk` are all keyed by mart id and describe one stored document, so "is it loaded" is a four-way `has` check written twice (`:79`, `:131`), and the interface has four loaders (`load`, `loadPicks`, `loadLastShown`, `loadAggregation`) for one read.
3. Before: `if (cache.has(id) && picked.has(id) && shownBy.has(id) && aggBy.has(id))`. After: `const entries = new Map<string, { stored?: Doc; local: Partial<Doc>; read?: Promise<void>; timer?: Timer }>()`, a view `{ ...stored, ...local }` (picks merged), one `loadDoc(martId): Promise<Doc>` plus the sync getters. `useCardClick.ts:58-68` then awaits one call, not four.
4. Impact: about 30 lines, six interface members become three. Risk medium: the "a save that landed during the read wins" rule (`:65-69`) must hold for each part; the existing tests cover it. Effort M. Confidence medium.

### 14. `computeVisible` scans every edge for every card it places

1. `src/graph/visible.ts:22-29, 58, 62, 77`.
2. `arrange` calls `neighbours(id, model.edges)` once per placed card, which is O(cards × edges), and the function runs on every keystroke in the search box. `inboundCounts` and `pickFocus` (a full sort to take the first item, `:19`) are recomputed each time although they depend only on the model and the ticked storages.
3. Before: `neighbours(queue.shift()!, model.edges)`. After: build `const adjacency = new Map<string, string[]>()` once at the top of `computeVisible` (or cache it per `model.edges` in a WeakMap, which `CardBands.tsx:144` can share) and read `adjacency.get(id) ?? []`; replace the sort in `pickFocus` with a single pass that keeps the best id.
4. Impact: for 500 marts and 1,000 edges, about 500,000 edge visits per keystroke drop to about 2,000. No lines saved. Risk low. Effort S. Confidence medium (the gain depends on project size; small projects will not notice).

### 15. Mock context: per-query rebuilds, repeated argument lists, dead endpoints

1. `src/sdk/mock/ctx.ts:105-116`: `rejectHidden` and `blendedIndex` rebuild a set and a map over every joined field on each `traverse`; `rejectUngoverned` (`:125`) builds the index a second time. `joinTree` and `joinIndex` already cache per mart.
2. `:140, 285, 302`: the list `[...columns, ...filters.map(column), ...sorts.map(column)]` is written three times.
3. `:180-187` repeats the comparator and multi-key sort of `src/sdk/mock/aggregate.ts:27, 86-93`.
4. `:243` (`GET /api/data-destinations`) and `:252-253` (`GET /api/reports/data-mart/:id`) have no caller in `src` or `e2e`. `:78` computes `hiddenFieldNames`, which nothing reads (the field in `sdk/types.ts:122` goes too).
5. `src/sdk/mock/search.ts:7` `words` repeats `src/search/prompts.ts:17` apart from the stop list.
6. Before → after: cache `blendedIndex` and the hidden set in maps like `joinTrees`; `const named = (b) => [...]`; export `sortRows(rows, sort, keyOf)` from `aggregate.ts` and use it in both; delete the two routes and `hiddenFieldNames`.
7. Impact: about 25 lines. Risk none for production. Effort S. Confidence high.

### 16. Mock AI answers the same question in two functions

1. `src/sdk/mock/ai.ts:40-44` against `:63-70`; `:51-52` against `:71-72`.
2. `asksForFilter` re-derives what `filtersAnswer` computes (date preset or status word), and the `amount` lookup with the "biggest" regex is written twice.
3. Before: two detectors. After: `const asksForFilter = (doc) => (filtersAnswer(doc) as { filters: unknown[] }).filters.length > 0;` and one `amountField(fields)` helper; `PRESETS` typed as `[RegExp, RelativeDatePreset][]`, not `unknown`.
4. Impact: about 8 lines, and the two answers cannot drift. Risk none. Effort S. Confidence high.

### 17. "Keep the source when it feeds the mart" is written four times, and actions carry a function

1. `src/state/store.tsx:51, 56-58, 86-90, 200`; `src/ui/bands/useCardClick.ts:125`; `src/ui/bands/useSmartSearch.ts:139`; `src/ui/App.tsx:146`.
2. `selectMart`, `openRecord` and `follow` take a `sourceOf` callback only to compare one mart's source key with the selected one. The same rule is then re-implemented three times in the UI for `setMarts` and `replace`.
3. Before: `dispatch({ type: 'selectMart', id, sourceOf: sourceOfModel(model) })`. After: `dispatch({ type: 'selectMart', id, martSource: model.marts.get(id)?.sourceKey ?? null })`, and one exported `keepSource(selection, martSource)` that the reducer and the three UI sites call. `SourceOf` and `sourceOfModel` go.
4. Impact: about 10 lines, and actions become plain data (loggable, comparable). Risk low. Effort M (five UI call sites, which are another reviewer's files). Confidence medium.

### 18. Store actions that overlap, and two equality rules in one file

1. `src/state/store.tsx:108` `init` is `replace` with a guard: its only dispatch (`App.tsx:138`) already checks that no mart and no source are selected.
2. `:171-176` `editGrid` and `saveGrid` differ only by the history entry, and `DataBand.tsx:35` already picks between them with a boolean.
3. `:94, 162` compare with `JSON.stringify` (sensitive to key order), while `deepEqual` at `:191` is in the same file and is what `fillGrid` and `editGrid` use.
4. Before → after: `{ type: 'grid'; martId; grid; undo?: true }` for the two grid actions; `init` dispatches `replace`; `move` and `setMarts` call `deepEqual`.
5. Impact: two action types fewer, about 6 lines. A selection built with its keys in another order would no longer add an empty history step. Risk low. Effort S. Confidence medium (no such selection exists today; all builders use the same key order).

### 19. Three filter-value normalisers ahead of one canonical check

1. `src/search/view.ts:22-63`, `src/search/report-load.ts:44-70`, `src/state/view-link.ts:137-141`; the canonical check is `isComplete` in `src/filters/build.ts:14-35`.
2. `view.ts` and `report-load.ts` each switch over `ValueKind` to shape a value and then call `isComplete`, which switches over it again. A relative preset is validated three times (`view.ts:35-43`, `report-load.ts:64-67`, `build.ts:25-33`), and only two of the three check `n`.
3. Before: two `valueFor` functions. After: one `normalizeValue(kind: ValueKind, raw: unknown, o: { coerce: boolean }): FilterValue | undefined` in `filters/build.ts` beside `isComplete` (the AI path passes `coerce: true` for numeric strings and trimming); `report-load` keeps only its datetime-bound unwrapping.
4. Impact: about 30 lines. Risk medium: the AI path is lenient (500-character cap, date regex) and the report path strict, so the shared function needs both modes tested. Effort M. Confidence medium.

### 20. Five local copies of the plain-object guard

1. `src/state/view-link.ts:134-135`, `src/search/report-load.ts:28-29`, `src/search/view.ts:18-20`, `src/api/chart-settings.ts:14`, `src/api/grid-columns.ts:34, 42`, `src/model/sources.ts:57`.
2. `isObject`, `isRecord` and `obj` are the same test; "array of strings, drop the rest" is written inline six times (`grid-columns.ts:43, 64, 69`, `chart-settings.ts:25`, `sources.ts:64`, `view-link.ts:181`).
3. Before: a local guard per file. After: `src/model/guards.ts` with `isRecord`, `strings(v: unknown): string[]` and `own(o, k)`.
4. Impact: about 12 lines. Risk none. Effort S. Confidence high. Low value on its own; do it with finding 12 or 19.

### 21. `connect.ts` checks the SDK type at run time

1. `src/sdk/connect.ts:13, 20-32`.
2. `(await connect()) as unknown as Ctx` switches the compiler off for the one place the SDK meets `Ctx`. `_typeCheck`, an exported function nobody calls, makes up for it by calling `connect()` twice and binding eight members.
3. Before: the double cast and a 13-line function. After: a type-only check, for example `type Sdk = Awaited<ReturnType<typeof connect>>; const _fits = (s: Sdk): Pick<Ctx, 'route' | 'credentials'> & { ui: Pick<Ctx['ui'], 'copyLink' | 'setRoute'>; owox: Pick<Ctx['owox'], 'models' | 'destinations' | 'putJson' | 'deleteJson'> } => s;` (never called, no `connect()` in it), or narrow the cast to the members that do not fit.
4. Impact: about 8 lines; no code path that could call `connect()` twice. Risk low. Effort S. Confidence medium (which members fail structural assignment was not tested here).

### 22. A link's filter operator is cast, not checked

1. `src/state/view-link.ts:201`.
2. `op: e[1] as OpId` accepts any string. The filter then sits in the grid state and is reported later by `ui/explorer/unapplied.ts:21` as "incomplete", not counted in the link's "parts aren't available" notice.
3. Before: `typeof e[1] !== 'string'`. After: export `OP_IDS` (or `isOpId`) from `filters/catalogue.ts` and add `!isOpId(e[1])` to the drop condition on line 200.
4. Impact: one cast fewer; an unknown operator is dropped at decode with the other malformed entries. Risk low. Effort S. Confidence medium.

### 23. Stored state that can be derived, and a per-render stringify

1. `src/state/store.tsx:20`: `record.martId` always equals `selection.martId` (every writer sets both from one id: `:114`, `:120`, `view-link-resolve.ts:88`). The only reader is `ui/bands/RowBand.tsx:23-24`.
2. `src/records/useIncomingLinks.ts:11`: filters all edges and stringifies the matches on every render of `RecordView` to build a memo key.
3. Before → after: `record: Record<string, unknown> | null` (the primary key alone); the hook keeps a `useRef` of the last result and compares the filtered edge list by id and joins, or caches `incomingLinks` per `model.edges` and mart in a WeakMap.
4. Impact: one field and three object literals; the edge scan stays but the string build goes. Risk low. Effort S. Confidence medium. Low value.

### 24. Small leftovers

1. `src/search/ai.ts:89-97`: `order` is a one-item array read at `[0]`, and the budget expression is written twice. After: `const first = role === 'discover' ? models.fast ?? models.reasoning : models.reasoning ?? models.fast; const budget = () => Math.min(deadline - Date.now(), totalMs * SHARE[role]);`.
2. `src/search/endpoint.ts:8` `MAX_FOUND` and `src/state/view-link.ts:49` `MAX_FOUND_IDS` are the same cap of 5 under two names.
3. `src/api/exports.ts:171`, `src/api/run-sql.ts:8`, `src/sdk/mock/ctx.ts:12`: three sleep helpers.
4. `src/api/exports.ts:355`: `promise: undefined as unknown as Promise<RunResult>`; build the promise first, then the flight object.
5. `src/api/ai-prompt.ts:34` and `src/filters/catalogue.ts:149` both export a `describeFilter` with different signatures; rename the prompt one (`filterSentence`).
6. Impact: about 8 lines. Risk none. Effort S. Confidence high.

## Checked and left alone

1. `runPool`, `readRows`, `loadModel`: the first reads already run in parallel; the canvas pages are serial because each needs the previous `nextOffset`.
2. `mutate` in `exports.ts:220-248` re-reads the stored document before each write on purpose (another tab may have written).
3. Exports used only by tests but needed by them (`joinedSources`, `countOptions`, `extractJson`, `truncDate`, `fromTraverseFilter`, the `*_COLLECTION` and timing constants) are not counted as dead.
4. `Role` `'formats'` in `search/ai.ts:40` is used by `src/format/ai-pick.ts:65`.
5. The mock routes for `schema-actualize-triggers`, `definition`, `publish`, `availability`, `POST /api/data-marts` and `deleteJson` are used by `src/datamart/create.ts`.
