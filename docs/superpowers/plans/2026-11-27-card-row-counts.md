# Card row counts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every data mart card shows "X rows": `COUNT(*)` of that mart, narrowed by the filters and slices on its own fields only, with no match percentage and no crossing with the main data mart.

**Architecture:** the card count becomes `COUNT(*)` read through the backend's `includeTotalRowCount` on a one-row read of the mart alone. The unfiltered count stays in the per-member `row-counts` collection, now valid until the mart's data changes. A filtered count is a second read of the same shape with the card's own rules, cached in memory per ctx. The grid stops computing match counts and instead tells the page which rules belong to which card; when the grid's own total already is the main card's number, it hands it over and no read is sent.

**Tech Stack:** React 19, TypeScript, Vitest, `@owox/api-client` (`traverseData`, `includeTotalRowCount`).

**Spec:** the design agreed in the session of 2026-11-27, restated in full in "Design" below. There is no separate spec file.

## Design

1. One metric on every card: rows, `COUNT(*)`. Unique Count is a grid and chart metric the member picks; cards never read it.
2. The badge reads "X rows". With rules on the card's own fields it is the filtered number, and its tooltip reads "X of Y rows match this data mart's filters", where Y is the unfiltered count. Without such rules the badge is the unfiltered count and the tooltip is the exact number ("1,234 rows").
3. A card's own rules:
   1. Main card: filter rules (no `placement`, no `function`) on the main mart's own fields that are not calculated.
   2. Joined card at alias path P: slices (`placement: 'pre-join'`) on fields whose `joined.aliasPath` is P, sent with the column renamed to `joined.originalName`.
   3. A filter rule on a joined field (post-join) narrows main rows by the joined mart's rolled-up value. It is a crossing, so no card counts it.
   4. A HAVING rule (`function` set) filters groups, so no card counts it.
   5. A main filter on a calculated row-level field cannot be counted on the mart alone. The main card then shows its unfiltered count, and the tooltip adds "Filters on calculated fields are not counted."
   6. A slice whose field has no `joined.originalName` is skipped the same way, with the same note on that card.
4. Count read: `traverseData(martId, { column: [field], limit: 1, includeTotalRowCount: true, filter? })`, where `field` is the narrowest non-calculated field (category order `boolean`, `date`, `time`, `number`, `string`, `other`; first in schema order within a category). The count is `traversal.totalRowCount`. When it is `undefined` (the count failed, took over 60 s, or the server is older) the read is an error, never 0.
5. Unfiltered cache: the `row-counts` collection, as today. An entry counted after the mart's `dataLastUpdatedAt` is used at any age. An entry older than the last update is used for 1 h after it was counted. With no `dataLastUpdatedAt`, the 24 h rule of today applies. Exact rule in Task 1.
6. Filtered cache: in memory per ctx (`perCtx`), LRU of 64 entries, keyed by `stable([martId, rules, dataLastUpdatedAt, day])`, where `day` is the local date (`YYYY-MM-DD`) when any rule is `relative_date` and `''` otherwise. The same mart at two paths with the same rules shares one entry and one read. A failed read is never cached.
7. Free path for the main card: when the grid's read is plain (Table, ungrouped, no `aggregation`, `dateTrunc` or `uniqueCount`, no calculated field among its columns or filters, `counted.exact` false), its post-join rules are all main-card rules (item 3.1), and its total came from a read of this mount (`counted.fresh`), the grid's total is the main card's number. With no main rules it is the unfiltered count (stored in `row-counts`, as `onTotal` does today); with main rules it is stored as the filtered count for those rules. Joined columns and slices are allowed: OWOX LEFT JOINs every joined mart rolled up to one row per key, so they never change the main row count.
8. The match badge, its scorecard read in Table, `matchLabel`, `Matched` and the `kept` unique counts that exist only for badges are removed.
9. "records" becomes "rows" in every user-visible count text: cards, their tooltips, the Data band's total, and the README. "Unique Count" and "Count Unique" keep their names. "Record" as in the Row band ("open a record") is not a count and stays.
10. Grid Refresh keeps today's card behaviour for the unfiltered count (hold and take the grid's total, or recount once). It also forgets the filtered cache entries of the grid's main mart, so a filtered main card is read again (or taken from the grid's new total).

## Global Constraints

1. Every `traverseData` call is a billed warehouse query, and `includeTotalRowCount: true` costs one more. The only new reads are the filtered count reads of Design item 4, at most one per distinct `(martId, rules, dataLastUpdatedAt, day)`.
2. Tests: Vitest, `npx vitest run <files> --maxWorkers=4`. Never run Vitest without the worker cap. `npx tsc -b` and `npx eslint <changed files>` must pass before each commit. Run the whole suite once at the end of Task 5 with `npx vitest run --maxWorkers=4`.
3. Work in the worktree `/Users/flakss/Projects/data-explorer/.claude/worktrees/card-row-counts` on branch `feat/card-row-counts`. Never touch the main checkout: other sessions use it.
4. Comments and README text follow the repo's style: plain, short sentences, no marketing words, no em dashes in new text.
5. Commit per task. The summary line is a plain sentence in the repo's style (see `git log --oneline -20`). End every commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
6. Run the tasks in order, one at a time. Tasks 3, 4 and 5 edit `src/ui/useModelData.ts`, `src/ui/App.tsx` and `src/ui/bands/cards.tsx` in turn.
7. Each test listed under a task must fail on the code before that task and pass after it, unless the task says it pins existing behaviour.
8. The mock backend (`src/sdk/mock/ctx.ts:249-259`) already answers `includeTotalRowCount` with the unlimited row count after filters. Tests use it or `stubCtx`/`traversalOf` from `src/api/test-ctx.ts`; check how `traversalOf` sets `totalRowCount` and extend it there if it cannot.

## Review Focus

1. A main filter on a calculated row-level field: the main card must show the unfiltered count with the "not counted" note, never a number filtered by only some of the rules. Pinned in Task 2 (rule split) and Task 5 (tooltip).
2. A post-join filter on a joined field: no card changes, and the grid's total must not be handed to the main card. Pinned in Task 2 and Task 4.
3. The count header is missing (timeout, older server): the card shows the error badge with retry, not "0 rows". Pinned in Task 1 and Task 3.
4. The same mart joined at two paths with the same slices: one read, both cards show it. Pinned in Task 3.
5. A "Last 7 days" rule kept open past midnight: the next day's request reads again. Pinned in Task 3.

---

### Task 1: The unfiltered card count is `COUNT(*)`, cached until the data changes

**Files:**
- Modify: `src/api/row-counts.ts`
- Modify: `src/ui/useModelData.ts:56-58` (pass the mart's `dataLastUpdatedAt`)
- Modify: `src/ui/bands/cards.tsx:124-126` (the "no count" tooltip)
- Test: `src/api/row-counts.test.ts`

**Interfaces:**
- Produces:
  1. `countField(schema: Schema): string | null`: the narrowest non-calculated field name (Design item 4), `null` for a schema with none.
  2. `countRows(ctx: Ctx, martId: string, schema: Schema, filter?: TraverseFilter[]): Promise<number | null>`: one read of Design item 4. `null` when `countField` is `null`. Throws `new Error("The row count did not arrive")` when `totalRowCount` is `undefined`. Uses `readRows` from `src/api/rows.ts` with `onTotalRowCount`.
  3. `RowCounter.count(id: string, schema: Schema, updatedAt: string | null): Promise<number | null>` and `RowCounter.recount(id: string, schema: Schema): Promise<number | null>`. `store` is unchanged.
  4. `countOptions` is deleted.

Today `countOptions` (`row-counts.ts:11-17`) sends `uniqueCount: ['']` for a mart with a key and a `COUNT` of the first text, boolean or other field otherwise, and `count` trusts any entry under 24 h old (`row-counts.ts:38-42`).

Freshness rule for `count`, with `now = Date.now()`, `at = Date.parse(doc.at)`, `upd = updatedAt ? Date.parse(updatedAt) : NaN`:

```ts
const fresh = (at: number, upd: number, now: number): boolean => {
  if (!Number.isFinite(at)) return false;
  if (!Number.isFinite(upd)) return now - at < COUNT_MAX_AGE_MS;      // no timestamp: 24 h, as today
  if (at >= upd) return true;                                        // counted after the last update
  return now - at < COUNT_MIN_AGE_MS;                                // updated since, but keep it for 1 h
};
```

with `COUNT_MAX_AGE_MS = 24 * 3600_000` and `COUNT_MIN_AGE_MS = 3600_000`. A count taken after the last update never expires by age: the data has not changed.

- [ ] **Step 1: Write the failing tests** in `src/api/row-counts.test.ts`. Replace the `countOptions` tests and keep the file's helpers (`field`, `withPk`, `stubCtx`, `traversalOf`). Cases:
  1. `countField` picks `ok` (boolean) over `day` (date) over `amount` (number) over `status` (string) over `j` (other); skips a field with `isCalculated: true`; returns `null` for `[]` and for a schema of calculated fields only.
  2. `countRows` sends exactly `{ column: ['day'], limit: 1, includeTotalRowCount: true }` for `noPk` (no `filter` key when none is given) and returns `totalRowCount` (say 1234), even when the one row it returns has other values.
  3. `countRows` with a filter sends it as `filter` unchanged.
  4. `countRows` throws when the traversal has no `totalRowCount`; `count` then rejects and writes nothing to the collection.
  5. A mart with a key is counted the same way (no `uniqueCount` in the options).
  6. `count` trusts an entry with `at` after `updatedAt`, even 3 days old: no read.
  7. `count` reads when `updatedAt` is after `at` and `at` is 2 h old; returns the new number and stores it.
  8. `count` trusts an entry 30 min old even when `updatedAt` is after it.
  9. `count` with `updatedAt: null` keeps today's 24 h rule (adapt the two existing 24 h tests).
  10. `recount` always reads.
- [ ] **Step 2: Run** `npx vitest run src/api/row-counts.test.ts --maxWorkers=4`. Expected: FAIL (no `countField`, `countRows`).
- [ ] **Step 3: Implement** in `src/api/row-counts.ts`: `countField`, `countRows`, the freshness rule, `count(id, schema, updatedAt)`. `measure` becomes `countRows` plus the collection write. Delete `countOptions` and its imports (`uniqueKey`, `hasPrimaryKey`) if nothing else uses them in this file.
- [ ] **Step 4: Callers.** `src/ui/useModelData.ts:58`: `counter.count(id, s, model.marts.get(id)?.dataLastUpdatedAt ?? null)`. `runCount` reads the model through a ref (`lastModel.current`) so its `useCallback` deps stay `[schemas, counter]`. `git grep -n "countOptions\|counter.count("` and fix every other caller.
- [ ] **Step 5: The "no count" tooltip.** `cards.tsx:125`: a `null` count now means the mart has no field to read. Text: "Can't count rows: this data mart has no field that can be read." (The rest of the rename is Task 5.)
- [ ] **Step 6: Run** `npx vitest run src/api/row-counts.test.ts src/ui/useModelData.test.tsx src/ui/explorer/card-count.test.tsx --maxWorkers=4`, `npx tsc -b`, `npx eslint src/api/row-counts.ts src/ui/useModelData.ts src/ui/bands/cards.tsx`. Expected: PASS. Fix tests in `useModelData.test.tsx` and `card-count.test.tsx` that assert the old `uniqueCount` or `COUNT` options so they assert the new read shape; do not change what they check otherwise.
- [ ] **Step 7: Commit** "Card count is COUNT(*) of the mart, cached until its data changes".

### Task 2: Split the grid's rules into each card's own rules

**Files:**
- Create: `src/filters/card-rules.ts`
- Test: `src/filters/card-rules.test.ts`

**Interfaces:**
- Consumes: `TraverseFilter` (`src/sdk/types.ts:16`), `Schema`, `Field` (`src/model/types.ts`).
- Produces:

```ts
/** One card's own rules: the main card's at path '', a joined card's at its alias path. */
export type CardRules = { martId: string; rules: TraverseFilter[]; /** A rule on this card's mart could not be counted on the mart alone. */ partial: boolean };

/**
 * The rules each card counts, by alias path. `schema` is the grid's blended schema (main fields plus joined ones), `filters` the grid's
 * traverse filters (`toTraverseFilters` output), `mainId` the main mart. A path with no rule and nothing partial is absent.
 */
export function cardRules(schema: Schema, filters: readonly TraverseFilter[], mainId: string): Map<string, CardRules>;

/** True when every post-join rule of `filters` is a main-card rule: the grid's plain total is then the main card's number. */
export function mainOnly(schema: Schema, filters: readonly TraverseFilter[]): boolean;
```

Rules, per `TraverseFilter f` with `field = schema.find((x) => x.name === f.column)`:
1. `f.function` set: skipped.
2. `f.placement === 'pre-join'`: `field?.joined` required. If `field.joined.originalName` is set, push `{ ...f, column: originalName }` with `placement` removed to path `field.joined.aliasPath`, `martId: field.joined.martId`. Otherwise mark that path `partial`.
3. No placement, `field` not joined, not `isCalculated`: push `f` to path `''` with `martId: mainId`.
4. No placement, `field` not joined, `isCalculated`: mark path `''` partial.
5. No placement, `field.joined` set: skipped (a crossing).
6. `field` not found: skipped.

`mainOnly` is false when any rule matches case 4, 5 or 6 (case 1 and 2 do not change the main row count).

- [ ] **Step 1: Write the failing tests** in `src/filters/card-rules.test.ts`. Build a schema with main `status` (string), main `calc` (`isCalculated: true`, `calculatedLevel: 'column'`), joined `orders__amount` (`joined: { martId: 'm-orders', label: 'Orders', aliasPath: 'orders', originalName: 'amount' }`), joined `orders__noname` (same join, no `originalName`), joined `cust__city` (`aliasPath: 'orders.cust'`, `martId: 'm-cust'`, `originalName: 'city'`). Cases:
  1. `status eq 'paid'` goes to `''` with `martId: mainId`, `partial: false`.
  2. A slice on `orders__amount gt 5` goes to `'orders'` as `{ column: 'amount', operator: 'gt', value: 5 }` with no `placement` key.
  3. A slice on `cust__city` goes to `'orders.cust'` with `martId: 'm-cust'`.
  4. A post-join `orders__amount gt 5` gives no entry for `'orders'` and none for `''`; `mainOnly` is false.
  5. A rule on `calc` gives `''` with `rules: []`, `partial: true`, and with `status` too gives `rules: [status]`, `partial: true`; `mainOnly` is false.
  6. A HAVING rule (`function: 'SUM'`) gives nothing; `mainOnly` stays true.
  7. A slice on `orders__noname` gives `'orders'` with `rules: []`, `partial: true`.
  8. No filters: an empty map; `mainOnly` true.
  9. Rule order inside a path follows `filters` order.
- [ ] **Step 2: Run** `npx vitest run src/filters/card-rules.test.ts --maxWorkers=4`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `src/filters/card-rules.ts` as specified.
- [ ] **Step 4: Run** the test, `npx tsc -b`, `npx eslint src/filters/card-rules.ts src/filters/card-rules.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** "Split the grid's rules into each card's own rules".

### Task 3: Filtered card counts, read once per rule set

**Files:**
- Create: `src/api/filtered-counts.ts`
- Create: `src/ui/useFilteredCounts.ts`
- Test: `src/api/filtered-counts.test.ts`, `src/ui/useFilteredCounts.test.tsx`

**Interfaces:**
- Consumes: `countRows` (Task 1), `CardRules` (Task 2), `perCtx` (`src/sdk/per-ctx.ts`), `stable` (`src/charts/answers.ts:5`), `COUNT_CONCURRENCY` (`src/config.ts`), `CountState` (`src/ui/bands/cards.tsx:22`), `useServices().schemas` (`schemas.get(martId): Promise<Schema>`).
- Produces:

```ts
// src/api/filtered-counts.ts
export const filteredKey = (martId: string, rules: readonly TraverseFilter[], updatedAt: string | null, now = new Date()): string;
/** The cached count for the key, or undefined. */
export function cachedFiltered(ctx: Ctx, key: string): number | undefined;
/** Reads the count (countRows with `rules` as filter) unless cached; a read already under way for the same key is shared. Never caches a failure. */
export function countFiltered(ctx: Ctx, key: string, martId: string, schema: Schema, rules: readonly TraverseFilter[]): Promise<number | null>;
/** Stores a count the caller already has (the grid's total). */
export function rememberFiltered(ctx: Ctx, key: string, n: number): void;
/** Drops every entry of a mart (the grid's Refresh). */
export function forgetFiltered(ctx: Ctx, martId: string): void;

// src/ui/useFilteredCounts.ts
export function useFilteredCounts(model: Model | null, byPath: ReadonlyMap<string, CardRules> | null): {
  /** The filtered count state of each path that has rules; a path without rules is absent. */
  filtered: ReadonlyMap<string, { state: CountState; partial: boolean }>;
  retry: (path: string) => void;
  /** A count the caller already has (the grid's total): stored with rememberFiltered, and every path whose current key is `key` turns `ok` with no read. */
  seed: (key: string, n: number) => void;
};
```

Details:
1. `filteredKey`: `stable([martId, rules, updatedAt, day])`, `day` is the local `YYYY-MM-DD` of `now` when any rule has `operator: 'relative_date'`, else `''`. Entries are stored with their `martId` so `forgetFiltered` can find them.
2. Cache: a `Map` per ctx, LRU by entry count, limit `FILTERED_COUNT_LIMIT = 64` (export it from `src/config.ts` next to `COUNT_CONCURRENCY`). In-flight reads in a second per-ctx `Map<string, Promise<number | null>>`, deleted when settled.
3. `useFilteredCounts`: for each path in `byPath` with `rules.length > 0`, compute the key with the mart's `dataLastUpdatedAt` from `model.marts`. Cached: state `ok` at once, no read. Otherwise queue it; at most `COUNT_CONCURRENCY` reads run at a time; state `queued`, then `loading`, then `ok` or `error` (message from `errorMessage` in `src/ui/ErrorBox.tsx`). A result whose key is no longer the path's current key is dropped. While a new key is being read, a path that had an `ok` value keeps it with `stale: true` (the `CountState` `ok` variant already has `stale`). A path with `rules: []` and `partial: true` gets no state, only `partial` (the card shows its unfiltered count with the note).
4. `retry(path)` reads that path's current key again.

- [ ] **Step 1: Write the failing tests.**
  `src/api/filtered-counts.test.ts`:
  1. `countFiltered` reads once with `filter: rules`, `limit: 1`, `includeTotalRowCount: true`; a second call with the same key reads nothing.
  2. Two concurrent calls with the same key send one read.
  3. A read that throws is not cached: the next call reads again.
  4. `filteredKey` differs when `updatedAt` differs, is equal for equal rules in the same order, and with a `relative_date` rule differs between `new Date(2026, 10, 27, 23, 59)` and `new Date(2026, 10, 28, 0, 1)` (Review Focus 5); without one it is equal across the two dates.
  5. `rememberFiltered` then `countFiltered` with that key reads nothing.
  6. `forgetFiltered('a')` drops `a`'s entries and keeps `b`'s.
  7. The 65th key evicts the least recently used one.
  `src/ui/useFilteredCounts.test.tsx` (render with the app's services provider as `useModelData.test.tsx` does):
  1. Two paths, `'orders'` and `'x'`, both `martId: 'm-orders'` with equal rules: one read, both `ok` with the same value (Review Focus 4).
  2. A traversal without `totalRowCount` gives `error`; `retry` reads again (Review Focus 3).
  3. Changing a path's rules keeps the old value with `stale: true` until the new one lands.
  4. A path with `partial: true` and no rules has no `state` and sends no read.
  5. With 6 paths of different marts, at most 4 reads are in flight at once.
  6. `seed(key, 99)` for a queued path's key turns it `ok` with 99 and its read is never sent.
- [ ] **Step 2: Run** `npx vitest run src/api/filtered-counts.test.ts src/ui/useFilteredCounts.test.tsx --maxWorkers=4`. Expected: FAIL.
- [ ] **Step 3: Implement** both files and `FILTERED_COUNT_LIMIT`.
- [ ] **Step 4: Run** the tests, `npx tsc -b`, `npx eslint` on the new files. Expected: PASS.
- [ ] **Step 5: Commit** "Filtered card counts, read once per rule set".

### Task 4: The grid hands each card its rules instead of match counts

**Files:**
- Modify: `src/ui/explorer/MartGrid.tsx` (props `:97`, `:121`; filters `:735`; match block `:747-787`; total and Refresh `:788-812`, `:845`; Charts prop `:884`)
- Modify: `src/ui/explorer/SeededGrid.tsx:32-40`
- Modify: `src/ui/bands/DataBand.tsx:26`, `:40-43`, `:71`
- Modify: `src/ui/App.tsx:10`, `:75`, `:142`, `:244`, `:256`
- Modify: `src/charts/ChartsBody.tsx`, `src/charts/Scorecards.tsx:97` and `src/charts/queries.ts:54-76` only as far as dropping `kept` requires
- Delete: `src/ui/bands/matched.ts`
- Test: replace `src/ui/explorer/matched-cards.test.tsx` with `src/ui/explorer/card-rules-grid.test.tsx`; update `src/ui/explorer/card-count.test.tsx`, `src/ui/explorer/slices-grid.test.tsx`

**Interfaces:**
- Consumes: `cardRules`, `mainOnly` (Task 2); `filteredKey`, `rememberFiltered`, `forgetFiltered` (Task 3); `useFilteredCounts` (Task 3).
- Produces:
  1. `GridProps.onCardRules?: (byPath: ReadonlyMap<string, CardRules> | null) => void` replaces `onMatched`. Told on change only (compare with `stable`), `null` on unmount.
  2. `GridProps.onTotal?: (total: number) => void` keeps its meaning: the unfiltered main count.
  3. `DataBand` prop `onCardRules?: (rules: { martId: string; byPath: ReadonlyMap<string, CardRules> } | null) => void` replaces `onMatched`.
  4. `App` keeps `cardRulesOf` state (`{ martId, byPath } | null`) and calls `useFilteredCounts(model, cardRulesOf?.byPath ?? null)`; it passes `filtered` (only when `cardRulesOf.martId === selection.martId`) to `CardBands` in place of `matched`. Task 5 renders it.

Changes in `MartGrid.tsx`:
1. Delete the match block: `applies`, `havingSet` (only if nothing else reads it; `git grep` in the file), `keptUnique`, `full`, `counts`, `needsRead`, `joinGrain`, `scoreOptions`, `score` (the `useChartQuery` call for badges), `matched`, `matchPending`, `lastMatched`, `matchStale`, `matchShown`, `matchedKey`, both `onMatched` effects, `NO_MATCH` (`:89`), and the `matchedFrom`, `countsOf`, `scoreQuery`, `scoreRulesLost` imports when unused. `chartable` (`:755`) keeps its meaning without `keptUnique`: `!scoreFields.marts.every((m) => m.metrics.length === 0 && !m.hasPk)`. Keep `ownTotal` only if something other than the badge reads it; otherwise delete it too.
2. Charts: pass no `kept` to `ChartsBody` (`:884`). Remove the `kept` parameter from `scorecardsQuery`, `scoreQuery`, `Scorecards` and `ChartsBody` if nothing else passes it (`git grep -n "kept"` in `src/charts`). Update the tests in `src/charts` that pass `kept`; delete those that only test the badge-only kept counts.
3. New effect: `const byPath = useMemo(() => cardRules(schema, traverseFilters, martId), [schema, traverseFilters, martId])`, sent through `onCardRules` when `stable([...byPath])` changes; `onCardRules(null)` on unmount.
4. Free path (Design item 7). Replace `plainNext` (`:791`) with:

```ts
const mainRules = byPath.get('')?.rules ?? [];
const answersMain = (q: typeof query) => !charts && !grouped && !q.aggregation?.length && !q.dateTrunc?.length && !q.uniqueCount?.length && !!q.column && mainOnly(schema, q.filter ?? []);
```

   Drop the `mainKey` condition: `COUNT(*)` needs no key. `plainTotal` becomes `!!asked && answersMain(asked) && counted.total !== null && counted.fresh && !counted.exact`. Its effect (`:799-806`): when `mainRules.length === 0` call `onTotal(counted.total)` as today; otherwise call the new prop `onFilteredTotal(filteredKey(martId, mainRules, model.marts.get(martId)?.dataLastUpdatedAt ?? null), counted.total)` and do not call `onTotal`. The `totalSent` guard key adds `stable(mainRules)`. `GridProps.onFilteredTotal?: (key: string, n: number) => void`; `DataBand` forwards it as `onFilteredTotal?: (key: string, n: number) => void`, and `App` wires it to `seed` from `useFilteredCounts` (Task 3).
5. Holding the card on Refresh (`:807-812`, `:845`): the hold condition is `answersMain(query) && mainRules.length === 0` (the unfiltered count). The Refresh handler also calls `forgetFiltered(ctx, martId)`.
6. Comments at `:788-790` and the `onTotal` doc in `GridProps` describe the new condition: plain, main rules only, no key needed, `COUNT(*)`.

Changes elsewhere:
1. `DataBand.tsx`: `showMatched` becomes `showRules`, passing `{ martId: gridId, byPath }`. Add `onFilteredTotal` pass-through.
2. `SeededGrid.tsx`: rename the passed props.
3. `App.tsx`: replace `matched` state and the `Matched` import; wire `useFilteredCounts`, `onCardRules`, `onFilteredTotal`. `CardBands` gets `filtered` and `filteredRetry` props in place of `matched` (typed `ReadonlyMap<string, { state: CountState; partial: boolean }> | undefined` and `(path: string) => void`); Task 5 renders them, so here `CardBands` only accepts and forwards them to `MartsCanvas` and the grid `MartCard`s in place of `matched`/`matchedStale` (a temporary prop each, typed as above, read by nothing until Task 5).

- [ ] **Step 1: Write the failing tests** in `src/ui/explorer/card-rules-grid.test.tsx` (copy the render helpers of `matched-cards.test.tsx`, then delete that file):
  1. A filter on a main field sends `onCardRules` with `''` holding that rule, and sends no scorecard read (count `traverseData` calls with `uniqueCount` in their options: zero).
  2. A slice on a joined field sends that path with the renamed column.
  3. A post-join rule on a joined field sends no entry for that path, and the grid's total is neither passed to `onTotal` nor to `onFilteredTotal` (Review Focus 2).
  4. Plain Table with a main filter: `onFilteredTotal` gets the grid's total and the key `filteredKey(mainId, [rule], updatedAt)`; `onTotal` is not called.
  5. Plain Table with a joined column shown and no rules: `onTotal` gets the grid's total (joined columns are allowed now).
  6. Main mart without a primary key, plain, no rules: `onTotal` gets the total.
  7. Refresh with a main filter calls `forgetFiltered` for the main mart (spy on the module) and does not hold the card.
  Update `card-count.test.tsx` cases that assumed `mainKey` or main-only columns to the new conditions; keep every Refresh hold/recount case.
- [ ] **Step 2: Run** `npx vitest run src/ui/explorer/card-rules-grid.test.tsx src/ui/explorer/card-count.test.tsx --maxWorkers=4`. Expected: FAIL.
- [ ] **Step 3: Implement** the changes above.
- [ ] **Step 4: Run** `npx vitest run src/ui/explorer src/charts src/ui/bands --maxWorkers=4`, `npx tsc -b`, `npx eslint` on every changed file. Expected: PASS. Fix `slices-grid.test.tsx` and chart tests that referenced `onMatched` or `kept` by switching them to `onCardRules` or deleting assertions about badges only.
- [ ] **Step 5: Commit** "The grid hands each card its own rules; no match badge read".

### Task 5: Cards show "X rows"

**Files:**
- Modify: `src/ui/bands/cards.tsx` (`CountBadge` `:96-128`, `MatchBadge` `:130-135`, `MartCard` props `:159-195`, badge row `:260-263`)
- Modify: `src/ui/bands/CardBands.tsx:64`, `:88`, `:123-124`, `:360`, `:377`
- Modify: `src/ui/bands/MartsCanvas.tsx:20-33`, `:241`
- Modify: `src/ui/format.ts:31-32`, `:129-136`
- Modify: `src/ui/bands/DataBand.tsx:64` (Data band total label)
- Modify: `README.md` (lines 17, 21, 37-39 "What it costs", 43 "What it writes")
- Test: `src/ui/bands/cards.test.tsx`, `src/ui/format.test.ts`, `src/ui/bands/marts-canvas.test.tsx`, `e2e/config-menu.spec.ts` (text only)

**Interfaces:**
- Consumes: `filtered` and `filteredRetry` from Task 4.
- Produces:
  1. `rowsLabel` already exists in `format.ts:35` for the grid ("200 of 12,345"). Rename `recordsLabel` to `rowCountLabel(amount: string): string` returning `"1 row"` / `"N rows"`, and update every caller (`git grep -n recordsLabel`).
  2. `MartCard` props `filtered?: { state: CountState; partial: boolean }` and `onRetryFiltered?: () => void` replace `matched`, `matchedStale`.
  3. `matchLabel` and `MatchBadge` are deleted.

Badge rules in `CountBadge` (unfiltered `count`, optional `filtered`):
1. No `filtered`, or `filtered` with no `state` and `partial: false`: today's badge with "rows" text; tooltip the exact number, "1,234 rows".
2. `filtered.state` set: the badge shows the filtered state (waiting, loading, error with retry through `onRetryFiltered`, or `ok`). For `ok`: text `rowCountLabel(compactNumber(n))`, tooltip `"${num(n)} of ${num(total)} rows match this data mart's filters"` when the unfiltered count is `ok` with a value, else `"${num(n)} rows match this data mart's filters"`. `stale` dims it as today.
3. `partial: true`: append " Filters on calculated fields are not counted." to the tooltip (case 1 or 2). For a main card with only a calculated-field rule this shows the unfiltered count with the note (Review Focus 1).
4. All "records" wording in this badge becomes "rows": "Waiting to count rows. Up to 4 data marts count at a time.", "Counting rows…", aria labels likewise.

- [ ] **Step 1: Write the failing tests.** `cards.test.tsx`:
  1. Unfiltered `ok` 1234 shows "1.2K rows", tooltip "1,234 rows".
  2. Filtered `ok` 56 with unfiltered 1234 shows "56 rows", tooltip "56 of 1,234 rows match this data mart's filters".
  3. Filtered `error`: the retry button calls `onRetryFiltered`, not `onRetryCount`.
  4. `partial: true`, no filtered state: shows the unfiltered count and the tooltip ends with "Filters on calculated fields are not counted."
  5. No `[data-match]` element is ever rendered.
  `format.test.ts`: `rowCountLabel('1')` is "1 row", `rowCountLabel('2')` is "2 rows"; delete the `matchLabel` tests. `marts-canvas.test.tsx`: a canvas card at path `'orders'` shows the filtered count passed for `'orders'`.
- [ ] **Step 2: Run** `npx vitest run src/ui/bands/cards.test.tsx src/ui/format.test.ts src/ui/bands/marts-canvas.test.tsx --maxWorkers=4`. Expected: FAIL.
- [ ] **Step 3: Implement** the badge, the prop plumbing in `CardBands` and `MartsCanvas` (each card takes `filtered?.get(path ?? '')` for its own path, and `onRetryFiltered={() => filteredRetry(path ?? '')}`), the label rename, and the Data band total ("200 of 12,345 rows").
- [ ] **Step 4: README.** Line 17: replace the sentences from "Each card shows its record count" through "(the main data mart of a plain table of its own columns is the exception, see What it costs)." with: "Each card shows its row count, data quality, freshness and contexts. While a filter applies to a data mart's own fields, or a slice to a joined one, its card shows the rows those rules keep, and the tooltip shows them out of the data mart's total. A filter on a joined field narrows the main data mart's rows by the joined value, so no card counts it, and a filter on a calculated field is not counted either; the tooltip says so." Line 21: "a card's record count and match badge" becomes "a card's row count". "What it costs" (line 39): rewrite the card-count part to say: a card's count is one read of one row of its data mart with the total row count, so two warehouse queries; the unfiltered count is kept per member until the data mart's data changes (kept at least 1 h after a change, 24 h when OWOX gives no update time); a filtered count is read once per data mart and rule set and kept for the session, and the same data mart at two places shares it; in Table, a plain grid whose filters are all on the main data mart's own fields gives the main card its count with no read; Refresh reads them again. Delete the sentences about the match badge and the scorecard query it sent. Line 43: "record counts" becomes "row counts". Keep every other sentence as it is.
- [ ] **Step 5: e2e text.** `git grep -n "records\|% match" e2e` and update expected texts to "rows". Do not run Playwright; say in the task report which e2e files changed.
- [ ] **Step 6: Run** `npx vitest run --maxWorkers=4` (whole suite), `npx tsc -b`, `npx eslint src`. Expected: PASS.
- [ ] **Step 7: Commit** "Cards show X rows, filtered by their own rules".
