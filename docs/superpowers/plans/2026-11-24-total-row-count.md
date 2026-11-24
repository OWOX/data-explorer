# Total row count in the Data band

**Goal:** The Data band shows `200 of 12,345 records` instead of `200+ records` when OWOX sends the total row count.

**Background:** Since 0.45.0, `traverseData(id, { includeTotalRowCount: true })` sets `traversal.totalRowCount` before the first row. The count ignores `limit`. It is `undefined` when the count fails, takes over 60 s or the host is older. It costs one more warehouse query per read that asks, and OWOX holds the first row until it ends.

## Global Constraints

1. Only the main grid's read (`useMartRows`) sends `includeTotalRowCount`. Charts, record view, search, card counts and filter values never send it.
2. The grid asks once per result. Load more, a sort change, hiding a column and showing a loaded one do not ask again. A change of data mart, filters, slices, grouping, Unique Count, or Refresh or Retry (`version`) does. So does a column that was never loaded, because a re-read with other columns can be another result.
3. A read that finished without a count is not asked again by Load more or a sort: the label stays `200+`. A read that failed or was aborted does not count as asked.
4. Label: `<loaded> of <total>` only when there are more rows than loaded and total is greater than loaded. Otherwise as before: `200+` when there is more, the plain number when there is not. Both numbers of the new form go through `num` from `src/ui/format.ts`.
5. Never hide rows or change what is read. The rows, `hasMore` and Load more behave as before.
6. No new dependency. No em dashes in new text. Run Vitest with at most 4 workers (the config sets it).
7. The worktree's `node_modules` is a symlink to the main checkout: never run npm install.

### Task 1: Ask for the total row count and show it

**Files:**
- Modify: `src/sdk/types.ts`, `src/api/rows.ts`, `src/api/test-ctx.ts` (only if a test helper needs it), `src/sdk/mock/ctx.ts`, `src/ui/explorer/useMartRows.ts`, `src/ui/explorer/MartGrid.tsx`, `README.md`
- Test: `src/api/rows.test.ts`, `src/sdk/mock/ctx.test.ts`, `src/ui/explorer/useMartRows.test.tsx`, `src/ui/format.test.ts`, `src/ui/bands/page.test.tsx`, `e2e/smoke.spec.ts`

**Steps (test first, each with a failing run before the code):**

1. `src/sdk/types.ts`: add `includeTotalRowCount?: boolean` to `TraverseOptions` and `readonly totalRowCount?: number` to `Traversal`, each with a one-line comment.
2. `src/api/rows.ts`: add the hook `onTotalRowCount?: (count: number | undefined) => void` to `ReadRowsHooks`, called next to `onRunId`, before the first row.
3. `src/ui/explorer/useMartRows.ts`:
   - The count key is the data key without `limit` and `sort`, plus the query's loaded columns (`query.columns`).
   - A ref holds the last count key that finished a read and its count (a number or `undefined`). The read sends `includeTotalRowCount: true` only when the ref's key differs. A read that succeeds without being aborted stores its result in the ref.
   - Return `total: number | null` with the rows. It belongs to the rows on show: while a newer read is in flight the previous rows keep their own total, and it is `null` when `stale`.
   - `options` passed by the caller is not mutated and does not itself hold the flag.
4. `src/ui/format.ts`: add `rowsLabel(loaded: number, hasMore: boolean, total: number | null): string` per constraint 4, with unit tests: (200, true, 12345) -> `200 of 12,345`; (200, true, null) -> `200+`; (200, true, 200) -> `200+`; (200, true, 150) -> `200+`; (57, false, 57) -> `57`; (57, false, null) -> `57`; (1200, true, 12345) -> `1,200 of 12,345`. `recordsLabel` and `groupsLabel` of `200 of 12,345` end in `records` and `groups`; check they do (also for a total like `1 of 2`).
5. `src/ui/explorer/MartGrid.tsx:695`: use it, with `total` from `useMartRows`.
6. `src/sdk/mock/ctx.ts`: the mock `traverseData` returns `totalRowCount` (row count of the same read without `limit`) only when asked. Never apply the flag to rows.
7. Update the tests that assert `200+ records` for the mock Orders mart (450 rows): now `200 of 450 records`. In e2e, change `smoke.spec.ts` lines 62 and 774 to match. The e2e grouped assertion `/\d+\+? groups?$/` must still match.
8. `README.md`: in "What it costs", say that the grid asks for the total row count once per result, that it is one more warehouse query, and that OWOX waits up to 60 s for it before the first row. If the README describes the badge elsewhere, update that too.

**Tests for useMartRows must cover:** the first read asks and `total` is set; Load more does not ask and keeps `total`; a sort change does not ask; a filter change asks; a version change asks; a never-loaded column asks; a read without a count is not asked again on Load more; a failed read asks again on retry; an aborted read does not mark the key as asked.

**Verification:** `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npx playwright test --workers=1 --trace off e2e/smoke.spec.ts e2e/band-toolbar.spec.ts` (if the browser is missing, say so and skip). Restore any tracked file a build command changes (`tsconfig.tsbuildinfo`).
