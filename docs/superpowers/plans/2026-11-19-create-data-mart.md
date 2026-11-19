# Create Data Mart from the Export menu: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Export menu gets "Create Data Mart". It asks for a name, then creates an SQL data mart. The SQL references the grid's main data mart and the joined data marts it uses, and keeps the shown columns and the filters. The data mart goes into the main mart's storage and is published and available for reporting. The dialog then shows a link to it.

**Architecture:** Three new pure-ish modules under `src/datamart/`:
1. `dialect.ts` quotes identifiers and literals and renders one filter as SQL for each storage type.
2. `build-sql.ts` turns the grid (schema, shown columns, filters, joined sources, edges) into SQL that uses OWOX data mart references (`[Title](dm:<id>)`) and LEFT JOINs.
3. `create.ts` drives the OWOX REST calls through `ctx.owox.postJson/putJson/getJson`.

`ExportMenu` adds the item and a `CreateMartDialog`.

**Tech Stack:** React 19, TypeScript, Vitest (`npx vitest run --poolOptions.threads.maxThreads=4`), Testing Library, lucide-react.

**Spec:** this plan. The user's decisions are recorded here:
1. The SQL references the used data marts, following https://docs.owox.com/docs/getting-started/setup-guide/sql-data-mart/#reference-another-data-mart. The local copy is `/Users/flakss/Projects/owox-data-marts/docs/getting-started/setup-guide/sql-data-mart.md`, lines 31-63.
2. It carries the shown columns and the grid's complete filters. Sorts and aggregation are not carried.
3. One-to-many joins are a plain LEFT JOIN, so rows of the main mart repeat.
4. It is created in the same storage as the main mart, then published and made available for reporting. A confirmation dialog asks for the name first. The same dialog shows the link once the mart is created.

## Global Constraints

1. Reference syntax: `[<title>](dm:<data mart id>)`, placed where a table name goes. Brackets in the title are replaced (`[`→`(`, `]`→`)`) so the label stays valid. The title is only a label.
2. Same storage only. `LEGACY_GOOGLE_BIGQUERY` cannot use references, so the item is disabled there with the reason "References between data marts aren't available for Legacy Google BigQuery storages".
3. Storage types: `GOOGLE_BIGQUERY`, `AWS_ATHENA`, `SNOWFLAKE`, `AWS_REDSHIFT`, `DATABRICKS`. Any other type disables the item with "Not available for this storage type".
4. REST calls, in this order. They go through `ctx.owox.postJson` / `putJson` / `getJson`, and paths start with `/api`:
   1. `POST /api/data-marts` `{ title, storageId }` → `{ id, ... }`.
   2. `PUT /api/data-marts/:id/definition` `{ definitionType: 'SQL', definition: { sqlQuery } }`.
   3. `POST /api/data-marts/:id/schema-actualize-triggers` → `{ triggerId }`. Then poll `GET …/schema-actualize-triggers/:triggerId/status` → `{ status }` every 1000 ms, for at most 60 s, until `SUCCESS`. Any other terminal status (`ERROR`, `CANCELLED`, or a status other than `IDLE` / `READY` / `PROCESSING` / `SUCCESS`) is a failure. Then `GET …/schema-actualize-triggers/:triggerId` → `{ success, error? }`, and `success: false` fails with `error`.
   4. `PUT /api/data-marts/:id/publish` (body `{}`).
   5. `PUT /api/data-marts/:id/availability` `{ availableForReporting: true, availableForMaintenance: false }`.
5. Link: `martAppUrl(ctx.projectId, id)` from `src/config.ts`. It opens through `ctx.ui.openExternal` (the plugin runs in an iframe), and is also rendered as an `<a target="_blank" rel="noopener noreferrer">`.
6. Default name: `exportTitle(martTitle)` from `src/api/exports.ts`, the same title Google Sheets export uses.
7. Plugin conventions: every `<button>` has `type="button"`; forms use `ActionForm` (see `src/no-form-submit.test.ts`); dialogs trap Tab and close on Escape the way `TextDialog` in `ExportMenu.tsx` does. Comments are one-line JSDoc in the file's own voice.
8. Tests: Vitest with at most 4 threads: `npx vitest run --poolOptions.threads.maxThreads=4 <path>`.
9. Writing for UI and README follows the existing README voice: short, plain sentences.

## Review Focus

1. A joined field whose original name is nested (`originalName` contains `.`, e.g. a BigQuery RECORD `address.city`). It must be read as `t1.address.city` on BigQuery and given its blended name as the output alias. On dialects without nested fields it is quoted as one identifier. Test in Task 2.
2. Two joined columns from different marts can share an original name (`Customers · name`, `Products · name`). Each output column is aliased with the field's blended `name` (unique by construction), never with `originalName`. Test in Task 2.
3. A filter on a joined field goes into WHERE on that join's table alias. An incomplete filter (`isComplete` false) is skipped, like the grid does. Test in Task 2.
4. A mart reached through a nested alias path (`customers.region`): its join hangs from the parent path's table alias, not from the main table. Test in Task 2.
5. Create fails half-way (for example publish rejects the SQL). The mart exists as a draft, so the dialog must show the error and a link to that draft. A retry must not silently create a second mart: Retry resumes from the failed step for the same id. Test in Task 4.

---

## File Structure

1. Create `src/datamart/dialect.ts`: `Dialect` type, `dialectFor(storageType)`, identifier and literal quoting, `renderFilter(dialect, columnSql, field, filter)`.
2. Create `src/datamart/dialect.test.ts`.
3. Create `src/datamart/build-sql.ts`: `buildMartSql(input) → { sql } | { reason }`.
4. Create `src/datamart/build-sql.test.ts`.
5. Create `src/datamart/create.ts`: `createDataMart(ctx, req, onStage)`, `CreateMartError`.
6. Create `src/datamart/create.test.ts`.
7. Modify `src/api/blendable.ts`: keep `relationshipId` on `JoinedSource`.
8. Modify `src/ui/explorer/ExportMenu.tsx`: the item, the dialog.
9. Modify `src/ui/explorer/MartGrid.tsx:644`: pass the new props.
10. Modify `src/sdk/mock/ctx.ts`: answer the five REST routes so `?mock` works.
11. Modify `README.md`: the Export paragraph, "What it writes".

---

### Task 1: SQL dialects and filter rendering

**Files:**
1. Create: `src/datamart/dialect.ts`
2. Test: `src/datamart/dialect.test.ts`

**Interfaces:**
1. Consumes: `ColumnFilter`, `isComplete` from `src/filters/build.ts`; `Field` from `src/model/types.ts`; `RelativeDatePreset` from `src/sdk/types.ts`; `isDateTimeField`, `RELATIVE_PRESETS` from `src/filters/catalogue.ts`.
2. Produces:

```ts
export type Dialect = 'bigquery' | 'athena' | 'snowflake' | 'redshift' | 'databricks';
/** The dialect of a storage type, or why a data mart there cannot reference others. */
export function dialectFor(storageType: string): { dialect: Dialect } | { reason: string };
/** One identifier, quoted for the dialect (`a.b` stays one identifier). */
export function quoteIdent(d: Dialect, name: string): string;
/** A nested path `address.city` as the dialect reads it from table alias `t`: BigQuery `t.address.city` with each part quoted, the others one quoted identifier. */
export function columnRef(d: Dialect, tableAlias: string, name: string): string;
/** One complete filter as a SQL predicate on `col` (already a column reference). */
export function renderFilter(d: Dialect, col: string, field: Field, f: ColumnFilter): string;
```

**How to write `renderFilter`:** port it from the backend's clause renderers, which turn the same `TraverseFilter` operators into SQL for each warehouse. Read them first:
1. `/Users/flakss/Projects/owox-data-marts/apps/backend/src/data-marts/data-storage-types/bigquery/services/bigquery-clause-renderer.ts`
2. `…/athena/services/athena-clause-renderer.ts`
3. `…/snowflake/services/snowflake-clause-renderer.ts`
4. `…/redshift/services/redshift-clause-renderer.ts`
5. `…/databricks/services/databricks-clause-renderer.ts`

Produce the same SQL for each operator, including `relative_date` (current-date arithmetic in each dialect) and blank checks. Convert the grid filter to a `TraverseFilter` with the existing `toTraverseFilter(f, field)` from `src/filters/build.ts`, then render that, so values get the same normalisation as the grid's query (seconds, inclusive date-only bounds). Literals are inlined and escaped: strings with `'` doubled (BigQuery: `\` → `\\` too), numbers through `Number.isFinite` (otherwise throw). Casts follow the renderer of that dialect.

- [ ] **Step 1: Write failing tests.** Cover each dialect for:
  1. `quoteIdent`: BigQuery and Databricks use backticks; Athena, Snowflake and Redshift use double quotes; an embedded quote character is doubled.
  2. `dialectFor`: `LEGACY_GOOGLE_BIGQUERY` and an unknown type return the two reasons from Global Constraints 2 and 3.
  3. `columnRef(d, 't1', 'address.city')`: BigQuery gives `` t1.`address`.`city` ``, Snowflake gives `t1."address.city"`.
  4. `renderFilter`: `eq` on a string with an apostrophe (`O'Brien`); `contains`; `between` on numbers; `between` on a date-only DATETIME field (inclusive end `23:59:59`); `is_blank` on a string (the backend treats `''` as blank where its renderer does, so match that); `is_true`; `relative` with `{ kind: 'last_n_days', n: 7 }` (use a real kind from `RELATIVE_PRESETS`). Assert exact strings, copied from what the backend renderer would produce for that dialect.

```ts
import { describe, expect, it } from 'vitest';
import { columnRef, dialectFor, quoteIdent, renderFilter } from './dialect';
import type { Field } from '../model/types';

const text: Field = { name: 'city', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false };

describe('quoteIdent', () => {
  it('quotes per dialect', () => {
    expect(quoteIdent('bigquery', 'city')).toBe('`city`');
    expect(quoteIdent('snowflake', 'ci"ty')).toBe('"ci""ty"');
  });
});
describe('dialectFor', () => {
  it('refuses legacy BigQuery', () => {
    expect(dialectFor('LEGACY_GOOGLE_BIGQUERY')).toEqual({ reason: "References between data marts aren't available for Legacy Google BigQuery storages" });
  });
});
describe('renderFilter', () => {
  it('escapes a quote in a string literal', () => {
    expect(renderFilter('athena', columnRef('athena', 't0', 'city'), text, { field: 'city', op: 'eq', value: "O'Brien" })).toBe(`t0."city" = 'O''Brien'`);
  });
  // …one case per bullet above, per dialect
});
```

- [ ] **Step 2:** Run `npx vitest run --poolOptions.threads.maxThreads=4 src/datamart/dialect.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3:** Implement `dialect.ts`.
- [ ] **Step 4:** Run the test again. Expected: PASS.
- [ ] **Step 5:** Commit: `git add src/datamart/dialect.ts src/datamart/dialect.test.ts && git commit -m "Create Data Mart: SQL dialects and filter rendering per storage"`

---

### Task 2: The data mart's SQL from the grid

**Files:**
1. Modify: `src/api/blendable.ts` (add `relationshipId?: string` to `JoinedSource`; set it from `AvailableSourceDto.relationshipId` in `joinedSources`)
2. Modify: `src/api/blendable.test.ts` (one assertion that `relationshipId` comes through)
3. Create: `src/datamart/build-sql.ts`
4. Test: `src/datamart/build-sql.test.ts`

**Interfaces:**
1. Consumes: everything from Task 1; `JoinedSource` (`src/api/blendable.ts`); `Edge` (`src/model/types.ts`); `parentPath` (`src/state/join-plan.ts`); `isComplete` (`src/filters/build.ts`).
2. Produces:

```ts
export type MartSqlInput = {
  dialect: Dialect;
  main: { id: string; title: string };
  /** The main grid's schema: main fields and joined fields (a joined field has `joined`). */
  schema: Schema;
  /** Shown columns, in grid order. */
  visible: string[];
  filters: ColumnFilter[];
  /** The main mart's joined sources (`BlendableLoader.get(mainId)`). */
  sources: JoinedSource[];
  /** The model's edges (`model.edges`). */
  edges: Edge[];
  /** Mart titles by id, for reference labels. */
  titles: Map<string, string>;
};
export function buildMartSql(input: MartSqlInput): { sql: string } | { reason: string };
```

**Rules:**
1. The main mart is `t0`. Each alias path in use gets `t1`, `t2`… in the order its first column appears in `visible`, followed by paths only filters use. Each path's ancestors come first, so `customers.region` brings `customers` in before it.
2. A path is in use when a shown column or a complete filter belongs to it (`field.joined.aliasPath`).
3. Join of a path: `LEFT JOIN <ref> AS tN ON <parent>.<sourceField> = tN.<targetField> AND …`. Here `<parent>` is the table alias of `parentPath(aliasPath)` (`t0` for `''`), and the pairs come from the edge whose `id === source.relationshipId`. If `relationshipId` is missing or no edge has that id, fall back to the single edge with `source === parentMartId && target === source.martId`. Zero or several such edges → `{ reason: 'The join to "<label>" could not be resolved' }`. Check in `node_modules/@owox/plugin-sdk` that `getEdges` ids are relationship ids, and say what you found in your report.
4. SELECT: a main field is `columnRef(d,'t0',name)` with no alias (it keeps its name, and so its alias and description from the referenced mart). A joined field is `columnRef(d,'tN',originalName) AS quoteIdent(d, name)`, where `name` is the blended name.
5. WHERE: every complete filter (`isComplete`), joined by `AND`, through `renderFilter` on the right table alias. A filter on a column that is not shown still applies.
6. No ORDER BY, no LIMIT, no GROUP BY.
7. Nothing shown → `{ reason: 'Show at least one column' }`. A shown field missing from the schema is skipped.
8. Layout: one clause per line, with the select list one column per line indented two spaces, so the SQL reads well in OWOX's editor:

```sql
SELECT
  t0.`id`,
  t1.`city` AS `customers__city`
FROM [Orders](dm:orders) AS t0
LEFT JOIN [Customers](dm:customers) AS t1 ON t0.`customer_id` = t1.`id`
WHERE t1.`city` = 'Paris'
```

- [ ] **Step 1: Write failing tests.** Cover:
  1. Main-only grid, BigQuery: the exact SQL.
  2. One joined column: the exact SQL above.
  3. The Review Focus items 1, 2, 3 and 4.
  4. Fallback by source/target when `relationshipId` is absent, and the reason when two edges match.
  5. A title with `]` in it becomes `)` in the label.
  6. No visible columns returns the reason.

  Build fixtures inline: a `JoinedSource` literal with `fields` carrying `joined: { martId, label, aliasPath, originalName }`.
- [ ] **Step 2:** Run `npx vitest run --poolOptions.threads.maxThreads=4 src/datamart/build-sql.test.ts src/api/blendable.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run again. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Create Data Mart: the SQL references the main and joined data marts, with the shown columns and the filters"`

---

### Task 3: Creating, publishing and opening the data mart in OWOX

**Files:**
1. Create: `src/datamart/create.ts`
2. Test: `src/datamart/create.test.ts`
3. Modify: `src/sdk/mock/ctx.ts` (answer the routes so `?mock` and the UI tests have a backend)

**Interfaces:**
1. Consumes: `Ctx` (`src/sdk/types.ts`); `martAppUrl` (`src/config.ts`).
2. Produces:

```ts
export type CreateStage = 'create' | 'define' | 'schema' | 'publish' | 'share';
export const CREATE_STAGE_LABEL: Record<CreateStage, string>; // 'Creating the data mart…', 'Saving its SQL…', 'Reading its columns…', 'Publishing…', 'Making it available for reporting…'
export class CreateMartError extends Error {
  constructor(message: string, readonly stage: CreateStage, readonly martId?: string);
}
export type CreateMartRequest = { title: string; storageId: string; sql: string; /** Resume a mart an earlier attempt created: skips 'create'. */ martId?: string; /** Resume from this stage (with martId). */ from?: CreateStage; signal?: AbortSignal };
/** Runs the REST steps in order; onStage is called as each starts. Resolves with the new mart's id and its OWOX link. */
export function createDataMart(ctx: Ctx, req: CreateMartRequest, onStage?: (s: CreateStage) => void, o?: { pollMs?: number; timeoutMs?: number }): Promise<{ id: string; url: string }>;
```

Error messages: use the server's message when the thrown error carries one (look at how `src/api/exports.ts` reads messages off `ctx.owox` errors, and reuse its helper if there is one). A schema timeout says "OWOX is still reading the columns. Open the data mart to publish it." Every error after `create` carries `martId`.

- [ ] **Step 1: Write failing tests** with a fake `ctx.owox` (see `src/api/test-ctx.ts` for the existing helper) that records calls:
  1. The happy path makes the five calls in order with the exact bodies from Global Constraints 4, polls status until `SUCCESS` (`READY` → `PROCESSING` → `SUCCESS`), reports stages in order, and returns `{ id, url: martAppUrl(projectId, id) }`.
  2. Schema result `{ success: false, error: 'Syntax error at 3:1' }` throws `CreateMartError` with stage `'schema'`, `martId` set, and that message.
  3. A status that stays `PROCESSING` past `timeoutMs` throws the timeout message (use `pollMs: 1, timeoutMs: 5`).
  4. A failed publish throws stage `'publish'` with `martId`.
  5. Resume: `{ martId: 'm1', from: 'publish' }` makes only the publish and availability calls.
  6. An aborted `signal` stops polling and throws.
- [ ] **Step 2:** Run `npx vitest run --poolOptions.threads.maxThreads=4 src/datamart/create.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `create.ts`. In `src/sdk/mock/ctx.ts`, answer the routes: create returns a new id and adds a mart to the fixtures' list where that is cheap; otherwise it just returns the id. Status returns `SUCCESS` after one poll. The schema result is `{ success: true }`.
- [ ] **Step 4:** Run again, then the whole suite: `npx vitest run --poolOptions.threads.maxThreads=4`. Expected: PASS.
- [ ] **Step 5:** Commit: `git commit -m "Create Data Mart: create, define, read the schema, publish and share through the OWOX API"`

---

### Task 4: The Export menu item and dialog

**Files:**
1. Modify: `src/ui/explorer/ExportMenu.tsx`
2. Modify: `src/ui/explorer/MartGrid.tsx:644`
3. Test: `src/ui/explorer/ExportMenu.test.tsx`
4. Modify: `src/ui/bands/bands.css` (only if the dialog needs a class beyond Tailwind utilities)
5. Modify: `README.md`

**Interfaces:**
1. Consumes: `dialectFor`, `buildMartSql`, `createDataMart`, `CreateMartError`, `CREATE_STAGE_LABEL`, `exportTitle`, `martAppUrl`.
2. New `ExportMenu` props, all optional so existing tests keep compiling:

```ts
/** The main mart's storage, for Create Data Mart. */
storage?: { id: string; type: string };
/** The main mart's joined sources and the model's edges and titles, for the SQL. */
sources?: JoinedSource[];
edges?: Edge[];
titles?: Map<string, string>;
```

In `MartGrid.tsx`, take `storage` from `model.storages.find((s) => s.id === model.marts.get(martId)?.storageId)`, `edges` from `model.edges`, `titles` as a `Map` of `model.marts` titles (memoised), and `sources` from whatever `MartGrid` already uses for the joined sources (find it: `useJoinSources` / `BlendableLoader`).

**Menu:** a new group after the Copy group, behind a separator (`<div role="separator" className="dm-menu-sep" />`), `aria-label="Data mart"`. It holds one item: lucide `DatabaseZap` icon, label "Create Data Mart", `data-action="create-mart"`, `data-lvl="1"`. It is disabled with a Tooltip reason (the same pattern as Copy SQL) when:
1. there is no storage or no sources yet: "Loading the data mart's joins…";
2. `dialectFor` gives a reason: that reason;
3. `buildMartSql` gives a reason: that reason.

`onMenuKey`'s ArrowRight rule must not treat `create-mart` as an assistant row. Extend the excluded actions next to `'copy'` and `'sql'`.

**Dialog `CreateMartDialog`** (portal, like `ExportDialog`; `ActionForm` with `aria-label="Create Data Mart"`):
1. Heading "Create Data Mart". Note: "An SQL data mart in <storage title or type> that references <main title> and the <n> joined data marts the grid uses, with its columns and filters. It is published and available for reporting." Drop the joined part when n = 0.
2. "Name" input, prefilled with `exportTitle(martTitle)` and focused with its text selected.
3. A collapsed `<details>` "SQL" showing the generated SQL in a read-only monospace textarea, so the member sees what will be saved.
4. Buttons: Cancel, Create. While running, Create shows a spinner and the stage label, and the inputs are disabled. Escape and the backdrop do not close the dialog while a run is in flight.
5. Success: the form is replaced by "Created <name>." with a link "Open <name>" (an `<a href={url} target="_blank" rel="noopener noreferrer">` whose onClick calls `ctx.ui.openExternal(url)` and prevents the default), plus a Close button. Focus goes to the link.
6. Failure: `role="alert"` with the message. If the error has `martId`, add "The data mart was created as a draft:" and an "Open the draft" link. Create becomes "Retry", which calls `createDataMart` with `{ martId, from: error.stage }`. An empty name shows "Give the data mart a name." and does not call OWOX.
7. Closing returns focus to the Export summary (the `returnFocus` pattern of `ExportDialog`).
8. The SQL is built once, when the dialog opens, from the props at that moment. Later grid changes don't change a dialog that is already open.

- [ ] **Step 1: Write failing tests** in `ExportMenu.test.tsx`. Follow the render helper around line 1008, and pass `storage`, `sources`, `edges`, `titles` and a fake `ctx.owox` that answers the five routes. Cover:
  1. The menu has three separators, and the new item comes last.
  2. Disabled with the legacy BigQuery reason.
  3. The dialog opens with the default name and the SQL in the SQL section.
  4. Create runs the calls (assert the POST body `{ title, storageId }`), and success shows the link with `href` = `martAppUrl(projectId, id)`.
  5. Publish fails: the alert shows "Open the draft", and Retry makes only publish and availability calls.
  6. An empty name shows the validation message and makes no calls.
  7. Keyboard: ArrowDown from Copy SQL reaches "Create Data Mart", and ArrowRight on it does nothing.
- [ ] **Step 2:** Run `npx vitest run --poolOptions.threads.maxThreads=4 src/ui/explorer/ExportMenu.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. Update `ExportMenu`'s JSDoc summary to name the new item.
- [ ] **Step 4:** Run the whole suite, `npx tsc -b` and `npm run lint`. Expected: all PASS.
- [ ] **Step 5: README.**
  1. In the "📤 Take it to a sheet, or to an AI." paragraph, add one sentence: "Create Data Mart, the last item, saves the grid as a new SQL data mart in the same storage. Its query references the main data mart and the joined ones the grid uses, keeps the shown columns and the filters, and is published and available for reporting. A one-to-many join repeats the main rows."
  2. In "What it writes", add: "Create Data Mart creates, publishes and shares one data mart."
- [ ] **Step 6:** Commit: `git commit -m "Export menu: Create Data Mart saves the grid as a published SQL data mart that references the data marts it uses"`
