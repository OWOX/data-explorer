# Slices and HAVING filters implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Members add slices (pre-join filters on joined-mart fields) from a Slice row under Filter in the column menu. HAVING filters from loaded reports show, edit and send correctly. Every consumer (rows, charts, export, Copy SQL, Create Data Mart, view link, AI context, report load) carries both.

**Architecture:** `GridState.slices` sits next to `filters`. `ColumnFilter.fn` marks a HAVING filter. One converter, `toTraverseFilters(schema, filters, slices, aggregations)`, feeds every traverseData consumer. `sliceField(field)` types a slice by the raw pre-join type. Create Data Mart renders slices inside each joined mart's read, and HAVING on the grouped query.

**Tech Stack:** React 19, TypeScript, vitest + Testing Library, Playwright, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-20-slice-and-having-design.md`. Every implementer reads it first.

## Global constraints

1. Vitest: always `--maxWorkers=4`. Type check: `npx tsc -b`. e2e: `npm run e2e`.
2. Copy is verbatim from the spec:
   1. "Slice"
   2. "Slice of {title}"
   3. "Slices filter the joined data mart before it is joined, reducing the rows pulled in."
   4. "Filters the {FN} after grouping"
   5. "Slice: {description}"
   6. "Slices (before the join):"
3. A slice is sent as `{ column: <blended field name>, operator, value?, placement: 'pre-join' }`, and only for `field.joined`. A HAVING filter is sent as `{ column, operator, value, function }`, and only when the query's aggregations contain `(column, function)`.
4. Comments are full sentences with no em dashes. Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. A slice must never filter main rows out in the mock or in Create Data Mart SQL. A failing slice empties the joined columns only, because it is a LEFT JOIN.
2. When an aggregation is removed (Aggregate submenu, column hidden, Reset), its HAVING filter goes in the same Undo step, and the next query is valid.
3. Old view links without `sl` or a 4th `fl` slot still decode the same.
4. A slice on a joined field typed STRING after STRING_AGG, with a raw type of BOOL, offers the boolean operators, not the string ones.
5. When a joined mart is removed or renamed (join-plan pruning), its slices go or move with its filters.

---

### Task 1: Core types, conversion and mock semantics

**Files:**
1. `src/sdk/types.ts`: widen `TraverseFilter` with `placement?: 'pre-join' | 'post-join'` and `function?: AggFn`.
2. `src/filters/build.ts`: `ColumnFilter.fn?`, `toTraverseFilters`.
3. New `src/filters/slice.ts`: `sliceField`, plus `havingField`.
4. `src/state/store.tsx`: `GridState.slices?`.
5. `src/sdk/mock/ctx.ts` and `src/sdk/mock/evaluate.ts`: the mock's slice and HAVING behaviour.
6. Tests in each of the matching test files.

**Interfaces produced:**
```ts
// src/filters/build.ts
export type ColumnFilter = { field: string; op: OpId; value?: FilterValue; fn?: AggFn };
export function toTraverseFilters(schema: Schema, filters: ColumnFilter[], slices?: ColumnFilter[], aggregations?: AggregationRule[]): TraverseFilter[];
// src/filters/slice.ts
export function sliceField(field: Field): Field;           // type = joined?.sourceType ?? type; category re-derived
export function havingField(field: Field, fn: AggFn): Field; // numeric for COUNT, COUNT_DISTINCT, SUM, AVG, P25..P95; else field itself
// src/state/store.tsx
export type GridState = { ...; slices?: Record<string, ColumnFilter> };
```

- [ ] Write the tests first:
  1. `sliceField` on a BOOL raw field typed STRING gives category `boolean`.
  2. `toTraverseFilters`:
     1. It emits filters, then slices with `placement: 'pre-join'`.
     2. It drops a slice on a main field.
     3. It drops an incomplete slice.
     4. It emits HAVING with `function` only when `aggregations` has `(column, fn)`.
     5. A HAVING value on a SUM over a STRING column is numeric.
     6. Existing call shapes (two arguments) keep working.
  3. Mock:
     1. A slice nulls the alias path's fields on failing rows and keeps the row count.
     2. A slice on a main field throws a 400.
     3. HAVING filters the grouped rows.
- [ ] Implement. Find the categorizer in `src/model/field-category.ts`, and read how the mock joins rows (`blendedName`, `joinTree`) before writing the slice step.
- [ ] Run `npx vitest run src/filters src/sdk src/state --maxWorkers=4` and `npx tsc -b`.
- [ ] Commit "Filters: slices and HAVING filters in the traverse conversion and the mock".

### Task 2: Plumbing slices and HAVING through the grid state

**Files:**
1. `src/ui/explorer/MartGrid.tsx`, for the rows query, charts filters, `stable`, parked, Reset, `onChange`, and the setter for slices.
2. `src/ui/explorer/useMartRows.ts`: `buildRowQuery` and `buildGroupedQuery` take slices.
3. `src/state/join-plan.ts`, `src/state/leaving.ts` and `src/ui/bands/useCardClick.ts`: prune, move and initialise slices.
4. `src/state/view-link.ts` and `src/state/view-link-resolve.ts`: `sl`, plus the `fn` slot in `fl`.
5. `src/api/exports.ts`: `buildReportPayload` takes slices and aggregations, so HAVING goes out.
6. `src/ui/explorer/ExportMenu.tsx`: pass them through.
7. `src/api/ai-prompt.ts`.
8. HAVING orphan removal: a pure helper `dropOrphanHaving(filters, aggregations): Record<string, ColumnFilter>` in `src/filters/build.ts`, applied wherever aggregations change in MartGrid.
9. `src/search/view.ts` `mergeAiView` keeps `slices` absent.

**Interfaces produced:**
1. The MartGrid env gains `slices: Record<string, ColumnFilter>` and `setSlice(field: string, f: ColumnFilter | undefined)`. The column menu (Task 4) consumes them.
2. `buildReportPayload(schema, visible, filters, sorts, agg?, slices?)`.

- [ ] Write the tests first:
  1. The rows query sends slices and HAVING.
  2. Charts get them.
  3. Reset clears slices.
  4. A slice on a field not offered is parked and comes back.
  5. Join-plan removing a mart drops its slices, and renaming moves them.
  6. Removing an aggregation drops its HAVING filter in one Undo step.
  7. View-link encode and decode with `sl` and `fn`, and an old link decodes unchanged.
  8. The export payload includes slices and HAVING.
  9. The AI context prints "Slices (before the join):" and "SUM(net_revenue) > 100".
- [ ] Implement.
- [ ] Run `npx vitest run src/state src/ui/explorer src/api src/filters --maxWorkers=4` and `npx tsc -b`. Then run the full suite once.
- [ ] Commit "Grid: slices and HAVING filters travel with the grid, links, export and the AI context".

### Task 3: Report load keeps slices and HAVING

**Files:** `src/search/report-load.ts` and its test.

- [ ] Write the tests first:
  1. A pre-join rule on a joined field loads into `grid.slices`. On a main field it is skipped and counted.
  2. A rule with `function` and a matching aggregation loads into `filters` with `fn`. Without a matching aggregation it is skipped and counted under `having`.
  3. The round trip `buildReportPayload(..., agg, slices)` → `reportToGrid` keeps both.
  4. The mock report `mock-report-orders-extras` now loads with only "unique count" skipped.
- [ ] Implement.
- [ ] Update `smart-search.test.tsx` expectations for that report's notice to "Some parts of this report aren't shown: unique count."
- [ ] Run `npx vitest run src/search src/ui/bands --maxWorkers=4` and `npx tsc -b`.
- [ ] Commit "Search: a loaded report keeps its slices and HAVING filters".

### Task 4: Column menu: Slice row, header icon, HAVING note

**Files:** `src/ui/explorer/ColumnMenu.tsx`, `src/ui/explorer/FilterEditor.tsx`, CSS next to the existing menu styles, and tests in `ColumnMenu.test.tsx`, `FilterEditor.test.tsx` and a new `slice-menu.test.tsx`.

**Consumes:** the env `slices` and `setSlice` from Task 2, and `sliceField` and `havingField` from Task 1.

- [ ] Write the tests first:
  1. The Slice row appears directly under Filter only for a joined column, with the Layers icon.
  2. Hovering it opens "Slice of {title}" with the banner and an editor typed by the raw type.
  3. Apply sets the slice and Clear removes it.
  4. The header shows the Layers button with "Slice: ..." and clicking it opens the Slice submenu.
  5. A HAVING filter's editor shows "Filters the SUM after grouping", takes a numeric value, and keeps `fn` on apply.
  6. The Funnel tooltip reads "Filter: SUM greater than 100".
- [ ] Implement.
- [ ] Run `npx vitest run src/ui/explorer --maxWorkers=4` and `npx tsc -b`.
- [ ] Commit "Column menu: a Slice row under Filter for joined columns, HAVING filters say what they filter".

### Task 5: Create Data Mart SQL renders slices and HAVING

**Files:** `src/datamart/build-sql.ts`, `src/datamart/dialect.ts` (if needed), `build-sql.test.ts`, `engine-parity.test.ts` and new golden files in `src/datamart/__golden__`.

- [ ] Write the tests first:
  1. A slice on alias path P puts its predicate on P's raw rows in P's dedup CTE and in every sleeve's raw join of P, using the raw column (`joined.originalName`) and the raw type.
  2. A slice never adds to the outer `WHERE`.
  3. A HAVING filter adds `HAVING <same aggregate expression as the SELECT> <op> <value>` to the grouped query, and also to a sleeve's grouped output when that is where the aggregate lives.
  4. Golden cases for BigQuery and the other dialects the golden folder covers.
- [ ] Implement. Read the whole of `buildMartSql`, `plan`, `assembleFlat` and the grouped assembly first. If a sleeve makes HAVING ambiguous, report NEEDS_CONTEXT with the case.
- [ ] Run `npx vitest run src/datamart --maxWorkers=4` and `npx tsc -b`.
- [ ] Commit "Create Data Mart: slices filter a joined mart before its join, HAVING on the grouped query".

### Task 6: e2e

**Files:** `e2e/` (a new `slice.spec.ts` or `smoke.spec.ts`).

- [ ] Write the test: open `orders`, join `customers`, add a slice on a customers field from the Slice row, then check that the joined column empties on rows that fail the slice, the row count is unchanged, the header shows the Layers icon, and Undo removes the slice.
- [ ] Run `npm run e2e`, then the full unit suite with `--maxWorkers=4`.
- [ ] Commit "e2e: a slice empties the joined columns it does not match".
