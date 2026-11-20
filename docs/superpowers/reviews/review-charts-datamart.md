# Review: src/charts, src/datamart, src/format, and duplication across src/

Checkout: `.worktrees/main-check` at `48427cd` (origin/main). Read-only review, no file changed.

Scope read in full: `src/charts` (all non-test files), `src/datamart` (`build-sql.ts`, `dialect.ts`, `create.ts`, `engine-parity.test.ts`, the golden file and `scripts/engine-golden.cts`), `src/format`. Outside those folders I read only what the duplication check needed: `src/ui/format.ts`, `src/model/aggregation.ts`, `src/model/field-category.ts`, `src/filters/*`, `src/export/tsv.ts`, `src/search/view.ts`, `src/search/report-load.ts`, `src/state/view-link.ts`, `src/sdk/mock/aggregate.ts`, `src/sdk/mock/evaluate.ts`, `src/api/blendable.ts`, `src/api/schemas.ts`, and the cell-render lines of `src/ui/explorer/MartGrid.tsx`.

Nothing was measured. Runtime numbers below are estimates from reading the code, and each finding says so.

Effort: S is under an hour, M is a few hours, L is a day or more.

## Findings, ranked by impact divided by effort

### 1. `formatBucket` builds a date formatter on every call

1. Where: `src/model/aggregation.ts:168`. Callers: `src/charts/Scorecards.tsx:106`, `src/charts/TimeSeriesPanel.tsx:57`, `src/ui/explorer/MartGrid.tsx:155`, `src/export/tsv.ts:39`.
2. Problem: for DAY and WEEK buckets, `toLocaleDateString(locale, { dateStyle, timeZone })` creates a new `Intl.DateTimeFormat` per value.
3. Sketch:

   Before:
   ```ts
   return new Date(Date.UTC(y, mo - 1, d)).toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });
   ```
   After:
   ```ts
   const dayFormats = new Map<string, Intl.DateTimeFormat>();
   const dayFormat = (locale = '') => {
     let f = dayFormats.get(locale);
     if (!f) dayFormats.set(locale, (f = new Intl.DateTimeFormat(locale || undefined, { dateStyle: 'medium', timeZone: 'UTC' })));
     return f;
   };
   return dayFormat(locale).format(Date.UTC(y, mo - 1, d));
   ```
4. Impact: a sparkline strip calls it once per point per card on every render (60 points times the number of cards), the bar chart once per point per series (up to 9 series), and a grid grouped by day once per row. I estimate tens of milliseconds per chart render with many cards, cut to under one. Risk: none, the output text is the same. Effort: S.
5. Confidence: high.

### 2. `bucketZone` builds an `Intl.DateTimeFormat` every time a query is built

1. Where: `src/charts/queries.ts:36`, reached through `truncRule` at `:39`.
2. Problem: the default parameter `Intl.DateTimeFormat().resolvedOptions().timeZone` runs on every `sparklineQuery`, `seriesQuery`, `seriesOtherQuery` and `monthsQuery` call, and those run on every render of `ChartsBody`.
3. Sketch:

   Before:
   ```ts
   export function bucketZone(date: Field, zone: string = Intl.DateTimeFormat().resolvedOptions().timeZone)
   ```
   After:
   ```ts
   let browserZone: string | undefined;
   const zoneNow = () => (browserZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone);
   export function bucketZone(date: Field, zone: string = zoneNow())
   ```
4. Impact: removes four to ten formatter constructions per render of the Charts body (one per mart sparkline, plus the series, Other and months queries, plus the click handler). Risk: a browser that changes time zone mid-session keeps the old zone until reload. The tests pass the zone explicitly, so they are unaffected. Effort: S.
5. Confidence: high.

### 3. Type normalisation runs two or three times per grid cell, uncached

1. Where: `src/model/field-category.ts:17-36`, `src/format/formats.ts:18-23` and `:69`, `src/format/useColumnFormats.ts:131-134`, `src/ui/format.ts:71` and `:101`, called per cell from `src/ui/explorer/MartGrid.tsx:430` and `src/ui/explorer/CellValue.tsx:16-21`.
2. Problem: each cell render calls `formatOf` (`isValidFormat`, then `formatsFor`, then `categorizeFieldType`, then `normalizeType`), then either `formatValue` (`formatsFor` again) or `formatTemporal` plus `isNumericType`. Each `normalizeType` does a trim, an upper-case and two regex replaces, and `formatsFor` allocates a new array.
3. Sketch:

   Before:
   ```ts
   export function categorizeFieldType(type: string): FieldCategory { const t = normalizeType(type); ... }
   export function formatsFor(type: string): Format['kind'][] { ... return ['auto', 'plain', 'percent', 'money']; }
   ```
   After:
   ```ts
   const normalized = new Map<string, string>();
   export function normalizeType(type: string): string {
     let t = normalized.get(type);
     if (t === undefined) normalized.set(type, (t = /* the current body */));
     return t;
   }
   const NUMBER_KINDS = ['auto', 'plain', 'percent', 'money'] as const;   // one shared array per category
   ```
   A second step, in `MartGrid.tsx:408-432`: resolve `outputType(field, o.fn)` and the column's format once per column, outside the `cell` callback.
4. Impact: a 100-row, 20-column grid does about 6,000 normalisations and 4,000 small array allocations per full render. The cache turns each into a map lookup. I estimate one to three milliseconds saved per full grid render. Risk: `formatsFor` callers must not mutate the shared arrays (none do today). Effort: S.
5. Confidence: high for the redundancy, medium for the size of the saving.

### 4. The unstacked time series repeats a read the sparkline query already makes

1. Where: `src/charts/TimeSeriesPanel.tsx:40` (`seriesQuery`) and `src/charts/Scorecards.tsx:99` (`sparklineQuery`), built in `src/charts/queries.ts:65-75` and `:92-100`.
2. Problem: with no stack, `seriesQuery(date, bucket, measure)` asks for one measure by date bucket, and the measure's own mart already asks for all its metrics and its unique count by the same date bucket for the sparklines, so the series rows are a column subset of the sparkline rows.
3. Sketch:

   Before:
   ```ts
   const series = useChartQuery(martId, live && (!stack || names?.length) ? seriesQuery(date, bucket, measure, filter, stackArg) : null, version);
   ```
   After:
   ```ts
   // When nothing is stacked and the measure's mart draws sparklines on this same date, ask the sparkline's query:
   // useChartQuery shares one read per key, so the panel and the cards cost one traversal.
   const owner = cf.marts.find((m) => m.aliasPath === measurePath(measure));
   const shared = !stack && r.sparklines && owner && sparkDate(owner, r) === date && hasShownCard(owner, r)
     ? sparklineQuery(owner, date, bucket, filter) : null;
   const series = useChartQuery(martId, live ? shared ?? seriesQuery(...) : null, version);
   ```
   `measureKey(measure)` already matches the key in the sparkline rows, so the pivot code does not change.
4. Impact: one billed `traverseData` call fewer per (filter, bucket, version) in the default layout: sparklines on, no stack, first metric of the main mart, main date. That is one of about five reads when Charts opens. Risk: the shared query carries every metric of the mart, so one metric the backend refuses fails the bar chart too, where today only the sparklines fail. The condition must match `MartCards` exactly or the keys diverge and nothing is saved. Effort: S to M.
5. Confidence: medium. I did not confirm against the backend that extra aggregated columns leave the measure's values unchanged.

### 5. `tsv.ts` reimplements `outputType`

1. Where: `src/export/tsv.ts:34`, against `src/model/aggregation.ts:175-180`.
2. Problem: `typeOf(type, fn)` is the same function as `outputType(field, fn)`, branch for branch.
3. Sketch:

   Before:
   ```ts
   const typeOf = (type: string, fn: AggFn | undefined) => (fn === 'COUNT' || fn === 'COUNT_DISTINCT' ? 'INTEGER' : ...);
   ... type: typeOf(f.type, o.fn)
   ```
   After:
   ```ts
   ... type: outputType(f, o.fn)
   ```
4. Impact: one line and one import removed, and a new function such as a percentile gets one place to be typed. A third copy of the same knowledge is `NUMERIC_RESULT` in `src/filters/slice.ts:11-18`, which could be `categorizeFieldType(outputType(field, fn)) === 'number'` if SUM is added to the reasoning (SUM keeps the field type in `outputType`, so check that before merging). Risk: none for the tsv change. Effort: S.
5. Confidence: high.

### 6. `ui/format.ts` keeps its own date-type sets

1. Where: `src/ui/format.ts:34-37`, against `src/model/field-category.ts:9-12` and `:27`.
2. Problem: `DATE_ONLY` is `isDayType`, and `MOMENT` lists exactly the members of field-category's `DATE` set minus `'DATE'`, so a new warehouse type has to be added in two files.
3. Sketch:

   Before:
   ```ts
   const DATE_ONLY = new Set(['DATE']);
   const MOMENT = new Set(['TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', ..., ...WALL_CLOCK]);
   if (DATE_ONLY.has(t)) { ... }
   if (!MOMENT.has(t)) return null;
   ```
   After:
   ```ts
   if (t === 'DATE') { ... }
   if (categorizeFieldType(type) !== 'date') return null;
   ```
   `WALL_CLOCK` stays, because only this file needs it.
4. Impact: about three lines removed and one list instead of two. Risk: none today, the sets are equal (I compared them member by member). Effort: S.
5. Confidence: high.

### 7. `useBucket` runs two query hooks where one is ever active

1. Where: `src/charts/useBucket.ts:25-27`.
2. Problem: `range` and `months` are two `useChartQuery` calls, and `rangeable` decides which one gets options, so the other always holds `null`.
3. Sketch:

   Before:
   ```ts
   const range = useChartQuery(martId, auto && rangeable ? rangeQuery(date!, filter) : null, version);
   const months = useChartQuery(martId, auto && !rangeable ? monthsQuery(date!, filter) : null, version);
   const read = rangeable ? range : months;
   ```
   After:
   ```ts
   const read = useChartQuery(martId, auto ? (rangeable ? rangeQuery : monthsQuery)(date!, filter) : null, version);
   ```
4. Impact: two lines removed, one state and one effect fewer per Charts body. Risk: none, the keys differ, so a change of `rangeable` still reads again. Effort: S.
5. Confidence: high.

### 8. The chart row cache only grows

1. Where: `src/charts/useChartQuery.ts:9-14` and `:47`.
2. Problem: every resolved read is stored under `martId:version:options` and nothing removes it, so each filter edit, bucket change and refresh leaves its rows in memory for the life of the ctx.
3. Sketch:

   Before:
   ```ts
   cacheOf(ctx).set(key, rows);
   ```
   After:
   ```ts
   const c = cacheOf(ctx);
   c.set(key, rows);
   if (c.size > 64) c.delete(c.keys().next().value!);   // oldest first: a Map keeps insertion order
   ```
4. Impact: bounds memory in a long session. A stacked series is up to 60 buckets times 8 values per entry, and a member who filters for an hour adds hundreds of entries. Risk: an evicted entry is read again (and billed) if the member returns to that exact view. 64 entries cover about ten views. Effort: S.
5. Confidence: high.

### 9. `ChartsBody` and its panels recompute everything on every render

1. Where: `src/charts/ChartsBody.tsx:52-54`, `src/charts/useChartQuery.ts:27` and `:33`, `src/charts/Scorecards.tsx:103-108`, `src/charts/TimeSeriesPanel.tsx:51-65` and `:93-97`.
2. Problem: `chartFields`, `resolveCharts`, every query builder, a key-sorted `JSON.stringify` per hook, the sparkline points of every card and the bar chart's pivot all run again on each render, and `scrollerWidth` re-renders the body on every resize step.
3. Sketch:

   Before:
   ```ts
   const cf = chartFields(schema, shown, agg, martId, groups.map(...), uniqueCountPaths, Object.fromEntries(...));
   const r = resolveCharts(settings ?? {}, cf);
   ```
   After:
   ```ts
   const cf = useMemo(() => chartFields(...), [schema, shown, agg, martId, groups, sources]);
   const r = useMemo(() => resolveCharts(settings ?? {}, cf), [settings, cf]);
   // In the panels: useMemo the options object on (r, filter, bucket), and the Series[] on (series.rows, other.rows, names).
   // In MartCards: build the bucket labels once per spark.rows, not once per card.
   ```
   With stable `cf` and `r`, wrap `TimeSeriesPanel`, `PiePanel` and `MartCards` in `memo` so a resize repaints only the sticky wrapper.
4. Impact: a resize drag stops rebuilding eight to twelve option objects and their sorted JSON keys per frame. I estimate one to a few milliseconds per frame, more with many joined marts. Risk: a missed dependency shows stale charts, and the inline `onChange` closures in `ChartsBody.tsx:97-99` need `useCallback` for `memo` to hold. Effort: M.
5. Confidence: medium.

### 10. `build-sql.ts` catches the same error in four places

1. Where: `src/datamart/build-sql.ts:180`, `:222`, `:281`, `:357`.
2. Problem: four `try { ... } catch (e) { return { reason: e instanceof Error ? e.message : String(e) }; }` blocks wrap the only calls that throw (`renderFilter` and `dateTrunc`).
3. Sketch:

   Before:
   ```ts
   for (const { flt, field } of active) {
     try { where.push(renderFilter(d, ref(field), field, flt)); } catch (e) { return { reason: ... }; }
   }
   ```
   After:
   ```ts
   // dialect.ts
   export class SqlError extends Error {}          // thrown by literal, wholeN, relative, dateTrunc
   // build-sql.ts
   export function buildMartSql(input) {
     try { ...prepare, assemble... } catch (e) { if (e instanceof SqlError) return { reason: e.message }; throw e; }
   }
   const where = active.map(({ flt, field }) => renderFilter(d, ref(field), field, flt));
   ```
4. Impact: about ten lines removed, and the loops at `:178-181`, `:220-223`, `:276-281` and `:354-357` become plain maps. A real bug (a `TypeError`) now throws where today the menu shows it as a reason. Risk: low, the parity and unit tests cover every reason text. Effort: S.
5. Confidence: high.

### 11. `build-sql.ts` assembles the same SQL fragments by hand in several places

1. Where: `src/datamart/build-sql.ts`: the ON clause at `:208`, `:218` and `:288`; the indented list at `:212`, `:233`, `:332`, `:344` (twice) and `:376`; the identifier test at `:132` and `:287`; the query tail at `:231-238` and `:374-384`.
2. Problem: the join condition is written three times, the "indent each item and join with a comma and a newline" expression six times, and `assembleFlat` repeats the WITH, SELECT, FROM, joins, WHERE and ORDER BY skeleton of `assembleGrouped`.
3. Sketch:

   Before:
   ```ts
   `LEFT JOIN ${cte.get(root)} ON ${plans.get(root)!.edge.joins.map((j) => `base_owox.${fieldRef(d, j.sourceField)} = ${cte.get(root)}.${fieldRef(d, j.targetField)}`).join(' AND ')}`
   `SELECT\n${items.map((x) => `      ${x}`).join(',\n')}`
   ```
   After:
   ```ts
   const on = (d, left, right, edge) => edge.joins.map((j) => `${left}.${fieldRef(d, j.sourceField)} = ${right}.${fieldRef(d, j.targetField)}`).join(' AND ');
   const list = (items: string[], indent: number) => items.map((x) => ' '.repeat(indent) + x).join(',\n');
   const plainName = (s: string) => /^[a-z_][a-z0-9_]*$/.test(s);
   const outer = (p: Plan, q: { ctes; items; joins; groupBy?; having?; orderBy }) => [ ... ].join('\n');   // used by both assemblers
   ```
4. Impact: about 20 lines removed, and the two 300-character template lines at `:332` and `:344` become readable. No runtime change. Risk: low, `engine-parity.test.ts` and the exact-string tests in `build-sql.test.ts` catch any whitespace drift. Effort: S to M.
5. Confidence: high.

### 12. `assembleGrouped` rebuilds what `prepare` already resolved

1. Where: `src/datamart/build-sql.ts:247-251`, against `:89-95`; `fnsOf` at `:251`; `buildMartSql` at `:392`.
2. Problem: the grouped assembler builds `byName`, the visible set and the shown columns again, calls `keepVisible` a second time, and `fnsOf` filters the whole rule list on every call (it runs five or six times per field).
3. Sketch:

   Before:
   ```ts
   function assembleGrouped(p: Plan, input: MartSqlInput, agg: Aggregation)
   const byName = new Map(input.schema.map(...)); const visible = new Set(input.visible);
   const fnsOf = (f) => [...new Set(rules.filter((r) => r.column === f.name).map((r) => r.function))];
   ```
   After:
   ```ts
   // Plan gains: byName, agg (the kept aggregation), fns: Map<string, AggFn[]> built once in prepare.
   function assembleGrouped(p: Plan): string | Reason
   const fnsOf = (f: Field) => p.fns.get(f.name) ?? [];
   ```
4. Impact: about eight lines removed and `assembleGrouped` takes one argument. The runtime gain is negligible (the SQL is built inside a `useMemo` in `ExportMenu.tsx:115`). Risk: `cols` is in schema order and `p.shown` in grid order, and the key order of GROUP BY depends on `cols`, so keep that distinction. Effort: S.
5. Confidence: high.

### 13. Dead fields in the chart model

1. Where: `src/charts/fields.ts:7`, `:9`, `:11`, `:16`, `:56`, `:59`, `:70`; `src/charts/queries.ts:10`.
2. Problem: `ChartFields.metrics`, `Metric.martId` and the `martId` of a records `Measure` have no reader outside tests, and `ChartMart.martId` is read only to copy it into that `Measure` (grep for `.metrics` and `.martId` under `src/charts`: the only non-test reads are `mart.metrics`, `m.metrics` and `fields.ts:16`).
3. Sketch:

   Before:
   ```ts
   export type Metric = { field: Field; fn: AggFn; martId: string };
   export type ChartFields = { marts: ChartMart[]; metrics: Metric[]; dimensions: Field[]; dates: Field[]; counter?: Field | null };
   export type Measure = ... | { kind: 'records'; aliasPath: string; martId: string; recordsId: string };
   ```
   After:
   ```ts
   export type Metric = { field: Field; fn: AggFn };
   export type ChartFields = { marts: ChartMart[]; dimensions: Field[]; dates: Field[]; counter?: Field | null };
   export type Measure = ... | { kind: 'records'; aliasPath: string; recordsId: string };
   ```
   `martId` stays a local in `chartFields`, where `recordsId` needs it.
4. Impact: about six lines in source, and about 19 `martId: '...'` and several `metrics:` literals in the chart tests. The tests that assert `m.martId` (`fields.test.ts:32`, `:59-76`, `settings.test.ts:16`) move to `aliasPath` or `recordsId`. Risk: none at runtime. Effort: S.
5. Confidence: high.

### 14. A measure's value text is written out three times

1. Where: `src/charts/PiePanel.tsx:36`, `src/charts/TimeSeriesPanel.tsx:53` and `:68-70`, `src/charts/Scorecards.tsx:46-51` and `:54-59`. The empty-state sentence repeats at `PiePanel.tsx:51`, `TimeSeriesPanel.tsx:90`, `Scorecards.tsx:101` and `MartGrid.tsx:765`.
2. Problem: "a metric is shown through `metricText`, a records count through `formatNumber` with a string fallback" is spelled inline in the pie, the bar chart and the cards, and the pair "output type plus the format that keeps its unit" is derived three times.
3. Sketch:

   Before:
   ```ts
   valueText: measure.kind === 'metric' ? metricText(measure.metric.field, measure.metric.fn, v, formatOf) : formatNumber(v) ?? String(v ?? '')
   ```
   After:
   ```ts
   // Scorecards.tsx
   export const measureFormat = (m: Measure, formatOf: Formatter): [type: string, format: Format] => ...;
   export const measureText = (m: Measure, v: unknown, formatOf: Formatter): string => ...;
   export const emptyText = (hasFilters: boolean) => (hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.');
   ```
   `Card` can then hold a `Measure` in place of the optional `field` and `fn` pair, which removes the `card.fn!` assertions.
4. Impact: about 12 lines removed and one place to change how a count is shown. Risk: low. Effort: S.
5. Confidence: high.

### 15. Three "Other" and series builders differ by one filter

1. Where: `src/charts/queries.ts:92-112`.
2. Problem: `seriesOtherQuery` rebuilds the option object `seriesQuery` builds without a stack, and `seriesOtherQuery` and `pieOtherQuery` each spell the `notBlank` plus `not_in` pair.
3. Sketch:

   Before:
   ```ts
   export function seriesOtherQuery(date, bucket, measure, filter, dim, top) {
     return withFilter({ column: [date.name, ...measureColumns(measure)], ...measureParts(measure), dateTrunc: [...], sort: [...] },
       [...filter, notBlank(dim), { column: dim.name, operator: 'not_in', value: list(top) }]);
   }
   ```
   After:
   ```ts
   const outside = (dim: Field, top: string[]): TraverseFilter[] => [notBlank(dim), { column: dim.name, operator: 'not_in', value: list(top) }];
   export const seriesOtherQuery = (date, bucket, measure, filter, dim, top) => seriesQuery(date, bucket, measure, [...filter, ...outside(dim, top)]);
   ```
4. Impact: about six lines removed. The property order of the built object changes, which `stable()` in `useChartQuery.ts:27` already ignores. Risk: `queries.test.ts` compares with `toEqual`, which also ignores key order. Effort: S.
5. Confidence: high.

### 16. "Is this a finite number" exists in six forms

1. Where: `src/charts/Scorecards.tsx:86-90` (`numberOf`), `src/charts/compact.ts:18-22` (`toNumber`), `src/format/formats.ts:58-61` (`toNumber`), `src/filters/build.ts:12` (`numeric`), `src/search/view.ts:22-26` (`numeric`), `src/api/ai-prompt.ts:72`.
2. Problem: each module parses "a number or a numeric string" itself, and the copies disagree on the edges: `numberOf` reads `true` as 1 and `'  '` as 0, `compact.ts` rejects booleans, `formats.ts` rejects anything that is not a number or a string.
3. Sketch:

   Before: six local helpers.

   After:
   ```ts
   // src/model/number.ts
   /** A finite number from a number or a non-blank numeric string; null for anything else. */
   export const toNumber = (v: unknown): number | null => ...;   // the formats.ts version
   ```
   The three in my folders switch to it first. The other three are for the other reviewers to confirm.
4. Impact: about 12 lines removed, and a boolean dimension value can no longer be drawn as a bar of height 1. Risk: `numberOf('  ')` changes from 0 to null, which only affects a blank string in a measure column. Effort: S.
5. Confidence: medium, because of the edge differences.

### 17. Two compact-number formatters

1. Where: `src/ui/format.ts:2-9` (`compactNumber`, used by `src/ui/bands/cards.tsx:122`) and `src/charts/compact.ts:7` (`Intl.NumberFormat('en-US', { notation: 'compact' })`).
2. Problem: the card badge shortens numbers by hand (K, M, B) and the scorecards shorten them with `Intl`, so 999,950 reads "1000K" on a card and "1M" on a scorecard, and 1e12 reads "1000B" against "1T".
3. Sketch:

   Before:
   ```ts
   export function compactNumber(n: number): string { ... if (abs >= 1e9) return fmt(n / 1e9, 'B'); ... }
   ```
   After:
   ```ts
   const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
   export const compactNumber = (n: number): string => compact.format(n);   // charts/compact.ts imports the same instance
   ```
4. Impact: seven lines removed and one rounding rule. Risk: `format.test.ts:5` pins the current strings, so check each expected value. `Intl` prints "1.2K" for 1,234 where the hand version prints the same, but the thresholds near a unit boundary differ as shown above. Effort: S.
5. Confidence: medium.

### 18. The Auto bucket's range read could ride on the scorecards read

1. Where: `src/charts/useBucket.ts:25`, `src/charts/queries.ts:45-58`, `src/charts/Scorecards.tsx:40-42`.
2. Problem: with the bucket on Auto, the date's MIN and MAX go out as their own query, although the scorecards query is also a one-row, no-key aggregate over the same filters.
3. Sketch:

   Before:
   ```ts
   scorecardsQuery(marts, filter, counter)            // one read
   rangeQuery(date, filter)                           // a second read
   ```
   After:
   ```ts
   scorecardsQuery(marts, filter, counter, autoRange ? date : null)
   // adds column date.name with MIN and MAX; useBucket reads rangeKeys(date) from the scorecards row
   ```
4. Impact: one billed read fewer per (filter, version) while the bucket is Auto and the date allows MIN and MAX. Risk: the scorecards key now depends on the chosen date, so a change of date field reads the scorecards again. A date the backend refuses takes the scorecards down with it. A mart with no metric and no primary key has no scorecards query to ride on, so the separate query must stay as the fallback. Effort: M.
5. Confidence: medium. Finding 4 gives the same saving at lower risk, so do that one first.

### 19. The engine parity cases are written twice

1. Where: `scripts/engine-golden.cts:60-180` (17 cases in the engine's shape) and `src/datamart/engine-parity.test.ts:16-146` (the same 17 in the plugin's shape), compared through `canon` at `:163-266`.
2. Problem: each case is hand-kept in two files in two shapes, and only a count check (`engine-parity.test.ts:285`) ties them together, so a case edited in one file passes or fails for the wrong reason.
3. Sketch:

   Before: `Case[]` in the script, `PCase[]` in the test, `engine-sql.json` holds `{ case, dialect, sql }`.

   After: one `src/datamart/__golden__/cases.ts` in the plugin's shape (`PCase`), imported by the test. The script imports the same file and derives the engine's shape with one mapper (`marts`, `columns`, `types`, `filters` through `toTraverseFilters`, `agg`, `trunc`).
4. Impact: about 110 lines removed from the script, and a new case is written once. Risk: the script runs under ts-node from the engine's checkout as CommonJS (the header at `:1-13` explains why it is `.cts`), so importing a plugin module that pulls `filters/build.ts` needs that toolchain to resolve it. If that fails, write the cases as JSON. Effort: M.
5. Confidence: medium. I did not run the script.

   `canon` itself (about 100 lines of regex) is the price of comparing two SQL shapes that differ on purpose. I found no smaller form that keeps the per-path checks, so I would leave it.

### 20. Untrusted rules are validated by three separate parsers

1. Where: filter value shapes in `src/filters/build.ts:14-35` (`isComplete`), `src/search/view.ts:22-64` (`valueFor`) and `src/search/report-load.ts:44-70` (`valueFor`). Aggregation and bucket rules in `src/state/view-link.ts:226-246`, `src/search/view.ts:79-94` and `src/search/report-load.ts:148-157`.
2. Problem: a link, an AI answer and a saved report each check "is this function known, is this bucket known, is this value the shape the operator takes" with their own switch on `ValueKind` and their own `AGGREGATE_FUNCTIONS.includes` loop.
3. Sketch:

   Before: three `switch (def.value)` blocks and three rule loops.

   After:
   ```ts
   // src/model/aggregation.ts
   export const isAggFn = (v: unknown): v is AggFn => (AGGREGATE_FUNCTIONS as readonly unknown[]).includes(v);
   export const isDateBucket = (v: unknown): v is DateBucket => (DATE_BUCKETS as readonly unknown[]).includes(v);
   // src/filters/build.ts
   export function coerceValue(kind: ValueKind, raw: unknown, opts: { parseStrings: boolean }): FilterValue | undefined
   ```
   The two type guards alone replace seven casts of the form `(AGGREGATE_FUNCTIONS as readonly unknown[]).includes(x)`.
4. Impact: the guards are a ten-minute change that removes the casts. Sharing `coerceValue` removes about 25 lines but the three callers differ on purpose (the AI path accepts numeric strings and trims, the report path does not), so it needs care. Risk: low for the guards, medium for the shared coercion. Effort: S for the guards, M for the rest.
5. Confidence: medium. These files belong to the other reviewers.

### 21. `relative()` repeats eleven cases for four dialects

1. Where: `src/datamart/dialect.ts:167-256`.
2. Problem: the Athena, Snowflake and Redshift blocks are the same eleven lines with different spellings of "today", "truncate" and "add", and Databricks differs in three of them.
3. Sketch:

   Before: four `switch (p.kind)` blocks of eleven cases.

   After:
   ```ts
   type Dates = { today: string; trunc(unit: string, base?: string): string; add(unit: 'day' | 'week' | 'month' | 'year', k: number | string, base: string): string; week?: { ... } };
   const DATES: Record<Exclude<Dialect, 'bigquery'>, Dates> = { athena: {...}, snowflake: {...}, redshift: {...}, databricks: {...} };
   const range = (col: string, from: string, to: string) => `${col} >= ${from} AND ${col} < ${to}`;
   // one switch over p.kind for the four dialects; BigQuery keeps its own block (it compares DATE(col) and uses <=).
   ```
4. Impact: about 30 lines removed. Risk: the output must match the engine's text exactly, and three spellings differ per dialect (the week arithmetic on Snowflake, `add('week', 1, ...)` on Athena against `add('day', 7, ...)` on Redshift, and `last_month` on Databricks). `dialect.test.ts` covers them, so a slip fails a test, but the shared table may end up as long as what it replaces. Effort: M.
5. Confidence: medium.

### 22. A `Field` factory is redefined in 22 test files

1. Where: `src/charts/{copies,queries,settings,fields}.test.ts`, `src/datamart/{build-sql,engine-parity,dialect}.test.ts`, `src/format/{ai-pick.test.ts,useColumnFormats.test.tsx}` and 13 more (grep for `): Field =>` in tests). `build-sql.test.ts:12-19` and `engine-parity.test.ts:27-34` also both define the same `edges`.
2. Problem: each test file builds `{ name, alias: null, type, category, description: null, isPrimaryKey: false }` with its own argument order.
3. Sketch:

   Before:
   ```ts
   const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: ..., category, description: null, isPrimaryKey: false, ...extra });
   ```
   After:
   ```ts
   // src/test-fields.ts, beside src/api/test-ctx.ts
   export const field = (name: string, type = 'STRING', extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category: categorizeFieldType(type), description: null, isPrimaryKey: false, ...extra });
   ```
4. Impact: about 22 lines removed, and a new required property on `Field` is added in one place. Risk: some factories take a category that does not match the type on purpose (`settings.test.ts:7` uses type `'X'`), so those keep an override. Effort: M, because of the 22 call-site styles.
5. Confidence: high for the duplication, low for the urgency.

### 23. `renderTraverse` carries list operators only its test uses

1. Where: `src/datamart/dialect.ts:259-262` and `:301-305`; `src/datamart/dialect.test.ts:178-186`.
2. Problem: `renderFilter` is the only production caller, `toTraverseFilter` never returns `in` or `not_in`, and the comment at `:261` says the branches are "kept for the day the grid offers them".
3. Sketch:

   Before:
   ```ts
   export const renderFilter = (d, col, field, f) => renderTraverse(d, col, field, toTraverseFilter(f, field));
   export function renderTraverse(d, col, field, t: TraverseFilter): string { ... case 'in': case 'not_in': ... }
   ```
   After:
   ```ts
   export function renderFilter(d, col, field, f: ColumnFilter): string {
     const t = toTraverseFilter(f, field) as Exclude<TraverseFilterRule, { operator: 'in' | 'not_in' }>;
     ...
   }
   ```
4. Impact: six source lines and nine test lines removed, one export fewer. Risk: none today. If the grid gains a list filter soon, leave it. Effort: S.
5. Confidence: high that it is unused, medium that removing it is wanted.

### 24. The same small lookups are rebuilt across modules

1. Where:
   1. `src/state/join-plan.ts:13-34` and `:58-62`: `joinedMartIds`, `joinedPaths` and `inUsePaths` each build the same "field name to source" map with the same double loop.
   2. `src/api/blendable.ts:63-83`, `src/api/schemas.ts:20-63` and `src/charts/useChartQuery.ts:9-24`: three "done map plus in-flight map, drop the flight when it settles" loaders.
   3. `src/charts/useChartQuery.ts:9-24` and `src/format/useColumnFormats.ts:116-123`: three `WeakMap<Ctx, Map<...>>` get-or-create helpers.
   4. `e instanceof Error ? e.message : String(e)`: `src/ui/explorer/ExportMenu.tsx:59`, `src/api/exports.ts:117`, `src/search/ai.ts:79`, and four times in `build-sql.ts` (finding 10). `src/datamart/create.ts:28-32` has a richer `messageOf` of its own.
2. Problem: each is a three-to-ten-line idiom copied where one helper would do.
3. Sketch:

   Before:
   ```ts
   const caches = new WeakMap<Ctx, Map<string, Row[]>>();
   const cacheOf = (ctx: Ctx) => { let c = caches.get(ctx); if (!c) caches.set(ctx, (c = new Map())); return c; };
   ```
   After:
   ```ts
   // src/sdk/per-ctx.ts
   export const perCtx = <T>(make: (ctx: Ctx) => T) => { const m = new WeakMap<Ctx, T>(); return (ctx: Ctx) => { let v = m.get(ctx); if (!v) m.set(ctx, (v = make(ctx))); return v; }; };
   const cacheOf = perCtx(() => new Map<string, Row[]>());
   ```
   For item 1: one `ownerOf(sources): Map<string, JoinedSource>` in `join-plan.ts`, read by all three functions.
4. Impact: about 25 lines removed across the four items. Risk: low. Effort: S each.
5. Confidence: high for items 1, 3 and 4. Medium for item 2: the three loaders differ in abort and invalidation handling, so a shared helper may not be simpler.

### 25. Dates are taken apart by hand in six places

1. Where: `src/charts/clickFilters.ts:9`, `:35`, `:47` (`split('-').map(Number)` three times), `src/charts/useBucket.ts:9-14` (`monthEnd`), `src/charts/fields.ts:77` (`parseStamp`), `src/model/aggregation.ts:156-163`, `src/sdk/mock/aggregate.ts:13-15`, `src/ui/format.ts:73`.
2. Problem: "read YYYY-MM-DD from the front of a value and build a UTC date" is written again in each module, and `monthEnd` duplicates what `bucketEnd(start, 'MONTH')` plus one day already computes.
3. Sketch:

   Before:
   ```ts
   const [y, m, d] = day.split('-').map(Number) as [number, number, number];
   const nextDay = (day: string) => { const [y, m, d] = ...; return iso(new Date(Date.UTC(y, m - 1, d + 1))); };
   function monthEnd(v: unknown): unknown { const m = /^(\d{4})-(\d{2})/.exec(String(v)); ... }
   ```
   After:
   ```ts
   // src/model/day.ts
   export const ymd = (v: unknown): [y: number, m: number, d: number] | null => ...;   // the DATE_PART regex
   export const addDays = (day: string, n: number): string => ...;
   // useBucket.ts
   const monthEnd = (v: unknown) => (ymd(v) ? addDays(bucketEnd(String(v), 'MONTH'), 1) : v);
   ```
4. Impact: about ten lines removed and one regex for "starts with a date". `zoneOffset` at `clickFilters.ts:28-31` also builds a formatter per call, up to ten per click. That only runs on a click, so I would not cache it. Risk: low, `clickFilters.test.ts` and `useBucket.test.tsx` pin the results. Effort: S.
5. Confidence: medium.

## What I checked and found fine

1. `src/datamart/create.ts`: the five stages are serial because each depends on the one before. No dead export (`CREATE_STAGE_LABEL`, `deleteDraft` and `CreateMartError` are all used by `ExportMenu.tsx`).
2. `src/format/formats.ts` and `src/charts/compact.ts`: the money, percent and compact `Intl.NumberFormat` objects are cached per currency. `src/ui/format.ts:39-49` caches its three date formatters.
3. `src/charts/useChartQuery.ts`: identical queries from two panels already share one read (the pie's top values and the stack's top values when the dimension and measure match).
4. The serial reads in `TimeSeriesPanel` and `PiePanel` (top values, then series or Other) are needed: the second query's filter is the first one's result.
5. `src/datamart/dialect.ts` keeps its own type sets (`E_STRING`, `E_NUMBER`, `CAST_TYPES`, `isFloat`). They mirror the engine's case-sensitive rules on purpose, so I would not merge them with `field-category.ts`.
6. `ExportMenu.tsx:129-131` calls `buildMartSql` twice per variant (with and without the sort). A sort on a hidden joined column adds a CTE, so the sorted SQL cannot be derived from the plain one by appending ORDER BY.

## Totals

1. Findings: 25. By confidence: 16 high, 9 medium.
2. By effort: 17 S, 3 S to M, 5 M, 0 L.
3. Lines removed if all are taken: about 190 in source and scripts (110 of them from finding 19), plus about 60 in tests.
4. Billed reads saved: one per chart view from finding 4, and one more under Auto bucket from finding 18.
5. Render time: findings 1, 2, 3 and 9 remove per-render formatter construction and repeated parsing. All four savings are estimates, not measurements.
