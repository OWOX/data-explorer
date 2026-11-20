# Search dropdown implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The search box shows a dropdown of matching reports, data marts and an ad-hoc report. Enter runs the ad-hoc report. Picking a report loads its columns, filters, sorts and aggregations.

**Architecture:** `/api/search` is asked for both entity types and returns typed hits. A pure `reportToGrid` maps a saved report to `GridState`. The AI pipeline is split into call 1 (pick the mart, while typing) and calls 2 and 3 (fields, then filters, only after a pick). `useSmartSearch` owns debounced fetching, the rows, the highlight and the picks; `SearchResults` renders a listbox.

**Tech Stack:** React 19, TypeScript, vitest + Testing Library (jsdom), Playwright e2e, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-19-search-dropdown-design.md`. Every implementer reads it first.

## Global constraints

1. Run unit tests with `npx vitest run <path> --poolOptions.threads.maxThreads=4`. Never run vitest without the thread cap. Playwright: `npm run e2e` (already `--workers=1`).
2. Type check: `npx tsc -b --noEmit` (or `npm run build` if that is what the repo uses; check `package.json`).
3. Code comments follow the repo's style: full sentences, no em dashes in new text.
4. Commit messages: a short subject in the repo's style (`Search: ...`), then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. Copy strings are verbatim from the spec: "Ad-hoc report for", "with", "filters", "No data mart found", "Type at least 2 characters", "This report couldn't be opened.", "AI couldn't set up the view. Showing the default view.", "Some parts of this report aren't shown: ...".
6. Caps: 5 report rows, 5 mart rows, 3 contexts per row, `/api/search` `limit=20`, debounce 300 ms.

## Review focus

1. A report whose mart the member can't open must not appear (its hit is dropped), and a report whose `GET` returns 404 leaves the view untouched with the notice.
2. Fast typing: an answer for an older query (search or AI call 1) must never overwrite the rows of a newer query. Test: two queries, the first resolves last.
3. A report with two filters on the same column (`gte` and `lte`) keeps the first and counts the second, never throws.
4. A joined column in `columnConfig` (blended name `alias path` + field) survives `reportToGrid` when the joined schema has it, and is counted as skipped when it doesn't.
5. After an ad-hoc pick, a member edit made before AI calls 2 and 3 finish is not overwritten, and one Undo still returns to the state before the pick.

---

### Task 1: Typed search hits (endpoint + mock)

**Files:**
- Modify: `src/search/endpoint.ts`
- Modify: `src/search/endpoint.test.ts`
- Modify: `src/sdk/mock/search.ts`, `src/sdk/mock/ctx.ts`, `src/sdk/mock/fixtures.ts` (seed reports)

**Interfaces:**
- Produces:
  ```ts
  export type ReportHit = { id: string; title: string; martId: string };
  export type SearchHits = { reports: ReportHit[]; marts: string[] };
  export const MAX_FOUND = 5;           // per kind
  export async function searchEndpoint(ctx: Ctx, query: string, model: Model, signal?: AbortSignal): Promise<SearchHits>;
  ```
- Mock seeds three reports, served by the existing `GET /api/reports/:id` route and returned by `mockSearch` when `entityTypes` includes `REPORT`:
  1. `mock-report-orders-paid`: mart `orders`, title "Paid orders by month", `columnConfig` of 2-3 real `orders` fields, one `eq` filter on a string field, one `sortConfig`, one `aggregationConfig` (SUM on a number field) and one `dateTruncConfig` (MONTH on a date field).
  2. `mock-report-orders-extras`: mart `orders`, title "Orders with extras", with one `placement: 'pre-join'` rule, one rule with `function: 'SUM'` and `uniqueCountConfig: ['']`.
  3. `mock-report-campaigns`: mart `campaigns`, title "Campaign spend", plain columns only.
  Report fixtures use real field names from `fixtures.ts`. Read it to pick them.

- [ ] **Step 1: Tests first.** Replace the endpoint tests so they assert:
  1. `getJson` is called with `('/api/search', { q, entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: '20' })`.
  2. Mixed items parse into `{ reports, marts }`, each sorted by `finalScore` descending, stable on ties, deduped by id keeping the best score.
  3. A `REPORT` item needs a string `entityId`, a string `title` (fallback: the id) and `report.dataMart.id` naming an `accessible` mart; otherwise it is dropped.
  4. Items of other types (`DATA_STORAGE`) are ignored. An item with no `entityType` counts as a mart (old behaviour).
  5. Each list is capped at 5.
  6. A thrown error or a non-array body gives `{ reports: [], marts: [] }`. An aborted signal gives the same.
  7. Queries under 2 characters make no call.
- [ ] **Step 2:** Run `npx vitest run src/search/endpoint.test.ts --poolOptions.threads.maxThreads=4`; expect failures.
- [ ] **Step 3: Implement.** Sketch:
  ```ts
  const REQUEST_LIMIT = 20;
  export async function searchEndpoint(ctx, query, model, signal): Promise<SearchHits> {
    const none: SearchHits = { reports: [], marts: [] };
    const q = query.trim();
    if (q.length < MIN_QUERY || queryProblem(q)) return none;
    let body: unknown;
    try { body = await ctx.owox.getJson<unknown>('/api/search', { q, entityTypes: 'DATA_MART,REPORT', excludeDrafts: 'true', limit: String(REQUEST_LIMIT) }); }
    catch (e) { console.warn('The OWOX search failed', e); return none; }
    if (signal?.aborted || !Array.isArray(body)) return none;
    const marts = new Map<string, number>();
    const reports = new Map<string, { hit: ReportHit; score: number }>();
    for (const item of body) { /* parse as described in Step 1; best score per id */ }
    const top = <T,>(m: Map<string, T>, score: (t: T) => number) => [...m.entries()].sort((a, b) => score(b[1]) - score(a[1])).slice(0, MAX_FOUND);
    return { marts: top(marts, (s) => s).map(([id]) => id), reports: top(reports, (r) => r.score).map(([, r]) => r.hit) };
  }
  ```
  Update `src/search/run.ts` callers only enough to compile (`(await searchEndpoint(...)).marts`); Task 3 rewrites `run.ts`.
  Mock: `mockSearch` scores reports by keyword over the report title and its mart title, returns `{ entityType: 'REPORT', entityId, title, description: null, finalScore, kwScore, vecScore: null, report: { dataMart: { id, title }, dataDestination: { id: 'mock-dest', title: 'Mock destination', type: 'GOOGLE_SHEETS' } } }`. Rename mart fields to `kwScore` and `vecScore`. Return mart items only when `entityTypes` includes `DATA_MART`, report items only when it includes `REPORT`. Seed the three reports into the `reports` map in `ctx.ts` at startup with `dataMartId` and a `dataMart: { id, title, contexts }` object as `GET /api/reports/:id` returns it.
- [ ] **Step 4:** Run the endpoint tests and `npx vitest run src/sdk --poolOptions.threads.maxThreads=4`; all pass. Run the type check.
- [ ] **Step 5: Commit** "Search: ask /api/search for reports and data marts, typed hits".

### Task 2: Load a saved report into a grid

**Files:**
- Create: `src/search/report-load.ts`, `src/search/report-load.test.ts`

**Interfaces:**
- Consumes: `GridState` (`src/state/store.tsx`), `ColumnFilter`, `toTraverseFilter` (`src/filters/build.ts`), `operatorsFor`, `isDayType`, `isDateTimeField` (`src/filters/catalogue.ts`), `pruneGrid`, `Skipped` (`src/state/view-link-resolve.ts`), `defaultColumns` (`src/ui/explorer/useMartRows.ts`), `PAGE_SIZE` (`src/config.ts`), `buildReportPayload` (`src/api/exports.ts`, tests only).
- Produces:
  ```ts
  export type ReportDto = {
    id: string; title?: string;
    dataMart?: { id?: string };
    columnConfig?: string[] | null;
    filterConfig?: unknown[] | null;
    sortConfig?: { column: string; direction: 'asc' | 'desc' }[] | null;
    aggregationConfig?: { column: string; function: string }[] | null;
    dateTruncConfig?: { column: string; unit: string; timeZone?: string }[] | null;
    uniqueCountConfig?: boolean | string[] | null;
  };
  export type ReportSkipped = { columns: number; filters: number; sorts: number; aggregations: number; slices: number; having: number; uniqueCount: boolean };
  export function fromTraverseFilter(rule: unknown, field: Field): ColumnFilter | null;
  export function reportToGrid(report: ReportDto, schema: Schema, nativeSchema: Schema): { grid: GridState | null; skipped: ReportSkipped };
  export function reportSkippedMessage(s: ReportSkipped): string | null;
  ```

- [ ] **Step 1: Tests first.** In `report-load.test.ts` build a small schema (string, number, DATE, TIMESTAMP, boolean, and one joined field with `joined: { martId, label, aliasPath: 'customer' }` named `customer customer_name` or whatever `blendedName` gives; read `src/model/types.ts`). Cases:
  1. Round trip: for each grid below, `buildReportPayload(schema, grid.columns, Object.values(grid.filters), grid.sorts ?? [], agg)` then `reportToGrid({ id: 'r', ...payload }, schema, schema).grid` deep-equals the grid (limit `PAGE_SIZE`):
     1. string `contains`, number `between`, boolean `is_true`;
     2. DATE `on`, TIMESTAMP `before`, TIMESTAMP `between` with date-only bounds (round-trips to date-only), `relative` `last_n_days` n=7;
     3. a grouped grid with an aggregation and a MONTH dateTrunc.
  2. `fromTraverseFilter` returns null for `in`, `regex`, an unknown column type mismatch (`contains` on a number field), and a value of the wrong shape.
  3. A pre-join rule counts `slices: 1`; a rule with `function` counts `having: 1`; `uniqueCountConfig: ['']` or `true` sets `uniqueCount: true`; `[]`, `false` and null don't.
  4. Two filters on one column: the first is kept, `filters: 1`.
  5. `columnConfig: null` gives `defaultColumns(nativeSchema)`.
  6. A column, sort or aggregation on a field missing from the schema is counted by the matching key (via `pruneGrid`).
  7. `reportSkippedMessage` gives null for nothing skipped and, for `{ filters: 2, slices: 1, uniqueCount: true }`, exactly "Some parts of this report aren't shown: 2 filters, 1 slice, unique count." Order: columns, filters, sorts, aggregations, slices, HAVING filters, unique count. Plurals: "1 column/2 columns", "1 HAVING filter/2 HAVING filters".
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3: Implement.** Rules for `fromTraverseFilter(rule, field)`:
  1. Reject anything not an object with string `column` and string `operator`, or with `placement === 'pre-join'` or `function` set (the caller counts those first).
  2. Map the operator to an `OpId`: `relative_date` to `relative`; on a date field `eq` to `on` when `isDayType(field.type)`, `lt` to `before`, `gt` to `after`; otherwise the same id.
  3. The `OpId` must be in `operatorsFor(field)`. Build the value by that op's `value` kind: `none` no value; `text` a non-empty string (a number is stringified); `number` a finite number; `date` a string, and for `before`/`after` on a timestamp the value as stored (keep it); `number-range` `{from,to}` numbers; `date-range` `{from,to}` strings, and on a date-time field when `from` ends in ` 00:00:00` and `to` ends in ` 23:59:59` with the same pattern `YYYY-MM-DD`, strip both to the date; `relative` the preset object as is when `RELATIVE_PRESETS` knows its kind.
  4. Return the `ColumnFilter` only if `isComplete(filter, field)`.
  `reportToGrid`: count slices, HAVING and unique count; map the rest; key filters by `field`; build `GridState { columns, filters, sorts: sorts.length ? sorts : null, limit: PAGE_SIZE, aggregations?, dateTrunc? }`; run `pruneGrid(grid, schema, skipped)` with a local `Skipped` and add its `columns`, `filters`, `sorts`, `aggregations` into `ReportSkipped`. Aggregation functions and units are checked against `AGGREGATE_FUNCTIONS` and `DATE_BUCKETS`; unknown ones count as aggregations. Keep `timeZone` on dateTrunc.
- [ ] **Step 4:** Run; all pass. Type check.
- [ ] **Step 5: Commit** "Search: read a saved report back into a grid".

### Task 3: Split the AI view into fields and filters; ad-hoc mart call

**Files:**
- Modify: `src/search/ai.ts`, `src/search/prompts.ts`, `src/search/view.ts`, `src/search/run.ts`
- Modify tests: `src/search/ai.test.ts`, `src/search/prompts.test.ts`, `src/search/view.test.ts`, `src/search/run.test.ts`

**Interfaces:**
- Consumes: `SearchHits` from Task 1 (`import type { SearchHits } from './endpoint'`). If Task 1 isn't merged yet, declare the same type locally and switch the import when it is.
- Produces:
  ```ts
  // ai.ts
  export type Role = 'discover' | 'fields' | 'filters';
  // SHARE: discover 0.9 (it is the only call in its run), fields 0.5, filters 0.9 (it gets what is left)
  // prompts.ts
  export function discoveryQuestion(query: string, marts: Mart[], hints?: { id: string; title: string }[]): Question;
  export function fieldsQuestion(query: string, mart: Mart, schema: Schema, today?: Date): Question;   // task: 'fields'
  export function filtersQuestion(query: string, mart: Mart, schema: Schema, columns: string[], today?: Date): Question; // task: 'filters'
  // view.ts
  export type AiFields = { columns: string[]; aggregations: AggregationRule[]; dateTrunc: DateTruncRule[] };
  export type AiFilters = { filters: Record<string, ColumnFilter>; sorts: SortKey[] };
  export function parseAiFields(raw: unknown, schema: Schema): AiFields | null;
  export function parseAiFilters(raw: unknown, schema: Schema, columns: string[]): AiFilters;
  export function mergeAiView(schema: Schema, fields: AiFields | null, filters: AiFilters | null): GridState | null;
  // run.ts
  export type AdhocMart = { martId: string | null; ai: 'none' | 'used' | 'unavailable' };
  export async function findAdhocMart(deps: { ctx: Ctx; model: Model; signal: AbortSignal; timeoutMs?: number }, query: string, hits: SearchHits): Promise<AdhocMart>;
  export type AdhocView = { grid: GridState | null; ai: 'none' | 'used' | 'unavailable' };
  export async function buildAdhocView(deps: { ctx: Ctx; model: Model; schemas: Pick<SchemaLoader, 'get'>; signal: AbortSignal; timeoutMs?: number }, query: string, martId: string): Promise<AdhocView>;
  ```
  `smartSearch`, `SearchOutcome`, `viewQuestion` and `parseAiView` are removed; their tests move to the new names.

- [ ] **Step 1: Tests first.**
  1. `prompts.test.ts`: `discoveryQuestion` with hints puts `searchHits` in the user JSON and the system text says to prefer them when they fit; without hints, no `searchHits` key. `fieldsQuestion` system asks for `{"columns", "aggregations", "dateTrunc"}` and lists no filter instructions; `filtersQuestion` user JSON has `columns` and system asks for `{"filters", "sorts"}` with sorts only on `columns`. Both cap fields at `FIELDS_MAX` and treat strings as data (keep `DATA_RULE`).
  2. `view.test.ts`: port each existing `parseAiView` case to the matching new parser; `mergeAiView` with both null gives null, with fields only gives that grid, with filters only uses `defaultColumns(schema)`, and runs through `pruneGrid`.
  3. `run.test.ts`, `findAdhocMart`:
     1. no AI gives `hits.marts[0] ?? hits.reports[0]?.martId ?? null`, `ai: 'none'`, and no model call;
     2. with AI, the first accessible id the model names wins and the call's task is `discover` with `searchHits`;
     3. a model naming nothing valid, or failing, falls back as in 1 with `ai: 'used'` or `'unavailable'`;
     4. an aborted signal rejects nothing and returns the fallback without calling the model again.
  4. `run.test.ts`, `buildAdhocView`: asks `fields` then `filters` in that order, the `filters` call's JSON carries the columns `fields` chose, and the result merges both; no AI gives `{ grid: null, ai: 'none' }` and no call; a failing `fields` call gives `ai: 'unavailable'`, `grid: null`; an empty schema gives `grid: null` without calls.
- [ ] **Step 2:** Run the four test files; expect failures.
- [ ] **Step 3: Implement.** Split `viewQuestion` text between the two questions, keeping its exact rules for each part. `findAdhocMart` uses one `createAiRun(ai, signal, timeoutMs)` and `ask('discover', ...)`. Hints are `hits.marts` then `hits.reports` marts, deduped, mapped to `{ id, title }` from the model. `buildAdhocView` uses one run for `fields` then `filters`.
- [ ] **Step 4:** Run the `src/search` folder tests; all pass. Type check (the UI hook still imports `smartSearch`; give the hook a minimal compile fix that calls `findAdhocMart` then `buildAdhocView` for the old submit path; Task 4 rewrites it).
- [ ] **Step 5: Commit** "Search: one AI call picks the ad-hoc mart, two more build its view after a pick".

### Task 4: The dropdown (hook, list, box)

Depends on Tasks 1-3.

**Files:**
- Modify: `src/ui/bands/useSmartSearch.ts`, `src/ui/bands/SearchBox.tsx`, `src/ui/bands/SmartSearchScope.tsx` (if the notice needs rendering there), `src/styles.css`
- Create: `src/ui/bands/SearchResults.tsx`
- Modify tests: `src/ui/bands/smart-search.test.tsx`

**Interfaces:**
- Consumes: `searchEndpoint`, `SearchHits`, `ReportHit` (Task 1); `reportToGrid`, `reportSkippedMessage`, `ReportDto` (Task 2); `findAdhocMart`, `buildAdhocView` (Task 3); `withJoined` and the `blendable` loader from `useServices()` (as `src/ui/useViewLink.ts` uses them); `PickedIcon`, `DEFAULT_CONTEXT_ICON` (`src/ui/bands/picked.tsx`); `defaultColumns`; store actions `smartFound`, `setMarts`, `selectMart`, `saveGrid`, `search`.
- Produces (hook return additions):
  ```ts
  type Row =
    | { kind: 'report'; id: string; title: string; martId: string }
    | { kind: 'mart'; martId: string }
    | { kind: 'adhoc'; martId: string | null; pending: boolean; disabled: boolean; reason?: string };
  rows: Row[]; highlighted: number | null; setHighlighted(i: number | null): void;
  move(delta: 1 | -1): void; pick(row?: Row): void;   // pick() with no row runs the ad-hoc row
  listOpen: boolean; closeList(): void;
  notice: string | null; dismissNotice(): void;
  ```

Behaviour (see the spec for the full rules):
1. Debounce 300 ms on `draft`. Each fetch has its own `AbortController`; a new draft aborts the previous fetch and its call 1. Results apply only if they belong to the current draft.
2. Rows: reports, then marts, then the ad-hoc row. The ad-hoc row is `pending` while call 1 runs. Under 2 characters only the disabled ad-hoc row with reason "Type at least 2 characters".
3. Contexts text helper (export it for tests): `contextsOf(mart, model)` gives up to 3 `Context`s; the row renders "from" then the icons and names joined as "A", "A & B", "A, B & C".
4. Keyboard in `SearchBox`: ArrowDown/ArrowUp call `move` (skip disabled rows, wrap), Enter (via the form's `onAction`) calls `pick(rows[highlighted])` or `pick()`, Escape closes the list first, the box on the second press. Typing resets the highlight.
5. `pick` for a report: `ctx.owox.getJson('/api/reports/' + encodeURIComponent(id))`, then the joined schema, then `reportToGrid`, then `smartFound` and `setMarts` (or `selectMart` if `grid` is null), then the notice from `reportSkippedMessage`. A failure sets "This report couldn't be opened." and changes nothing else.
6. `pick` for a mart: `smartFound` then `selectMart`.
7. `pick` for ad-hoc: read `schemas.get(martId)`, `smartFound`, `setMarts` with the default grid. If AI is configured, `buildAdhocView`; when it returns a grid and the store's grid for that mart still deep-equals the default grid it set, and the selection's `martId` is still that mart, dispatch `saveGrid`. A `grid: null` with `ai: 'unavailable'` sets "AI couldn't set up the view. Showing the default view.". The box shows `busy` meanwhile. A new pick or a new search aborts it.
8. The list closes after a pick and the box shows the applied chip, as today. `clear()` also clears rows and the notice.
9. `SearchResults` renders `<ul role="listbox" id=...>` with `<li role="option" id=... aria-selected aria-disabled>`; `SearchBox` puts `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`, `aria-autocomplete="list"` on the input. Clicking a row calls `pick(row)` (use `onMouseDown` + `preventDefault` so the input keeps focus).
10. Icons: report `FileSpreadsheet`, ad-hoc `Sparkles`, filter `Funnel`, mart `PickedIcon icon={mart.icon} fallback={Box}`, context `PickedIcon icon={ctx.icon} fallback={DEFAULT_CONTEXT_ICON}`, pending `Loader2` with `animate-spin`.
11. The notice renders under the box like `AiHint`, `role="status"`, with a dismiss x.
12. CSS: `.dm-search-results` positioned under the open box, the page's surface and border tokens, max height with scroll, `.is-active` row highlight, rows on one line with ellipsis on overflow, mobile width 100%.

- [ ] **Step 1: Tests first.** Rewrite `smart-search.test.tsx` around the dropdown, keeping the box tests that still apply (open, Escape, x clear, 256 limit, AI hint, view link). Use fake timers for the debounce. New cases:
  1. Typing "orders" shows report rows, then mart rows, then the ad-hoc row, with contexts "A, B & C" capped at 3.
  2. A slow first query resolving after a second query doesn't replace the second query's rows.
  3. Without a pick, the AI model is asked only `discover`; `fields` and `filters` never.
  4. Enter with no highlight runs ad-hoc: the mart becomes main, then the AI grid is saved, and one Undo returns to the state before the pick.
  5. Editing the grid before the AI answers keeps the edit.
  6. ArrowDown to a report and Enter loads it: the grid has the report's filter and sort; one Undo reverts; the "Orders with extras" report shows "Some parts of this report aren't shown: 1 slice, 1 HAVING filter, unique count."
  7. A report `GET` that fails shows "This report couldn't be opened." and leaves the selection.
  8. Picking a mart row selects it with no AI call.
  9. Escape closes the list, a second Escape closes the box.
- [ ] **Step 2:** Run; expect failures.
- [ ] **Step 3: Implement** per the behaviour list.
- [ ] **Step 4:** Run `npx vitest run src/ui/bands src/search --poolOptions.threads.maxThreads=4`, then the full suite `npx vitest run --poolOptions.threads.maxThreads=4`, and the type check. Fix every failure the change caused (other tests that relied on submit-only search).
- [ ] **Step 5: Commit** "Search: a dropdown of reports, data marts and an ad-hoc report".

### Task 5: e2e

Depends on Task 4.

**Files:**
- Modify: `e2e/smoke.spec.ts` (the search block around lines 76-98) or create `e2e/search.spec.ts`

- [ ] **Step 1:** Update the existing search e2e to the new flow: type "campaign", press Enter with no highlight, and the best mart becomes main (mock has no AI, so the ad-hoc row uses the best hit).
- [ ] **Step 2:** Add: type "paid orders", the dropdown lists "Paid orders by month" first; click it; the grid shows the report's filter (the filter chip or header filter state the existing e2e helpers read) and the main mart is `orders`.
- [ ] **Step 3:** Run `npm run e2e`; all pass.
- [ ] **Step 4: Commit** "e2e: search dropdown picks a report and runs ad-hoc on Enter".
