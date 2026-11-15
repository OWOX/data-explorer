# Data Explorer plugin implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only OWOX Data Marts plugin that shows data marts and their relationships on a canvas and lets a member browse each mart's rows and records.

**Architecture:** A static Vite + React app that runs in the OWOX plugin iframe. All OWOX access goes through a narrow `Ctx` interface (`src/sdk/types.ts`) that the real `@owox/plugin-sdk` context satisfies and that a mock implements for tests and `?mock` mode. Pure logic (`graph/`, `filters/`, `records/`, `api/`) carries the unit tests. React UI sits on top.

**Tech Stack:** Vite 8, React 19, TypeScript strict, Tailwind CSS v4, `@xyflow/react` 12, `@dagrejs/dagre` 3, `@tanstack/react-table` 9, `@radix-ui/react-popover`, `@radix-ui/react-tooltip`, `lucide-react`, `@owox/plugin-sdk` 0.43, Vitest 5, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-14-data-explorer-design.md`

## Global constraints

1. Read-only. Never call a write endpoint (`PUT`, `PATCH`, `DELETE`, or any `POST` other than `/api/data-marts/data-quality/summaries`). The only writes are `ctx.collections('row-counts').put`.
2. All OWOX access goes through the `Ctx` interface in `src/sdk/types.ts`. No module imports `@owox/plugin-sdk` except `src/sdk/connect.ts`.
3. No `localStorage`, `sessionStorage`, `IndexedDB` or cookies (opaque origin).
4. Do not import `@owox/ui`. Copy styles.
5. Column names in `traverseData` and keys in streamed rows are the field `name`, not the alias.
6. Fields with `isHiddenForReporting: true` cannot be read through `traverseData`. Treat them as absent everywhere: picker, title heuristic, primary key detection, search.
7. Canvas budget: 12 marts (`VISIBLE_BUDGET = 12`). Rows page size: 200 (`PAGE_SIZE = 200`). Schema fetch concurrency: 6.
8. App URL constant: `OWOX_APP_URL = 'https://app.owox.com'`. Mart link: `${OWOX_APP_URL}/ui/${projectId}/data-marts/${id}/overview`.
9. Vitest runs with `--poolOptions.threads.maxThreads=4` (set in `vitest.config.ts`). Playwright runs with `--workers=4 --trace off`.
10. Reference sources from `OWOX/owox-data-marts` at `origin/main` are extracted in `tmp/ref/` (file names are the repo path with `/` replaced by `_`). Read them with `git -C /Users/flakss/Projects/owox-data-marts show origin/main:<path>` if missing. Do not check out or modify that repo.
11. Commit messages: conventional prefix (`feat:`, `test:`, `chore:`), ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. A mart whose primary key field is hidden for reporting. Expected: treated as "no primary key", so preview only and no record links.
2. A relationship column whose value is null or empty. Expected: the cell is empty, it is not sent in the `in` lookup, and it is not clickable.
3. More than 500 distinct values in a relationship column on one page. Expected: the lookup splits into batches of 500 (the `in` limit).
4. A search that matches nothing. Expected: an empty canvas with "No data marts match", and clearing the search restores the default view.
5. Closing the active tab. Expected: the tab to its left becomes active, or the right one if it was first. Closing the last tab leaves explore mode.

Each item has a test in the task that owns the code: 1 in Task 6, 2 and 3 in Task 6, 4 in Task 4 and Task 8, 5 in Task 8.

---

## File structure

```
plugin.json                         manifest
index.html
vite.config.ts  vitest.config.ts  playwright.config.ts  tsconfig.json  eslint.config.js
.github/workflows/pages.yml         deploy on release
src/
  main.tsx                          boot: connect or mock, render <App>
  styles.css                        Tailwind + OWOX tokens (light/dark)
  config.ts                         constants
  sdk/
    types.ts                        Ctx interface + DTO and traverse types
    connect.ts                      real connect() adapter
    mock/ctx.ts                     createMockCtx(fixtures)
    mock/fixtures.ts                demo model
    mock/evaluate.ts                in-memory traverse filter evaluation
  model/
    types.ts                        Mart, Field, Edge, Context, Model, DqSummary
    field-category.ts               categorizeFieldType()
  api/
    model.ts                        loadModel(ctx)
    schemas.ts                      createSchemaLoader(ctx)
    data-quality.ts                 loadDqSummaries(ctx, ids)
    row-counts.ts                   createRowCounter(ctx)
    rows.ts                         readRows(ctx, martId, opts)
    pool.ts                         runPool(items, limit, fn)
  graph/
    visible.ts                      inboundCounts, pickFocus, expandLevels, neighbours, computeVisible
    search.ts                       matchesSearch, matchesContexts
    layout.ts                       layoutNodes(ids, edges, direction)
  filters/
    catalogue.ts                    operators per category
    build.ts                        toTraverseFilter
  records/
    title-field.ts                  pickTitleField
    relationships.ts                relationshipColumns, clickTarget, primaryKeys
    titles.ts                       lookupTitles
  state/
    store.tsx                       reducer, provider, hooks
  ui/
    icons.tsx                       MartIcon, ContextIcon, DqIcon, FreshnessIcon
    format.ts                       compactNumber, relativeTime
    Tooltip.tsx  Popover.tsx  ErrorBox.tsx  Skeleton.tsx
    App.tsx
    header/Header.tsx
    canvas/Canvas.tsx  canvas/MartCard.tsx
    explorer/Explorer.tsx  explorer/TabBar.tsx  explorer/MartTab.tsx
    explorer/RecordTab.tsx  explorer/ColumnPicker.tsx  explorer/FilterPopover.tsx
    explorer/CellValue.tsx
tests/
  unit mirrors src/ (tests live next to code as *.test.ts[x])
e2e/
  smoke.spec.ts
```

---

### Task 1: Project scaffold, manifest, deploy

**Files:**
- Create: `package.json`, `tsconfig.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.prettierrc`, `index.html`, `plugin.json`, `.github/workflows/pages.yml`, `src/main.tsx`, `src/styles.css`, `src/config.ts`, `src/test-setup.ts`, `src/config.test.ts`, `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `src/config.ts` exports `OWOX_APP_URL`, `VISIBLE_BUDGET`, `PAGE_SIZE`, `SCHEMA_CONCURRENCY`, `IN_LIST_MAX`, `martAppUrl(projectId: string, martId: string): string`.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/flakss/Projects/data-explorer
npm init -y
npm pkg set name=data-explorer private=true type=module
npm pkg set scripts.dev="vite" scripts.build="tsc -b && vite build" scripts.preview="vite preview" scripts.test="vitest run" scripts.lint="eslint ." scripts.e2e="playwright test --workers=4 --trace off"
npm i react@19 react-dom@19 @owox/plugin-sdk@0.43.0 @xyflow/react@12 @dagrejs/dagre@3 @tanstack/react-table@9 @radix-ui/react-popover@1 @radix-ui/react-tooltip@1 lucide-react
npm i -D typescript vite@8 @vitejs/plugin-react tailwindcss@4 @tailwindcss/vite@4 vitest@5 jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @types/react @types/react-dom @playwright/test eslint @eslint/js typescript-eslint eslint-plugin-react-hooks prettier
```

If `@tanstack/react-table@9` does not install or its API differs from v8 (`useReactTable`, `getCoreRowModel`, `flexRender`), install `@tanstack/react-table@8` instead and note it in the commit message.

Do not run `playwright install`. Chromium is preinstalled. If launching fails, set `executablePath: '/opt/pw-browsers/chromium'` in `playwright.config.ts`.

- [ ] **Step 2: Config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "e2e", "vite.config.ts", "vitest.config.ts", "playwright.config.ts"]
}
```

`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['src/test-setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    poolOptions: { threads: { maxThreads: 4 } },
  },
});
```

`src/test-setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

`eslint.config.js`:
```js
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist', 'tmp', 'node_modules'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { plugins: { 'react-hooks': hooks }, rules: hooks.configs.recommended.rules },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/sdk/connect.ts'],
    rules: { 'no-restricted-imports': ['error', { paths: ['@owox/plugin-sdk', '@owox/ui'] }] },
  },
);
```

`.prettierrc`:
```json
{ "singleQuote": true, "printWidth": 100, "trailingComma": "all" }
```

Append to `.gitignore`: `test-results/`, `playwright-report/`.

- [ ] **Step 3: Write the failing test** `src/config.test.ts`

```ts
import { martAppUrl, VISIBLE_BUDGET, PAGE_SIZE } from './config';

test('martAppUrl builds the OWOX overview link', () => {
  expect(martAppUrl('p1', 'dm 1')).toBe('https://app.owox.com/ui/p1/data-marts/dm%201/overview');
});

test('budgets match the spec', () => {
  expect(VISIBLE_BUDGET).toBe(12);
  expect(PAGE_SIZE).toBe(200);
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `npx vitest run src/config.test.ts`
Expected: FAIL, cannot resolve `./config`.

- [ ] **Step 5: Implement** `src/config.ts`

```ts
export const OWOX_APP_URL = 'https://app.owox.com';
export const VISIBLE_BUDGET = 12;
export const PAGE_SIZE = 200;
export const SCHEMA_CONCURRENCY = 6;
export const IN_LIST_MAX = 500;

export function martAppUrl(projectId: string, martId: string): string {
  return `${OWOX_APP_URL}/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;
}
```

- [ ] **Step 6: Styles, entry, manifest, deploy**

`src/styles.css`. The tokens copy the host's palette names, so ported class names (`bg-background`, `text-muted-foreground`, `border`) work:
```css
@import 'tailwindcss';

@custom-variant dark (&:where(.dark, .dark *));

@theme {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-border: var(--border);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-accent: var(--accent);
  --color-success: var(--success);
  --color-warning: var(--warning);
  --color-destructive: var(--destructive);
  --color-notice: var(--notice);
  --font-sans: 'Inter', ui-sans-serif, system-ui, sans-serif;
}

:root {
  --background: #ffffff;
  --foreground: #0f172a;
  --muted: #f1f5f9;
  --muted-foreground: #64748b;
  --border: #e2e8f0;
  --primary: #1e88e5;
  --primary-foreground: #ffffff;
  --accent: #f1f5f9;
  --success: #16a34a;
  --warning: #d97706;
  --destructive: #dc2626;
  --notice: #2563eb;
}

.dark {
  --background: #0b1220;
  --foreground: #e2e8f0;
  --muted: #1e293b;
  --muted-foreground: #94a3b8;
  --border: #1f2a3c;
  --primary: #42a5f5;
  --primary-foreground: #0b1220;
  --accent: #1e293b;
  --success: #22c55e;
  --warning: #f59e0b;
  --destructive: #f87171;
  --notice: #60a5fa;
}

html, body, #root { height: 100%; margin: 0; }
body { background: var(--background); color: var(--foreground); font-family: var(--font-sans); }
* { border-color: var(--border); }
```

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Data Explorer</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`src/main.tsx` (placeholder until Task 8 replaces the body of `boot`):
```tsx
import { createRoot } from 'react-dom/client';
import './styles.css';

createRoot(document.getElementById('root')!).render(<p className="p-4">Data Explorer</p>);
```

`plugin.json`:
```json
{
  "name": "Data Explorer",
  "description": "Browse data marts, their relationships and their rows.",
  "delivery": { "type": "remote", "url": "https://owox.github.io/data-explorer/" },
  "collections": [{ "name": "row-counts", "scope": "member" }]
}
```

`.github/workflows/pages.yml`:
```yaml
name: Deploy to GitHub Pages
on:
  release:
    types: [published]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npm run build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
      - id: deployment
        uses: actions/deploy-pages@v4
```

`README.md`: one paragraph on what the plugin does, then `npm run dev` then open `http://localhost:5173/?mock`, `npm test`, `npm run e2e`, and the release steps (tag `vX.Y.Z`, publish a GitHub Release, then Plugins → Publish Plugin → `owox/data-explorer` in OWOX).

- [ ] **Step 7: Verify**

Run: `npx vitest run && npx tsc -b && npx vite build && npx eslint .`
Expected: 2 tests pass, build writes `dist/`, lint clean.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "chore: scaffold Vite React plugin with manifest and Pages deploy"
```

---

### Task 2: Ctx interface, domain types, API layer

**Files:**
- Create: `src/sdk/types.ts`, `src/model/types.ts`, `src/model/field-category.ts`, `src/api/pool.ts`, `src/api/model.ts`, `src/api/schemas.ts`, `src/api/data-quality.ts`, `src/api/row-counts.ts`, `src/api/rows.ts`, `src/api/test-ctx.ts`
- Test: `src/model/field-category.test.ts`, `src/api/pool.test.ts`, `src/api/model.test.ts`, `src/api/schemas.test.ts`, `src/api/data-quality.test.ts`, `src/api/row-counts.test.ts`, `src/api/rows.test.ts`

**Interfaces:**
- Consumes: `SCHEMA_CONCURRENCY` from `src/config.ts`.
- Produces: everything below. Later tasks use these exact names.

- [ ] **Step 1: Write `src/sdk/types.ts`** (types only, no test)

```ts
// Narrow view of @owox/plugin-sdk's PluginContext. The real context satisfies it structurally.
// Traverse types are copied from @owox/api-client (tmp/ref/packages_api-client_src_data-marts.ts).

export type RelativeDatePreset =
  | { kind: 'today' } | { kind: 'yesterday' }
  | { kind: 'this_week' } | { kind: 'last_week' }
  | { kind: 'this_month' } | { kind: 'last_month' }
  | { kind: 'this_quarter' } | { kind: 'last_quarter' }
  | { kind: 'this_year' }
  | { kind: 'last_n_days'; n: number } | { kind: 'last_n_months'; n: number };

export type TraverseFilter =
  | { column: string; operator: 'eq' | 'neq' | 'contains' | 'not_contains' | 'starts_with' | 'ends_with' | 'gt' | 'lt' | 'gte' | 'lte'; value: string | number }
  | { column: string; operator: 'is_blank' | 'is_not_blank' | 'is_true' | 'is_false' }
  | { column: string; operator: 'in' | 'not_in'; value: string[] | number[] }
  | { column: string; operator: 'between'; value: { from: string; to: string } | { from: number; to: number } }
  | { column: string; operator: 'relative_date'; value: RelativeDatePreset };

export type TraverseOptions = {
  columns?: '*';
  column?: string[];
  filter?: TraverseFilter[];
  sort?: { column: string; direction: 'asc' | 'desc' }[];
  aggregation?: { column: string; function: 'COUNT' }[];
  uniqueCount?: string[];
  limit?: number;
};

export type Row = Record<string, unknown>;

export interface Traversal {
  rowChunks(): AsyncIterable<Row[]>;
  cancel(): Promise<void>;
}

export type StorageDto = { id: string; title: string; type: string };
export type DataMartListItemDto = {
  id: string;
  title: string;
  description: string | null;
  contexts: { id: string; name: string; icon?: string | null }[];
  availableForReporting: boolean;
};
export type ModelCanvasNodeDto = {
  id: string;
  title: string;
  description: string | null;
  icon?: string | null;
  fieldCount: number;
  dataLastUpdated?: { dataLastUpdatedAt: string | null; computedAt: string } | null;
};
export type ModelCanvasPageDto = { items: ModelCanvasNodeDto[]; total: number; nextOffset: number | null };
export type EdgeDto = {
  id: string;
  sourceDataMartId: string;
  targetDataMartId: string;
  joinConditions: { sourceFieldName: string; targetFieldName: string }[];
};
export type ContextDto = { id: string; name: string; description: string | null; icon?: string | null };
export type SchemaFieldDto = {
  name: string;
  type: string;
  alias?: string | null;
  description?: string | null;
  isPrimaryKey?: boolean;
  isHiddenForReporting?: boolean;
};
export type DataMartDetailDto = { id: string; schema?: { fields?: SchemaFieldDto[] } | null };
export type DqSummaryDto = {
  state: string;
  totalChecks?: number;
  notApplicableChecks?: number;
  noticeFindings?: number;
  warningFindings?: number;
  errorFindings?: number;
  highestSeverity?: 'notice' | 'warning' | 'error' | null;
  lastRunAt?: string | null;
};
export type DqSummariesResponseDto = { items: { dataMartId: string; summary: DqSummaryDto }[] };

export interface CollectionLike<T> {
  get(id: string): Promise<{ document: T } | null>;
  put(id: string, document: T): Promise<unknown>;
}

export interface Ctx {
  readonly projectId: string;
  readonly theme: string;
  readonly signal: AbortSignal;
  readonly ui: { openExternal(url: string): Promise<void> };
  collections<T>(name: string): CollectionLike<T>;
  readonly owox: {
    storages: { list(): Promise<StorageDto[]> };
    models: { getEdges(storageId: string): Promise<EdgeDto[]> };
    dataMarts: {
      list(): Promise<DataMartListItemDto[]>;
      traverseData(id: string, options: TraverseOptions): Promise<Traversal>;
    };
    getJson<T>(path: string, query?: Record<string, string>): Promise<T>;
    postJson<T>(path: string, body: unknown): Promise<T>;
  };
}
```

- [ ] **Step 2: Write `src/model/types.ts`**

```ts
export type FieldCategory = 'string' | 'number' | 'date' | 'time' | 'boolean' | 'other';

export interface Field {
  name: string;
  alias: string | null;
  type: string;
  category: FieldCategory;
  description: string | null;
  isPrimaryKey: boolean;
}

export interface Context { id: string; name: string; icon: string | null }

export interface Mart {
  id: string;
  title: string;
  description: string | null;
  icon: string | null;
  storageId: string;
  contextIds: string[];
  dataLastUpdatedAt: string | null;
  accessible: boolean;
}

export interface JoinCondition { sourceField: string; targetField: string }
export interface Edge { id: string; source: string; target: string; joins: JoinCondition[] }

export interface Model {
  marts: Map<string, Mart>;
  edges: Edge[];
  contexts: Context[];
}

export interface DqSummary {
  state: string;
  totalChecks?: number;
  notApplicableChecks?: number;
  noticeFindings?: number;
  warningFindings?: number;
  errorFindings?: number;
  highestSeverity?: 'notice' | 'warning' | 'error' | null;
  lastRunAt?: string | null;
}

export type Schema = Field[]; // reporting-visible fields only, in schema order
```

- [ ] **Step 3: Failing tests for field categories and the pool**

`src/model/field-category.test.ts`:
```ts
import { categorizeFieldType } from './field-category';

test.each([
  ['STRING', 'string'], ['varchar', 'string'], ['INT64', 'number'], ['NUMERIC', 'number'],
  ['FLOAT64', 'number'], ['TIMESTAMP', 'date'], ['DATE', 'date'], ['TIME', 'time'],
  ['BOOL', 'boolean'], ['RECORD', 'other'], ['JSON', 'other'],
])('%s is %s', (type, category) => {
  expect(categorizeFieldType(type)).toBe(category);
});
```

`src/api/pool.test.ts`:
```ts
import { runPool } from './pool';

test('runPool never exceeds the limit and keeps result order', async () => {
  let active = 0;
  let peak = 0;
  const out = await runPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
    active++; peak = Math.max(peak, active);
    await new Promise((r) => setTimeout(r, 5));
    active--;
    return n * 2;
  });
  expect(peak).toBeLessThanOrEqual(3);
  expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
});

test('runPool records a rejection as an Error without stopping the others', async () => {
  const out = await runPool([1, 2], 2, async (n) => { if (n === 1) throw new Error('x'); return n; });
  expect(out[0]).toBeInstanceOf(Error);
  expect(out[1]).toBe(2);
});
```

Run: `npx vitest run src/model src/api/pool.test.ts`
Expected: FAIL, modules missing.

- [ ] **Step 4: Implement**

`src/model/field-category.ts` (sets copied from `tmp/ref/apps_backend_src_data-marts_dto_schemas_field-type-category.ts`, plus BigQuery spellings `INT64`, `FLOAT64`, `BOOL`):
```ts
import type { FieldCategory } from './types';

const STRING = new Set(['STRING', 'VARCHAR', 'CHAR', 'TEXT', 'BPCHAR']);
const NUMBER = new Set(['INTEGER', 'INT', 'INT64', 'BIGINT', 'SMALLINT', 'TINYINT', 'FLOAT', 'FLOAT64', 'REAL', 'DOUBLE', 'DOUBLE PRECISION', 'NUMERIC', 'BIGNUMERIC', 'DECIMAL']);
const DATE = new Set(['DATE', 'DATETIME', 'TIMESTAMP', 'TIMESTAMP WITH TIME ZONE', 'TIMESTAMPTZ', 'TIMESTAMP_NTZ']);
const TIME = new Set(['TIME', 'TIME WITH TIME ZONE', 'TIMETZ']);
const BOOL = new Set(['BOOLEAN', 'BOOL']);

export function categorizeFieldType(type: string): FieldCategory {
  const t = type.trim().toUpperCase();
  if (NUMBER.has(t)) return 'number';
  if (STRING.has(t)) return 'string';
  if (DATE.has(t)) return 'date';
  if (TIME.has(t)) return 'time';
  if (BOOL.has(t)) return 'boolean';
  return 'other';
}
```

`src/api/pool.ts`:
```ts
export async function runPool<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        out[i] = await fn(items[i]!, i);
      } catch (e) {
        out[i] = e instanceof Error ? e : new Error(String(e));
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}
```

Run: `npx vitest run src/model src/api/pool.test.ts`
Expected: PASS.

- [ ] **Step 5: Test helper** `src/api/test-ctx.ts` (used by API tests only; the full mock arrives in Task 3)

```ts
import { vi } from 'vitest';
import type { Ctx, Row, Traversal } from '../sdk/types';

export function traversalOf(rows: Row[], chunk = 2): Traversal {
  return {
    async *rowChunks() { for (let i = 0; i < rows.length; i += chunk) yield rows.slice(i, i + chunk); },
    cancel: vi.fn(async () => {}),
  };
}

export function stubCtx(overrides: Partial<{ [K in keyof Ctx['owox']]: unknown }> = {}): Ctx {
  const store = new Map<string, unknown>();
  return {
    projectId: 'p1',
    theme: 'light',
    signal: new AbortController().signal,
    ui: { openExternal: vi.fn(async () => {}) },
    collections: <T,>() => ({
      get: vi.fn(async (id: string) => (store.has(id) ? { document: store.get(id) as T } : null)),
      put: vi.fn(async (id: string, doc: T) => { store.set(id, doc); }),
    }),
    owox: {
      storages: { list: vi.fn(async () => []) },
      models: { getEdges: vi.fn(async () => []) },
      dataMarts: { list: vi.fn(async () => []), traverseData: vi.fn(async () => traversalOf([])) },
      getJson: vi.fn(async () => ({})),
      postJson: vi.fn(async () => ({})),
      ...overrides,
    } as Ctx['owox'],
  };
}
```

- [ ] **Step 6: Failing test for `loadModel`** `src/api/model.test.ts`

```ts
import { vi } from 'vitest';
import { loadModel } from './model';
import { stubCtx } from './test-ctx';

test('loadModel merges storages, canvas nodes, list contexts, edges and contexts', async () => {
  const getJson = vi.fn(async (path: string, query?: Record<string, string>) => {
    if (path === '/api/contexts') return [{ id: 'c1', name: 'Sales', description: null, icon: 'revenue' }];
    if (path === '/api/model-canvas/data-marts' && query?.storageId === 's1') {
      if (!query.offset) return { items: [{ id: 'a', title: 'Orders', description: 'd', icon: 'orders', fieldCount: 3, dataLastUpdated: { dataLastUpdatedAt: '2026-11-01T00:00:00Z', computedAt: 'x' } }], total: 2, nextOffset: 1 };
      return { items: [{ id: 'b', title: 'Customers', description: null, fieldCount: 2 }], total: 2, nextOffset: null };
    }
    throw new Error(`unexpected ${path}`);
  });
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'GOOGLE_BIGQUERY' }] },
    models: { getEdges: async () => [{ id: 'e1', sourceDataMartId: 'a', targetDataMartId: 'b', joinConditions: [{ sourceFieldName: 'customer_id', targetFieldName: 'id' }] }] },
    dataMarts: {
      list: async () => [{ id: 'a', title: 'Orders', description: 'd', contexts: [{ id: 'c1', name: 'Sales' }], availableForReporting: true }],
      traverseData: vi.fn(),
    },
    getJson,
  });

  const model = await loadModel(ctx);

  expect([...model.marts.keys()]).toEqual(['a', 'b']);
  expect(model.marts.get('a')).toEqual({ id: 'a', title: 'Orders', description: 'd', icon: 'orders', storageId: 's1', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-01T00:00:00Z', accessible: true });
  expect(model.marts.get('b')!.accessible).toBe(false); // not in the member's list
  expect(model.edges).toEqual([{ id: 'e1', source: 'a', target: 'b', joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]);
  expect(model.contexts).toEqual([{ id: 'c1', name: 'Sales', icon: 'revenue' }]);
});

test('loadModel drops edges whose ends are unknown', async () => {
  const ctx = stubCtx({
    storages: { list: async () => [{ id: 's1', title: 'BQ', type: 'X' }] },
    models: { getEdges: async () => [{ id: 'e1', sourceDataMartId: 'a', targetDataMartId: 'zzz', joinConditions: [] }] },
    getJson: async (path: string) => (path === '/api/contexts' ? [] : { items: [{ id: 'a', title: 'A', description: null, fieldCount: 0 }], total: 1, nextOffset: null }),
  });
  expect((await loadModel(ctx)).edges).toEqual([]);
});
```

Run: `npx vitest run src/api/model.test.ts` → FAIL.

- [ ] **Step 7: Implement** `src/api/model.ts`

```ts
import type { Ctx, ContextDto, ModelCanvasPageDto } from '../sdk/types';
import type { Edge, Mart, Model } from '../model/types';

async function canvasNodes(ctx: Ctx, storageId: string) {
  const items: ModelCanvasPageDto['items'] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const query: Record<string, string> = { storageId };
    if (offset > 0) query.offset = String(offset);
    const page: ModelCanvasPageDto = await ctx.owox.getJson<ModelCanvasPageDto>('/api/model-canvas/data-marts', query);
    items.push(...page.items);
    offset = page.nextOffset;
  }
  return items;
}

export async function loadModel(ctx: Ctx): Promise<Model> {
  const [storages, list, contexts] = await Promise.all([
    ctx.owox.storages.list(),
    ctx.owox.dataMarts.list(),
    ctx.owox.getJson<ContextDto[]>('/api/contexts'),
  ]);
  const listed = new Map(list.map((m) => [m.id, m]));
  const marts = new Map<string, Mart>();
  const rawEdges = (
    await Promise.all(
      storages.map(async (s) => {
        const [nodes, edges] = await Promise.all([canvasNodes(ctx, s.id), ctx.owox.models.getEdges(s.id)]);
        for (const n of nodes) {
          const item = listed.get(n.id);
          marts.set(n.id, {
            id: n.id,
            title: n.title,
            description: n.description,
            icon: n.icon ?? null,
            storageId: s.id,
            contextIds: item?.contexts.map((c) => c.id) ?? [],
            dataLastUpdatedAt: n.dataLastUpdated?.dataLastUpdatedAt ?? null,
            accessible: item !== undefined,
          });
        }
        return edges;
      }),
    )
  ).flat();

  const edges: Edge[] = rawEdges
    .filter((e) => marts.has(e.sourceDataMartId) && marts.has(e.targetDataMartId))
    .map((e) => ({
      id: e.id,
      source: e.sourceDataMartId,
      target: e.targetDataMartId,
      joins: e.joinConditions.map((j) => ({ sourceField: j.sourceFieldName, targetField: j.targetFieldName })),
    }));

  return { marts, edges, contexts: contexts.map((c) => ({ id: c.id, name: c.name, icon: c.icon ?? null })) };
}
```

Run: `npx vitest run src/api/model.test.ts` → PASS.

- [ ] **Step 8: Failing test for the schema loader** `src/api/schemas.test.ts`

```ts
import { vi } from 'vitest';
import { createSchemaLoader } from './schemas';
import { stubCtx } from './test-ctx';

const detail = (id: string) => ({
  id,
  schema: { fields: [
    { name: 'id', type: 'INT64', isPrimaryKey: true },
    { name: 'secret', type: 'STRING', isHiddenForReporting: true },
    { name: 'name', type: 'STRING', alias: 'Name', description: 'n' },
  ] },
});

test('get() maps reporting-visible fields and caches by id', async () => {
  const getJson = vi.fn(async (path: string) => detail(path.split('/').pop()!));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const a = await loader.get('a');
  await loader.get('a');
  expect(getJson).toHaveBeenCalledTimes(1);
  expect(getJson).toHaveBeenCalledWith('/api/data-marts/a');
  expect(a).toEqual([
    { name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true },
    { name: 'name', alias: 'Name', type: 'STRING', category: 'string', description: 'n', isPrimaryKey: false },
  ]);
});

test('prefetch() loads every id, priority ids first, and notifies subscribers', async () => {
  const order: string[] = [];
  const getJson = vi.fn(async (path: string) => { const id = path.split('/').pop()!; order.push(id); return detail(id); });
  const loader = createSchemaLoader(stubCtx({ getJson }));
  const seen = vi.fn();
  loader.subscribe(seen);
  await loader.prefetch(['x', 'y', 'z'], ['z']);
  expect(order[0]).toBe('z');
  expect(loader.peek('y')).toBeDefined();
  expect(seen).toHaveBeenCalled();
});

test('a failed schema fetch is not cached', async () => {
  const getJson = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(detail('a'));
  const loader = createSchemaLoader(stubCtx({ getJson }));
  await expect(loader.get('a')).rejects.toThrow('boom');
  await expect(loader.get('a')).resolves.toHaveLength(2);
});
```

Run → FAIL.

- [ ] **Step 9: Implement** `src/api/schemas.ts`

```ts
import { SCHEMA_CONCURRENCY } from '../config';
import { categorizeFieldType } from '../model/field-category';
import type { Schema } from '../model/types';
import type { Ctx, DataMartDetailDto } from '../sdk/types';
import { runPool } from './pool';

export interface SchemaLoader {
  get(id: string): Promise<Schema>;
  peek(id: string): Schema | undefined;
  prefetch(ids: string[], priority?: string[]): Promise<void>;
  subscribe(fn: () => void): () => void;
  clear(): void;
}

export function createSchemaLoader(ctx: Ctx): SchemaLoader {
  const done = new Map<string, Schema>();
  const inflight = new Map<string, Promise<Schema>>();
  const listeners = new Set<() => void>();

  function get(id: string): Promise<Schema> {
    const hit = done.get(id);
    if (hit) return Promise.resolve(hit);
    const running = inflight.get(id);
    if (running) return running;
    const p = ctx.owox
      .getJson<DataMartDetailDto>(`/api/data-marts/${encodeURIComponent(id)}`)
      .then((d) => {
        const schema: Schema = (d.schema?.fields ?? [])
          .filter((f) => !f.isHiddenForReporting)
          .map((f) => ({
            name: f.name,
            alias: f.alias ?? null,
            type: f.type,
            category: categorizeFieldType(f.type),
            description: f.description ?? null,
            isPrimaryKey: f.isPrimaryKey === true,
          }));
        done.set(id, schema);
        listeners.forEach((l) => l());
        return schema;
      })
      .finally(() => inflight.delete(id));
    inflight.set(id, p);
    return p;
  }

  return {
    get,
    peek: (id) => done.get(id),
    async prefetch(ids, priority = []) {
      const first = priority.filter((id) => ids.includes(id));
      const ordered = [...first, ...ids.filter((id) => !first.includes(id))];
      await runPool(ordered, SCHEMA_CONCURRENCY, get);
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    clear() { done.clear(); },
  };
}
```

Run → PASS.

- [ ] **Step 10: Failing tests for DQ, row counts and rows**

`src/api/data-quality.test.ts`:
```ts
import { vi } from 'vitest';
import { loadDqSummaries } from './data-quality';
import { stubCtx } from './test-ctx';

test('posts ids and maps the response by data mart id', async () => {
  const postJson = vi.fn(async () => ({ items: [{ dataMartId: 'a', summary: { state: 'PASSED' } }] }));
  const res = await loadDqSummaries(stubCtx({ postJson }), ['a', 'b']);
  expect(postJson).toHaveBeenCalledWith('/api/data-marts/data-quality/summaries', { dataMartIds: ['a', 'b'] });
  expect(res.get('a')).toEqual({ state: 'PASSED' });
  expect(res.has('b')).toBe(false);
});

test('no ids, no request', async () => {
  const postJson = vi.fn();
  expect((await loadDqSummaries(stubCtx({ postJson }), [])).size).toBe(0);
  expect(postJson).not.toHaveBeenCalled();
});
```

`src/api/row-counts.test.ts`:
```ts
import { vi } from 'vitest';
import { countOptions, createRowCounter } from './row-counts';
import { stubCtx, traversalOf } from './test-ctx';
import type { Schema } from '../model/types';

const withPk: Schema = [{ name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true }];
const noPk: Schema = [{ name: 'day', alias: null, type: 'DATE', category: 'date', description: null, isPrimaryKey: false }];

test('countOptions uses uniqueCount with a primary key and COUNT otherwise', () => {
  expect(countOptions(withPk)).toEqual({ options: { uniqueCount: [''] }, key: 'Unique Count' });
  expect(countOptions(noPk)).toEqual({ options: { column: ['day'], aggregation: [{ column: 'day', function: 'COUNT' }] }, key: 'day | COUNT' });
  expect(countOptions([])).toBeNull();
});

test('count() reads the cache first and recount() bypasses it', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ 'Unique Count': 42 }]));
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const counter = createRowCounter(ctx);
  expect(await counter.count('a', withPk)).toBe(42);
  expect(await counter.count('a', withPk)).toBe(42);
  expect(traverseData).toHaveBeenCalledTimes(1);
  traverseData.mockResolvedValueOnce(traversalOf([{ 'Unique Count': '43' }]));
  expect(await counter.recount('a', withPk)).toBe(43);
});

test('a mart with no readable fields counts as null', async () => {
  expect(await createRowCounter(stubCtx()).count('a', [])).toBeNull();
});
```

`src/api/rows.test.ts`:
```ts
import { vi } from 'vitest';
import { readRows } from './rows';
import { stubCtx, traversalOf } from './test-ctx';

test('collects chunks, passes options and reports progress', async () => {
  const t = traversalOf([{ a: 1 }, { a: 2 }, { a: 3 }]);
  const traverseData = vi.fn(async () => t);
  const progress = vi.fn();
  const rows = await readRows(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), 'm', { column: ['a'], limit: 3 }, { onChunk: progress });
  expect(traverseData).toHaveBeenCalledWith('m', { column: ['a'], limit: 3 });
  expect(rows).toEqual([{ a: 1 }, { a: 2 }, { a: 3 }]);
  expect(progress).toHaveBeenCalledTimes(2);
});

test('an aborted signal cancels the stream and rejects with AbortError', async () => {
  const t = traversalOf([{ a: 1 }, { a: 2 }, { a: 3 }], 1);
  const ac = new AbortController();
  const traverseData = vi.fn(async () => t);
  const p = readRows(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), 'm', {}, { signal: ac.signal, onChunk: () => ac.abort() });
  await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  expect(t.cancel).toHaveBeenCalled();
});
```

Run: `npx vitest run src/api` → the three new files FAIL.

- [ ] **Step 11: Implement**

`src/api/data-quality.ts`:
```ts
import type { DqSummary } from '../model/types';
import type { Ctx, DqSummariesResponseDto } from '../sdk/types';

export async function loadDqSummaries(ctx: Ctx, ids: string[]): Promise<Map<string, DqSummary>> {
  if (ids.length === 0) return new Map();
  const res = await ctx.owox.postJson<DqSummariesResponseDto>('/api/data-marts/data-quality/summaries', { dataMartIds: ids });
  return new Map(res.items.map((i) => [i.dataMartId, i.summary]));
}
```

`src/api/rows.ts`:
```ts
import type { Ctx, Row, TraverseOptions } from '../sdk/types';

export interface ReadRowsHooks {
  signal?: AbortSignal;
  onChunk?: (rowsSoFar: Row[]) => void;
}

function abortError() {
  return new DOMException('Aborted', 'AbortError');
}

export async function readRows(ctx: Ctx, martId: string, options: TraverseOptions, hooks: ReadRowsHooks = {}): Promise<Row[]> {
  if (hooks.signal?.aborted) throw abortError();
  const traversal = await ctx.owox.dataMarts.traverseData(martId, options);
  const rows: Row[] = [];
  try {
    for await (const chunk of traversal.rowChunks()) {
      rows.push(...chunk);
      hooks.onChunk?.(rows);
      if (hooks.signal?.aborted) {
        await traversal.cancel();
        throw abortError();
      }
    }
  } catch (e) {
    if (!(e instanceof DOMException)) await traversal.cancel().catch(() => undefined);
    throw e;
  }
  return rows;
}
```

`src/api/row-counts.ts`:
```ts
import type { Schema } from '../model/types';
import type { Ctx, TraverseOptions } from '../sdk/types';
import { readRows } from './rows';

export const ROW_COUNTS_COLLECTION = 'row-counts';
type CountDoc = { dataMartId: string; count: number; at: string };

export function countOptions(schema: Schema): { options: TraverseOptions; key: string } | null {
  if (schema.some((f) => f.isPrimaryKey)) return { options: { uniqueCount: [''] }, key: 'Unique Count' };
  const first = schema[0];
  if (!first) return null;
  return { options: { column: [first.name], aggregation: [{ column: first.name, function: 'COUNT' }] }, key: `${first.name} | COUNT` };
}

export interface RowCounter {
  count(id: string, schema: Schema): Promise<number | null>;
  recount(id: string, schema: Schema): Promise<number | null>;
}

export function createRowCounter(ctx: Ctx): RowCounter {
  const col = ctx.collections<CountDoc>(ROW_COUNTS_COLLECTION);

  async function measure(id: string, schema: Schema): Promise<number | null> {
    const plan = countOptions(schema);
    if (!plan) return null;
    const [row] = await readRows(ctx, id, plan.options);
    const n = Number(row?.[plan.key]);
    if (!Number.isFinite(n)) throw new Error('Row count returned no number');
    await col.put(id, { dataMartId: id, count: n, at: new Date().toISOString() }).catch(() => undefined);
    return n;
  }

  return {
    async count(id, schema) {
      const cached = await col.get(id).catch(() => null);
      if (cached) return cached.document.count;
      return measure(id, schema);
    },
    recount: measure,
  };
}
```

Run: `npx vitest run src/api src/model && npx tsc -b`
Expected: all PASS, no type errors.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: add Ctx interface, domain types and OWOX API layer"
```

---

### Task 3: Mock ctx and fixtures

**Files:**
- Create: `src/sdk/mock/evaluate.ts`, `src/sdk/mock/fixtures.ts`, `src/sdk/mock/ctx.ts`
- Test: `src/sdk/mock/evaluate.test.ts`, `src/sdk/mock/ctx.test.ts`

**Interfaces:**
- Consumes: `Ctx`, `TraverseFilter`, `TraverseOptions`, `Row` and all DTO types from `src/sdk/types.ts`; `loadModel` from `src/api/model.ts` (in the test).
- Produces:
  - `matchesFilter(row: Row, f: TraverseFilter, now?: Date): boolean`
  - `type MockMart = { id: string; title: string; description: string | null; icon: string | null; storageId: string; contexts: string[]; accessible: boolean; dataLastUpdatedAt: string | null; fields: SchemaFieldDto[]; rows: Row[]; dq: DqSummaryDto | null }`
  - `type Fixtures = { storages: StorageDto[]; contexts: ContextDto[]; marts: MockMart[]; edges: EdgeDto[] }`
  - `demoFixtures(): Fixtures`
  - `createMockCtx(f?: Fixtures, opts?: { latencyMs?: number }): Ctx`

- [ ] **Step 1: Failing test** `src/sdk/mock/evaluate.test.ts`

```ts
import { matchesFilter } from './evaluate';

const row = { name: 'Alice', age: 30, active: true, joined: '2026-11-10', note: '  ' };
const now = new Date('2026-11-14T12:00:00Z');

test.each([
  [{ column: 'name', operator: 'contains', value: 'lic' }, true],
  [{ column: 'name', operator: 'not_contains', value: 'lic' }, false],
  [{ column: 'name', operator: 'starts_with', value: 'Al' }, true],
  [{ column: 'name', operator: 'ends_with', value: 'ce' }, true],
  [{ column: 'name', operator: 'eq', value: 'Alice' }, true],
  [{ column: 'age', operator: 'gt', value: 29 }, true],
  [{ column: 'age', operator: 'lte', value: 29 }, false],
  [{ column: 'age', operator: 'between', value: { from: 30, to: 40 } }, true],
  [{ column: 'age', operator: 'in', value: [1, 30] }, true],
  [{ column: 'name', operator: 'not_in', value: ['Alice'] }, false],
  [{ column: 'note', operator: 'is_blank' }, true],
  [{ column: 'name', operator: 'is_not_blank' }, true],
  [{ column: 'active', operator: 'is_true' }, true],
  [{ column: 'active', operator: 'is_false' }, false],
  [{ column: 'joined', operator: 'lt', value: '2026-11-11' }, true],
  [{ column: 'joined', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }, true],
  [{ column: 'joined', operator: 'relative_date', value: { kind: 'today' } }, false],
] as const)('%o → %s', (f, expected) => {
  expect(matchesFilter(row, f as never, now)).toBe(expected);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `src/sdk/mock/evaluate.ts`

```ts
import type { RelativeDatePreset, Row, TraverseFilter } from '../types';

const day = 86_400_000;
const startOfDay = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

function relativeRange(p: RelativeDatePreset, now: Date): [number, number] {
  const today = startOfDay(now);
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const weekStart = today - ((now.getUTCDay() + 6) % 7) * day;
  const q = Math.floor(m / 3) * 3;
  switch (p.kind) {
    case 'today': return [today, today + day];
    case 'yesterday': return [today - day, today];
    case 'this_week': return [weekStart, weekStart + 7 * day];
    case 'last_week': return [weekStart - 7 * day, weekStart];
    case 'this_month': return [Date.UTC(y, m, 1), Date.UTC(y, m + 1, 1)];
    case 'last_month': return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
    case 'this_quarter': return [Date.UTC(y, q, 1), Date.UTC(y, q + 3, 1)];
    case 'last_quarter': return [Date.UTC(y, q - 3, 1), Date.UTC(y, q, 1)];
    case 'this_year': return [Date.UTC(y, 0, 1), Date.UTC(y + 1, 0, 1)];
    case 'last_n_days': return [today - p.n * day, today + day];
    case 'last_n_months': return [Date.UTC(y, m - p.n, 1), today + day];
  }
}

const cmp = (a: unknown, b: unknown) => (typeof b === 'number' ? Number(a) - b : String(a).localeCompare(String(b)));

export function matchesFilter(row: Row, f: TraverseFilter, now = new Date()): boolean {
  const v = row[f.column];
  const s = v == null ? '' : String(v);
  switch (f.operator) {
    case 'eq': return cmp(v, f.value) === 0;
    case 'neq': return cmp(v, f.value) !== 0;
    case 'contains': return s.toLowerCase().includes(String(f.value).toLowerCase());
    case 'not_contains': return !s.toLowerCase().includes(String(f.value).toLowerCase());
    case 'starts_with': return s.startsWith(String(f.value));
    case 'ends_with': return s.endsWith(String(f.value));
    case 'gt': return v != null && cmp(v, f.value) > 0;
    case 'gte': return v != null && cmp(v, f.value) >= 0;
    case 'lt': return v != null && cmp(v, f.value) < 0;
    case 'lte': return v != null && cmp(v, f.value) <= 0;
    case 'between': return v != null && cmp(v, f.value.from) >= 0 && cmp(v, f.value.to) <= 0;
    case 'in': return (f.value as unknown[]).some((x) => cmp(v, x) === 0);
    case 'not_in': return !(f.value as unknown[]).some((x) => cmp(v, x) === 0);
    case 'is_blank': return s.trim() === '';
    case 'is_not_blank': return s.trim() !== '';
    case 'is_true': return v === true;
    case 'is_false': return v === false;
    case 'relative_date': {
      if (v == null) return false;
      const t = Date.parse(s);
      const [from, to] = relativeRange(f.value, now);
      return t >= from && t < to;
    }
  }
}
```

Run → PASS.

- [ ] **Step 3: Fixtures** `src/sdk/mock/fixtures.ts`

Build a model with 16 marts in one storage `s1`, so the level budget is exercised. Write it with this exact topology (source → target):

1. `orders` → `customers` (`customer_id` → `id`), `orders` → `products` (`product_id` → `id`), `orders` → `stores` (`store_id` → `id`)
2. `order_items` → `orders` (`order_id` → `id`), `order_items` → `products` (`product_id` → `id`)
3. `returns` → `orders` (`order_id` → `id`)
4. `payments` → `orders` (`order_id` → `id`)
5. `shipments` → `orders` (`order_id` → `id`)
6. `customers` → `countries` (`country_code` → `code`)
7. `products` → `categories` (`category_id` → `id`)
8. `stores` → `countries` (`country_code` → `code`)
9. `sessions` → `customers` (`customer_id` → `id`), `sessions` → `campaigns` (`campaign_id` → `id`)
10. `ad_spend` → `campaigns` (`campaign_id` → `id`)
11. `reviews` → `products` (`product_id` → `id`)
12. `daily_kpis` has no primary key and no edges. It has fields `day DATE`, `revenue NUMERIC`, `orders INT64`.
13. `secret_ledger` has `accessible: false`, a primary key `id`, and no edges.

`orders` has 5 inbound edges, the most, so it is the default focus.

Every other mart has `id` (`INT64`, primary key) except `countries`, whose primary key is `code STRING`. Each has a `name` or `title` string field. `products` uses `title`. `categories` names its label `label` with alias `Name`, which tests heuristic step 1 by alias. `payments` has no string field besides its keys, so it tests "no title". Give `orders` 8 fields so the column picker default of 5 matters: `id`, `customer_id`, `product_id`, `store_id`, `status STRING`, `amount NUMERIC`, `created_at TIMESTAMP`, `is_gift BOOL`. Add `{ name: 'internal_flag', type: 'STRING', isHiddenForReporting: true }` to `customers`.

Naming rule for row values: customer `name` is "First Last" from two fixed word lists (such as `Anna Koval`). No other mart may have a string value matching `/^[A-Z][a-z]+ [A-Z][a-z]+$/`: products use `Product 1`, stores `Store #1`, campaigns `Campaign 1`, countries their English name with the code in a separate field (`Ukraine`, `United States` is fine because only customers are checked within the Orders grid).

Generate rows with a small seeded generator (no `Math.random`):
```ts
function rng(seed: number) { return () => ((seed = (seed * 16807) % 2147483647) / 2147483647); }
```
`orders`: 450 rows, so "Load more" and the 200 page size are exercised. `customers`: 60. `products`: 40. `countries`: 8 (codes `UA`, `PL`, `DE`, `US`, `GB`, `FR`, `ES`, `IT`). Other marts: 30 each. Foreign key values must point to existing target ids. Leave `customer_id` null on 3 orders (review focus item 2). `created_at` spans the 90 days before `2026-11-14`.

Contexts: `c-sales` "Sales" (icon `revenue`) on `orders`, `order_items`, `payments`, `returns`, `daily_kpis`. `c-catalog` "Catalog" (icon `products`) on `products`, `categories`, `reviews`. `c-marketing` "Marketing" (icon `lucide:megaphone`) on `sessions`, `campaigns`, `ad_spend`.

Icons: `orders` → `orders`, `customers` → `customers`, `products` → `products`, `countries` → `countries`, `campaigns` → `campaigns`, `sessions` → `sessions`, `ad_spend` → `ad-spend`. The rest are `null`.

DQ: `orders` `{ state: 'PASSED' }`, `customers` `{ state: 'ISSUES', warningFindings: 2 }`, `payments` `{ state: 'EXECUTION_FAILED' }`. Others `{ state: 'NEVER_RUN' }`.

Freshness: `dataLastUpdatedAt` is 2 hours before `2026-11-14T12:00:00Z` for `orders`, 3 days before for `customers`, and `null` for the rest.

Descriptions: one sentence for each mart, `null` for `stores`.

Export `demoFixtures(): Fixtures` that builds and returns this object.

- [ ] **Step 4: Failing test** `src/sdk/mock/ctx.test.ts`

```ts
import { createMockCtx } from './ctx';
import { demoFixtures } from './fixtures';
import { loadModel } from '../../api/model';
import { readRows } from '../../api/rows';

test('mock ctx serves a model loadModel understands', async () => {
  const model = await loadModel(createMockCtx(demoFixtures()));
  expect(model.marts.size).toBe(16);
  expect(model.marts.get('secret_ledger')!.accessible).toBe(false);
  expect(model.edges.filter((e) => e.target === 'orders')).toHaveLength(4);
  expect(model.contexts.map((c) => c.id)).toEqual(['c-sales', 'c-catalog', 'c-marketing']);
});

test('traverseData applies column, filter, limit and count options', async () => {
  const ctx = createMockCtx(demoFixtures());
  const rows = await readRows(ctx, 'orders', { column: ['id', 'status'], filter: [{ column: 'id', operator: 'lte', value: 3 }], limit: 2 });
  expect(rows).toEqual([expect.objectContaining({ id: 1 }), expect.objectContaining({ id: 2 })]);
  expect(Object.keys(rows[0]!)).toEqual(['id', 'status']);
  expect(await readRows(ctx, 'orders', { uniqueCount: [''] })).toEqual([{ 'Unique Count': 450 }]);
  expect(await readRows(ctx, 'daily_kpis', { column: ['day'], aggregation: [{ column: 'day', function: 'COUNT' }] })).toEqual([{ 'day | COUNT': 30 }]);
});

test('reading an inaccessible mart rejects', async () => {
  await expect(readRows(createMockCtx(demoFixtures()), 'secret_ledger', {})).rejects.toThrow(/access/i);
});

test('collections round-trip in memory', async () => {
  const col = createMockCtx(demoFixtures()).collections<{ n: number }>('row-counts');
  await col.put('a', { n: 1 });
  expect(await col.get('a')).toEqual({ document: { n: 1 } });
  expect(await col.get('b')).toBeNull();
});
```

Run → FAIL.

- [ ] **Step 5: Implement** `src/sdk/mock/ctx.ts`

```ts
import type { Ctx, Row, TraverseOptions } from '../types';
import { matchesFilter } from './evaluate';
import { demoFixtures, type Fixtures } from './fixtures';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createMockCtx(f: Fixtures = demoFixtures(), opts: { latencyMs?: number } = {}): Ctx {
  const latency = opts.latencyMs ?? 0;
  const byId = new Map(f.marts.map((m) => [m.id, m]));
  const docs = new Map<string, unknown>();
  const slow = async <T,>(v: () => T): Promise<T> => { if (latency) await wait(latency); return v(); };

  function traverse(id: string, o: TraverseOptions): Row[] {
    const m = byId.get(id);
    if (!m) throw new Error(`Data Mart ${id} not found`);
    if (!m.accessible) throw new Error('You do not have access to this Data Mart');
    let rows = m.rows.filter((r) => (o.filter ?? []).every((flt) => matchesFilter(r, flt)));
    if (o.uniqueCount) return [{ 'Unique Count': rows.length }];
    if (o.aggregation?.length) {
      const a = o.aggregation[0]!;
      return [{ [`${a.column} | COUNT`]: rows.filter((r) => r[a.column] != null).length }];
    }
    for (const s of o.sort ?? []) {
      rows = [...rows].sort((x, y) => {
        const d = String(x[s.column] ?? '').localeCompare(String(y[s.column] ?? ''), undefined, { numeric: true });
        return s.direction === 'asc' ? d : -d;
      });
    }
    if (o.limit !== undefined) rows = rows.slice(0, o.limit);
    if (o.column) {
      const cols = o.column;
      rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
    }
    return rows;
  }

  return {
    projectId: 'mock-project',
    theme: window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    signal: new AbortController().signal,
    ui: { openExternal: async (url) => { window.open(url, '_blank', 'noopener'); } },
    collections: <T,>(name: string) => ({
      get: async (id: string) => { const k = `${name}/${id}`; return docs.has(k) ? { document: docs.get(k) as T } : null; },
      put: async (id: string, d: T) => { docs.set(`${name}/${id}`, d); return d; },
    }),
    owox: {
      storages: { list: () => slow(() => f.storages) },
      models: { getEdges: (sid) => slow(() => f.edges.filter((e) => byId.get(e.sourceDataMartId)?.storageId === sid)) },
      dataMarts: {
        list: () => slow(() => f.marts.filter((m) => m.accessible).map((m) => ({
          id: m.id, title: m.title, description: m.description, availableForReporting: true,
          contexts: m.contexts.map((cid) => { const c = f.contexts.find((x) => x.id === cid)!; return { id: c.id, name: c.name, icon: c.icon ?? null }; }),
        }))),
        traverseData: async (id, o) => {
          const rows = await slow(() => traverse(id, o));
          return {
            async *rowChunks() { for (let i = 0; i < rows.length; i += 100) { if (latency) await wait(latency / 4); yield rows.slice(i, i + 100); } },
            cancel: async () => {},
          };
        },
      },
      getJson: <T,>(path: string, query?: Record<string, string>) => slow(() => {
        if (path === '/api/contexts') return f.contexts as T;
        if (path === '/api/model-canvas/data-marts') {
          const items = f.marts.filter((m) => m.storageId === query?.storageId).map((m) => ({
            id: m.id, title: m.title, description: m.description, icon: m.icon, fieldCount: m.fields.length,
            dataLastUpdated: m.dataLastUpdatedAt ? { dataLastUpdatedAt: m.dataLastUpdatedAt, computedAt: m.dataLastUpdatedAt } : null,
          }));
          return { items, total: items.length, nextOffset: null } as T;
        }
        const detail = /^\/api\/data-marts\/([^/]+)$/.exec(path);
        if (detail) {
          const m = byId.get(decodeURIComponent(detail[1]!));
          if (!m) throw new Error('Not found');
          return { id: m.id, schema: { fields: m.fields } } as T;
        }
        throw new Error(`Mock: unhandled GET ${path}`);
      }),
      postJson: <T,>(path: string, body: unknown) => slow(() => {
        if (path !== '/api/data-marts/data-quality/summaries') throw new Error(`Mock: unhandled POST ${path}`);
        const ids = (body as { dataMartIds: string[] }).dataMartIds;
        return { items: ids.flatMap((id) => { const dq = byId.get(id)?.dq; return dq ? [{ dataMartId: id, summary: dq }] : []; }) } as T;
      }),
    },
  };
}
```

Run: `npx vitest run src/sdk` → PASS.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat: add mock OWOX context with demo fixtures"
```

---

### Task 4: Graph logic

**Files:**
- Create: `src/graph/visible.ts`, `src/graph/search.ts`, `src/graph/layout.ts`
- Test: `src/graph/visible.test.ts`, `src/graph/search.test.ts`, `src/graph/layout.test.ts`

**Interfaces:**
- Consumes: `Edge`, `Mart`, `Model`, `Schema`, `Context` from `src/model/types.ts`; `VISIBLE_BUDGET` from `src/config.ts`.
- Produces:
  - `inboundCounts(edges: Edge[]): Map<string, number>`
  - `pickFocus(ids: Iterable<string>, marts: Map<string, Mart>, inbound: Map<string, number>): string | null`
  - `expandLevels(focus: string, edges: Edge[], budget: number): string[]`
  - `neighbours(id: string, edges: Edge[]): string[]`
  - `type VisibleInput = { model: Model; selectedId: string | null; search: string; contextIds: string[]; schemas: (id: string) => Schema | undefined }`
  - `type VisibleResult = { ids: string[]; focusId: string | null; hiddenMatches: number; fieldHits: Map<string, string>; mode: 'levels' | 'selected' | 'filtered' | 'empty' }`
  - `computeVisible(input: VisibleInput): VisibleResult`
  - `matchesSearch(mart: Mart, query: string, contexts: Context[], schema: Schema | undefined): { hit: boolean; field?: string }`
  - `matchesContexts(mart: Mart, contextIds: string[]): boolean`
  - `type Positioned = { id: string; x: number; y: number }`
  - `layoutNodes(ids: string[], edges: Edge[], direction: 'LR' | 'TB', size: { width: number; height: number }): Positioned[]`

- [ ] **Step 1: Failing tests** `src/graph/visible.test.ts`

```ts
import { computeVisible, expandLevels, inboundCounts, neighbours, pickFocus } from './visible';
import type { Edge, Mart, Model } from '../model/types';

const e = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target, joins: [] });
const mart = (id: string, extra: Partial<Mart> = {}): Mart => ({ id, title: id, description: null, icon: null, storageId: 's', contextIds: [], dataLastUpdatedAt: null, accessible: true, ...extra });
const modelOf = (ids: string[], edges: Edge[]): Model => ({ marts: new Map(ids.map((i) => [i, mart(i)])), edges, contexts: [] });

test('inboundCounts counts targets', () => {
  expect(inboundCounts([e('a', 'b'), e('c', 'b'), e('b', 'd')])).toEqual(new Map([['b', 2], ['d', 1]]));
});

test('pickFocus picks the most inbound, ties by title', () => {
  const marts = new Map([['x', mart('x', { title: 'Zeta' })], ['y', mart('y', { title: 'Alpha' })]]);
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 1], ['y', 1]]))).toBe('y');
  expect(pickFocus(['x', 'y'], marts, new Map([['x', 2]]))).toBe('x');
  expect(pickFocus([], marts, new Map())).toBeNull();
});

test('expandLevels adds whole levels while the total stays within budget', () => {
  // f has 3 neighbours (level 1); each has 2 more (level 2 = 6) → 1+3+6 = 10 ≤ 12; level 3 has 5 → 15 > 12
  const edges = [e('a', 'f'), e('b', 'f'), e('f', 'c'),
    e('a1', 'a'), e('a2', 'a'), e('b1', 'b'), e('b2', 'b'), e('c', 'c1'), e('c', 'c2'),
    e('x1', 'a1'), e('x2', 'a1'), e('x3', 'b1'), e('x4', 'c1'), e('x5', 'c2')];
  const ids = expandLevels('f', edges, 12);
  expect(new Set(ids)).toEqual(new Set(['f', 'a', 'b', 'c', 'a1', 'a2', 'b1', 'b2', 'c1', 'c2']));
});

test('expandLevels always shows level 1 in full, even past the budget', () => {
  const edges = Array.from({ length: 15 }, (_, i) => e(`n${i}`, 'hub'));
  expect(expandLevels('hub', edges, 12)).toHaveLength(16);
});

test('expandLevels on an isolated mart returns just the mart', () => {
  expect(expandLevels('solo', [], 12)).toEqual(['solo']);
});

test('neighbours returns inbound and outbound, without duplicates', () => {
  expect(new Set(neighbours('b', [e('a', 'b'), e('b', 'c'), e('a', 'b')]))).toEqual(new Set(['a', 'c']));
});

test('computeVisible: no selection, no filters → levels from the focus', () => {
  const r = computeVisible({ model: modelOf(['a', 'b', 'c', 'z'], [e('a', 'b'), e('c', 'b')]), selectedId: null, search: '', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('levels');
  expect(r.focusId).toBe('b');
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c']));
});

test('computeVisible: selection shows the selected mart and all direct neighbours, no cap', () => {
  const edges = Array.from({ length: 20 }, (_, i) => e(`n${i}`, 'hub'));
  const ids = ['hub', ...edges.map((x) => x.source)];
  const r = computeVisible({ model: modelOf(ids, edges), selectedId: 'n3', search: '', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('selected');
  expect(new Set(r.ids)).toEqual(new Set(['n3', 'hub']));
});

test('computeVisible: search narrows to matches capped at 12 by inbound count', () => {
  const ids = Array.from({ length: 15 }, (_, i) => `sales${i}`);
  const edges = [e('sales1', 'sales0'), e('sales2', 'sales0')];
  const r = computeVisible({ model: modelOf([...ids, 'other'], edges), selectedId: null, search: 'SALES', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('filtered');
  expect(r.ids).toHaveLength(12);
  expect(r.ids[0]).toBe('sales0');
  expect(r.hiddenMatches).toBe(3);
});

test('computeVisible: a search with no matches is empty, not the default view', () => {
  const r = computeVisible({ model: modelOf(['a', 'b'], [e('a', 'b')]), selectedId: null, search: 'nope', contextIds: [], schemas: () => undefined });
  expect(r).toMatchObject({ mode: 'empty', ids: [], hiddenMatches: 0 });
});

test('computeVisible: selection wins over filters', () => {
  const r = computeVisible({ model: modelOf(['a', 'b'], [e('a', 'b')]), selectedId: 'a', search: 'zzz', contextIds: [], schemas: () => undefined });
  expect(r.mode).toBe('selected');
  expect(new Set(r.ids)).toEqual(new Set(['a', 'b']));
});
```

`src/graph/search.test.ts`:
```ts
import { matchesContexts, matchesSearch } from './search';
import type { Mart, Schema } from '../model/types';

const m: Mart = { id: 'o', title: 'Orders', description: null, icon: null, storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: null, accessible: true };
const contexts = [{ id: 'c1', name: 'Sales', icon: null }];
const schema: Schema = [{ name: 'customer_id', alias: 'Customer', type: 'INT64', category: 'number', description: null, isPrimaryKey: false }];

test.each([
  ['ord', true, undefined],
  ['sales', true, undefined],
  ['customer_', true, 'customer_id'],
  ['CUSTOMER', true, 'customer_id'],
  ['refund', false, undefined],
  ['  ', true, undefined],
])('"%s" → %s', (q, hit, field) => {
  expect(matchesSearch(m, q, contexts, schema)).toEqual(field ? { hit, field } : { hit });
});

test('a field query does not match while the schema is unknown', () => {
  expect(matchesSearch(m, 'customer_', contexts, undefined)).toEqual({ hit: false });
});

test('matchesContexts: any selected context matches; none selected matches all', () => {
  expect(matchesContexts(m, [])).toBe(true);
  expect(matchesContexts(m, ['c9', 'c1'])).toBe(true);
  expect(matchesContexts(m, ['c9'])).toBe(false);
});
```

`src/graph/layout.test.ts`:
```ts
import { layoutNodes } from './layout';

const edges = [{ id: '1', source: 'a', target: 'b', joins: [] }];

test('LR puts the target to the right; TB puts it below', () => {
  const lr = layoutNodes(['a', 'b'], edges, 'LR', { width: 260, height: 120 });
  const tb = layoutNodes(['a', 'b'], edges, 'TB', { width: 260, height: 120 });
  const at = (p: typeof lr, id: string) => p.find((n) => n.id === id)!;
  expect(at(lr, 'b').x).toBeGreaterThan(at(lr, 'a').x);
  expect(at(tb, 'b').y).toBeGreaterThan(at(tb, 'a').y);
});

test('edges to hidden nodes are ignored', () => {
  expect(layoutNodes(['a'], edges, 'LR', { width: 260, height: 120 })).toHaveLength(1);
});
```

Run: `npx vitest run src/graph` → FAIL.

- [ ] **Step 2: Implement** `src/graph/search.ts`

```ts
import type { Context, Mart, Schema } from '../model/types';

export function matchesSearch(mart: Mart, query: string, contexts: Context[], schema: Schema | undefined): { hit: boolean; field?: string } {
  const q = query.trim().toLowerCase();
  if (!q) return { hit: true };
  if (mart.title.toLowerCase().includes(q)) return { hit: true };
  const names = contexts.filter((c) => mart.contextIds.includes(c.id)).map((c) => c.name.toLowerCase());
  if (names.some((n) => n.includes(q))) return { hit: true };
  const f = schema?.find((x) => x.name.toLowerCase().includes(q) || (x.alias ?? '').toLowerCase().includes(q));
  return f ? { hit: true, field: f.name } : { hit: false };
}

export function matchesContexts(mart: Mart, contextIds: string[]): boolean {
  return contextIds.length === 0 || mart.contextIds.some((c) => contextIds.includes(c));
}
```

- [ ] **Step 3: Implement** `src/graph/visible.ts`

```ts
import { VISIBLE_BUDGET } from '../config';
import type { Edge, Mart, Model, Schema } from '../model/types';
import { matchesContexts, matchesSearch } from './search';

export function inboundCounts(edges: Edge[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of edges) m.set(e.target, (m.get(e.target) ?? 0) + 1);
  return m;
}

function rank(marts: Map<string, Mart>, inbound: Map<string, number>) {
  return (a: string, b: string) =>
    (inbound.get(b) ?? 0) - (inbound.get(a) ?? 0) ||
    (marts.get(a)?.title ?? a).localeCompare(marts.get(b)?.title ?? b);
}

export function pickFocus(ids: Iterable<string>, marts: Map<string, Mart>, inbound: Map<string, number>): string | null {
  return [...ids].sort(rank(marts, inbound))[0] ?? null;
}

export function neighbours(id: string, edges: Edge[]): string[] {
  const out = new Set<string>();
  for (const e of edges) {
    if (e.source === id && e.target !== id) out.add(e.target);
    if (e.target === id && e.source !== id) out.add(e.source);
  }
  return [...out];
}

export function expandLevels(focus: string, edges: Edge[], budget: number): string[] {
  const seen = new Set([focus]);
  let frontier = [focus];
  let level = 0;
  while (frontier.length) {
    const next = new Set<string>();
    for (const id of frontier) for (const n of neighbours(id, edges)) if (!seen.has(n)) next.add(n);
    if (next.size === 0) break;
    level++;
    if (level > 1 && seen.size + next.size > budget) break;
    next.forEach((n) => seen.add(n));
    frontier = [...next];
  }
  return [...seen];
}

export type VisibleInput = { model: Model; selectedId: string | null; search: string; contextIds: string[]; schemas: (id: string) => Schema | undefined };
export type VisibleResult = { ids: string[]; focusId: string | null; hiddenMatches: number; fieldHits: Map<string, string>; mode: 'levels' | 'selected' | 'filtered' | 'empty' };

export function computeVisible({ model, selectedId, search, contextIds, schemas }: VisibleInput): VisibleResult {
  const inbound = inboundCounts(model.edges);
  const fieldHits = new Map<string, string>();

  if (selectedId && model.marts.has(selectedId)) {
    return { ids: [selectedId, ...neighbours(selectedId, model.edges)], focusId: selectedId, hiddenMatches: 0, fieldHits, mode: 'selected' };
  }

  if (search.trim() || contextIds.length) {
    const matches: string[] = [];
    for (const mart of model.marts.values()) {
      if (!matchesContexts(mart, contextIds)) continue;
      const r = matchesSearch(mart, search, model.contexts, schemas(mart.id));
      if (!r.hit) continue;
      matches.push(mart.id);
      if (r.field) fieldHits.set(mart.id, r.field);
    }
    matches.sort(rank(model.marts, inbound));
    if (matches.length === 0) return { ids: [], focusId: null, hiddenMatches: 0, fieldHits, mode: 'empty' };
    const ids = matches.slice(0, VISIBLE_BUDGET);
    return { ids, focusId: ids[0]!, hiddenMatches: matches.length - ids.length, fieldHits, mode: 'filtered' };
  }

  const focusId = pickFocus(model.marts.keys(), model.marts, inbound);
  if (!focusId) return { ids: [], focusId: null, hiddenMatches: 0, fieldHits, mode: 'empty' };
  return { ids: expandLevels(focusId, model.edges, VISIBLE_BUDGET), focusId, hiddenMatches: 0, fieldHits, mode: 'levels' };
}
```

- [ ] **Step 4: Implement** `src/graph/layout.ts`

```ts
import dagre from '@dagrejs/dagre';
import type { Edge } from '../model/types';

export type Positioned = { id: string; x: number; y: number };

export function layoutNodes(ids: string[], edges: Edge[], direction: 'LR' | 'TB', size: { width: number; height: number }): Positioned[] {
  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 90, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const set = new Set(ids);
  ids.forEach((id) => g.setNode(id, { ...size }));
  edges.filter((e) => set.has(e.source) && set.has(e.target)).forEach((e) => g.setEdge(e.source, e.target));
  dagre.layout(g);
  return ids.map((id) => {
    const n = g.node(id);
    return { id, x: n.x - size.width / 2, y: n.y - size.height / 2 };
  });
}
```

Run: `npx vitest run src/graph && npx tsc -b` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add visible-set, search and layout logic for the canvas"
```

---

### Task 5: Filter catalogue and builder

**Files:**
- Create: `src/filters/catalogue.ts`, `src/filters/build.ts`
- Test: `src/filters/catalogue.test.ts`, `src/filters/build.test.ts`

**Interfaces:**
- Consumes: `FieldCategory`, `Field` from `src/model/types.ts`; `TraverseFilter`, `RelativeDatePreset` from `src/sdk/types.ts`.
- Produces:
  - `type OpId = 'contains' | 'not_contains' | 'eq' | 'neq' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'on' | 'before' | 'after' | 'relative' | 'is_true' | 'is_false' | 'is_blank' | 'is_not_blank'`
  - `type ValueKind = 'none' | 'text' | 'number' | 'date' | 'number-range' | 'date-range' | 'relative'`
  - `type OpDef = { id: OpId; label: string; value: ValueKind }`
  - `operatorsFor(field: Field): OpDef[]`
  - `RELATIVE_PRESETS: { kind: RelativeDatePreset['kind']; label: string; needsN: boolean }[]`
  - `type FilterValue = string | number | { from: string | number; to: string | number } | RelativeDatePreset | undefined`
  - `type ColumnFilter = { field: string; op: OpId; value?: FilterValue }`
  - `isComplete(f: ColumnFilter, field: Field): boolean`
  - `toTraverseFilter(f: ColumnFilter, field: Field): TraverseFilter`

- [ ] **Step 1: Failing tests**

`src/filters/catalogue.test.ts`:
```ts
import { operatorsFor } from './catalogue';
import type { Field } from '../model/types';

const f = (type: string, category: Field['category']): Field => ({ name: 'x', alias: null, type, category, description: null, isPrimaryKey: false });
const ids = (field: Field) => operatorsFor(field).map((o) => o.id);

test('string operators', () => {
  expect(ids(f('STRING', 'string'))).toEqual(['contains', 'not_contains', 'eq', 'neq', 'starts_with', 'ends_with', 'is_blank', 'is_not_blank']);
});
test('number operators', () => {
  expect(ids(f('INT64', 'number'))).toEqual(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_blank', 'is_not_blank']);
});
test('DATE offers "on"; TIMESTAMP does not', () => {
  expect(ids(f('DATE', 'date'))).toEqual(['on', 'before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
  expect(ids(f('TIMESTAMP', 'date'))).toEqual(['before', 'after', 'between', 'relative', 'is_blank', 'is_not_blank']);
});
test('time, boolean and other', () => {
  expect(ids(f('TIME', 'time'))).toEqual(['before', 'after', 'between', 'is_blank', 'is_not_blank']);
  expect(ids(f('BOOL', 'boolean'))).toEqual(['is_true', 'is_false', 'is_blank']);
  expect(ids(f('JSON', 'other'))).toEqual(['is_blank', 'is_not_blank']);
});
```

`src/filters/build.test.ts`:
```ts
import { isComplete, toTraverseFilter } from './build';
import type { Field } from '../model/types';

const num: Field = { name: 'amount', alias: null, type: 'NUMERIC', category: 'number', description: null, isPrimaryKey: false };
const str: Field = { ...num, name: 'status', type: 'STRING', category: 'string' };
const date: Field = { ...num, name: 'day', type: 'DATE', category: 'date' };
const ts: Field = { ...num, name: 'created_at', type: 'TIMESTAMP', category: 'date' };

test.each([
  [str, { field: 'status', op: 'contains', value: 'paid' }, { column: 'status', operator: 'contains', value: 'paid' }],
  [num, { field: 'amount', op: 'gte', value: '10' }, { column: 'amount', operator: 'gte', value: 10 }],
  [num, { field: 'amount', op: 'between', value: { from: '1', to: '5' } }, { column: 'amount', operator: 'between', value: { from: 1, to: 5 } }],
  [date, { field: 'day', op: 'on', value: '2026-11-01' }, { column: 'day', operator: 'eq', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'before', value: '2026-11-01' }, { column: 'created_at', operator: 'lt', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'after', value: '2026-11-01' }, { column: 'created_at', operator: 'gt', value: '2026-11-01' }],
  [ts, { field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } }, { column: 'created_at', operator: 'relative_date', value: { kind: 'last_n_days', n: 7 } }],
  [str, { field: 'status', op: 'is_blank' }, { column: 'status', operator: 'is_blank' }],
] as const)('%#', (field, filter, expected) => {
  expect(toTraverseFilter(filter as never, field)).toEqual(expected);
});

test('isComplete rejects missing or non-numeric values', () => {
  expect(isComplete({ field: 'amount', op: 'gt', value: '' }, num)).toBe(false);
  expect(isComplete({ field: 'amount', op: 'gt', value: 'abc' }, num)).toBe(false);
  expect(isComplete({ field: 'amount', op: 'between', value: { from: '1', to: '' } }, num)).toBe(false);
  expect(isComplete({ field: 'status', op: 'is_blank' }, str)).toBe(true);
  expect(isComplete({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 0 } }, ts)).toBe(false);
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `src/filters/catalogue.ts`

```ts
import type { Field } from '../model/types';
import type { RelativeDatePreset } from '../sdk/types';

export type OpId = 'contains' | 'not_contains' | 'eq' | 'neq' | 'starts_with' | 'ends_with' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'on' | 'before' | 'after' | 'relative' | 'is_true' | 'is_false' | 'is_blank' | 'is_not_blank';
export type ValueKind = 'none' | 'text' | 'number' | 'date' | 'number-range' | 'date-range' | 'relative';
export type OpDef = { id: OpId; label: string; value: ValueKind };

const blank: OpDef[] = [
  { id: 'is_blank', label: 'is blank', value: 'none' },
  { id: 'is_not_blank', label: 'is not blank', value: 'none' },
];

const STRING: OpDef[] = [
  { id: 'contains', label: 'contains', value: 'text' },
  { id: 'not_contains', label: 'does not contain', value: 'text' },
  { id: 'eq', label: 'equals', value: 'text' },
  { id: 'neq', label: 'does not equal', value: 'text' },
  { id: 'starts_with', label: 'starts with', value: 'text' },
  { id: 'ends_with', label: 'ends with', value: 'text' },
  ...blank,
];
const NUMBER: OpDef[] = [
  { id: 'eq', label: '=', value: 'number' },
  { id: 'neq', label: '≠', value: 'number' },
  { id: 'gt', label: '>', value: 'number' },
  { id: 'gte', label: '≥', value: 'number' },
  { id: 'lt', label: '<', value: 'number' },
  { id: 'lte', label: '≤', value: 'number' },
  { id: 'between', label: 'between', value: 'number-range' },
  ...blank,
];
const dateOps = (withOn: boolean, withRelative: boolean): OpDef[] => [
  ...(withOn ? [{ id: 'on', label: 'on', value: 'date' } as OpDef] : []),
  { id: 'before', label: 'before', value: 'date' },
  { id: 'after', label: 'after', value: 'date' },
  { id: 'between', label: 'between', value: 'date-range' },
  ...(withRelative ? [{ id: 'relative', label: 'relative', value: 'relative' } as OpDef] : []),
  ...blank,
];

export function operatorsFor(field: Field): OpDef[] {
  switch (field.category) {
    case 'string': return STRING;
    case 'number': return NUMBER;
    case 'date': return dateOps(field.type.trim().toUpperCase() === 'DATE', true);
    case 'time': return dateOps(false, false);
    case 'boolean': return [
      { id: 'is_true', label: 'is true', value: 'none' },
      { id: 'is_false', label: 'is false', value: 'none' },
      { id: 'is_blank', label: 'is blank', value: 'none' },
    ];
    default: return blank;
  }
}

export const RELATIVE_PRESETS: { kind: RelativeDatePreset['kind']; label: string; needsN: boolean }[] = [
  { kind: 'today', label: 'Today', needsN: false },
  { kind: 'yesterday', label: 'Yesterday', needsN: false },
  { kind: 'this_week', label: 'This week', needsN: false },
  { kind: 'last_week', label: 'Last week', needsN: false },
  { kind: 'this_month', label: 'This month', needsN: false },
  { kind: 'last_month', label: 'Last month', needsN: false },
  { kind: 'this_quarter', label: 'This quarter', needsN: false },
  { kind: 'last_quarter', label: 'Last quarter', needsN: false },
  { kind: 'this_year', label: 'This year', needsN: false },
  { kind: 'last_n_days', label: 'Last N days', needsN: true },
  { kind: 'last_n_months', label: 'Last N months', needsN: true },
];
```

- [ ] **Step 3: Implement** `src/filters/build.ts`

```ts
import type { Field } from '../model/types';
import type { RelativeDatePreset, TraverseFilter } from '../sdk/types';
import { operatorsFor, type OpId } from './catalogue';

export type FilterValue = string | number | { from: string | number; to: string | number } | RelativeDatePreset | undefined;
export type ColumnFilter = { field: string; op: OpId; value?: FilterValue };

const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== '';
const numeric = (v: unknown) => filled(v) && Number.isFinite(Number(v));

export function isComplete(f: ColumnFilter, field: Field): boolean {
  const def = operatorsFor(field).find((o) => o.id === f.op);
  if (!def) return false;
  const v = f.value as never;
  switch (def.value) {
    case 'none': return true;
    case 'text':
    case 'date': return filled(v);
    case 'number': return numeric(v);
    case 'number-range': return typeof v === 'object' && numeric((v as { from: unknown }).from) && numeric((v as { to: unknown }).to);
    case 'date-range': return typeof v === 'object' && filled((v as { from: unknown }).from) && filled((v as { to: unknown }).to);
    case 'relative': {
      const p = v as RelativeDatePreset | undefined;
      if (!p || typeof p !== 'object' || !('kind' in p)) return false;
      return 'n' in p ? Number.isInteger(p.n) && p.n > 0 : true;
    }
  }
}

export function toTraverseFilter(f: ColumnFilter, field: Field): TraverseFilter {
  const column = field.name;
  const isNum = field.category === 'number';
  const scalar = (v: FilterValue) => (isNum ? Number(v) : String(v));
  switch (f.op) {
    case 'is_blank': case 'is_not_blank': case 'is_true': case 'is_false':
      return { column, operator: f.op };
    case 'on': return { column, operator: 'eq', value: String(f.value) };
    case 'before': return { column, operator: 'lt', value: String(f.value) };
    case 'after': return { column, operator: 'gt', value: String(f.value) };
    case 'relative': return { column, operator: 'relative_date', value: f.value as RelativeDatePreset };
    case 'between': {
      const r = f.value as { from: string | number; to: string | number };
      return isNum
        ? { column, operator: 'between', value: { from: Number(r.from), to: Number(r.to) } }
        : { column, operator: 'between', value: { from: String(r.from), to: String(r.to) } };
    }
    default:
      return { column, operator: f.op, value: scalar(f.value) } as TraverseFilter;
  }
}
```

Run: `npx vitest run src/filters && npx tsc -b` → PASS.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat: add per-type column filter catalogue and traverseData builder"
```

---

### Task 6: Records: keys, relationship columns, titles

**Files:**
- Create: `src/records/title-field.ts`, `src/records/relationships.ts`, `src/records/titles.ts`
- Test: `src/records/title-field.test.ts`, `src/records/relationships.test.ts`, `src/records/titles.test.ts`

**Interfaces:**
- Consumes: `Field`, `Schema`, `Edge` from `src/model/types.ts`; `Ctx`, `Row` from `src/sdk/types.ts`; `readRows` from `src/api/rows.ts`; `IN_LIST_MAX` from `src/config.ts`; `ColumnFilter` from `src/filters/build.ts`.
- Produces:
  - `pickTitleField(schema: Schema): string | null`
  - `primaryKeys(schema: Schema): string[]`
  - `type RelColumn = { field: string; edgeId: string; relatedMartId: string; relatedField: string; composite: boolean; joins: { sourceField: string; targetField: string }[] }`
  - `relationshipColumns(martId: string, edges: Edge[]): Map<string, RelColumn>`
  - `type ClickTarget = { kind: 'record'; martId: string; pk: Record<string, unknown> } | { kind: 'mart'; martId: string; filters: ColumnFilter[] }`
  - `clickTarget(rel: RelColumn, row: Row, relatedSchema: Schema): ClickTarget | null`
  - `lookupTitles(ctx: Ctx, rel: RelColumn, values: unknown[], relatedSchema: Schema, signal?: AbortSignal): Promise<Map<string, string>>` (key is `String(value)`)
  - `recordTabId(martId: string, pk: Record<string, unknown>): string`

- [ ] **Step 1: Failing tests**

`src/records/title-field.test.ts`:
```ts
import { pickTitleField } from './title-field';
import { primaryKeys } from './relationships';
import type { Field, Schema } from '../model/types';

const f = (name: string, type = 'STRING', extra: Partial<Field> = {}): Field => ({ name, alias: null, type, category: type === 'STRING' ? 'string' : 'number', description: null, isPrimaryKey: false, ...extra });

test.each<[string, Schema, string | null]>([
  ['exact name', [f('id', 'INT64', { isPrimaryKey: true }), f('code'), f('name')], 'name'],
  ['exact alias', [f('id', 'INT64', { isPrimaryKey: true }), f('label', 'STRING', { alias: 'Name' })], 'label'],
  ['exact beats contains', [f('product_title'), f('title')], 'title'],
  ['contains', [f('id', 'INT64', { isPrimaryKey: true }), f('full_name')], 'full_name'],
  ['first non-key string', [f('code', 'STRING', { isPrimaryKey: true }), f('status')], 'status'],
  ['no title', [f('id', 'INT64', { isPrimaryKey: true }), f('amount', 'NUMERIC')], null],
  ['a key named name is still allowed by name', [f('name', 'STRING', { isPrimaryKey: true })], 'name'],
])('%s', (_, schema, expected) => {
  expect(pickTitleField(schema)).toBe(expected);
});

test('primaryKeys returns key fields in schema order', () => {
  expect(primaryKeys([f('a', 'INT64', { isPrimaryKey: true }), f('b'), f('c', 'INT64', { isPrimaryKey: true })])).toEqual(['a', 'c']);
  expect(primaryKeys([f('b')])).toEqual([]);
});
```

`src/records/relationships.test.ts`:
```ts
import { clickTarget, recordTabId, relationshipColumns } from './relationships';
import type { Edge, Field } from '../model/types';

const edges: Edge[] = [
  { id: 'e1', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] },
  { id: 'e2', source: 'items', target: 'orders', joins: [{ sourceField: 'order_id', targetField: 'id' }] },
  { id: 'e3', source: 'orders', target: 'fx', joins: [{ sourceField: 'currency', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] },
];
const pk = (name: string): Field => ({ name, alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true });

test('only outgoing edges make relationship columns', () => {
  const cols = relationshipColumns('orders', edges);
  expect([...cols.keys()].sort()).toEqual(['currency', 'customer_id', 'day']);
  expect(cols.get('customer_id')).toMatchObject({ relatedMartId: 'customers', relatedField: 'id', composite: false });
  expect(cols.get('currency')!.composite).toBe(true);
});

test('click opens a record when the related field is the only primary key', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: 7 }, [pk('id')])).toEqual({ kind: 'record', martId: 'customers', pk: { id: 7 } });
});

test('click opens a filtered mart tab otherwise', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: 7 }, [pk('other')])).toEqual({ kind: 'mart', martId: 'customers', filters: [{ field: 'id', op: 'eq', value: 7 }] });
});

test('composite relationships filter on every join', () => {
  const rel = relationshipColumns('orders', edges).get('currency')!;
  expect(clickTarget(rel, { currency: 'EUR', day: '2026-11-01' }, [])).toEqual({
    kind: 'mart', martId: 'fx',
    filters: [{ field: 'code', op: 'eq', value: 'EUR' }, { field: 'day', op: 'eq', value: '2026-11-01' }],
  });
});

test('a DATE join field in the related schema filters with "on"', () => {
  const rel = relationshipColumns('orders', edges).get('currency')!;
  const fxSchema: Field[] = [{ name: 'day', alias: null, type: 'DATE', category: 'date', description: null, isPrimaryKey: false }];
  expect(clickTarget(rel, { currency: 'EUR', day: '2026-11-01' }, fxSchema)).toMatchObject({
    filters: [{ field: 'code', op: 'eq', value: 'EUR' }, { field: 'day', op: 'on', value: '2026-11-01' }],
  });
});

test('a null or blank value is not clickable', () => {
  const rel = relationshipColumns('orders', edges).get('customer_id')!;
  expect(clickTarget(rel, { customer_id: null }, [pk('id')])).toBeNull();
  expect(clickTarget(rel, { customer_id: ' ' }, [pk('id')])).toBeNull();
});

test('recordTabId is stable across key order', () => {
  expect(recordTabId('m', { b: 2, a: 1 })).toBe(recordTabId('m', { a: 1, b: 2 }));
});
```

`clickTarget` uses `op: 'on'` for a join field that `relatedSchema` types as `DATE`, and `op: 'eq'` otherwise.

`src/records/titles.test.ts`:
```ts
import { vi } from 'vitest';
import { lookupTitles } from './titles';
import { relationshipColumns } from './relationships';
import { stubCtx, traversalOf } from '../api/test-ctx';
import type { Field } from '../model/types';

const schema: Field[] = [
  { name: 'id', alias: null, type: 'INT64', category: 'number', description: null, isPrimaryKey: true },
  { name: 'name', alias: null, type: 'STRING', category: 'string', description: null, isPrimaryKey: false },
];
const rel = relationshipColumns('orders', [{ id: 'e', source: 'orders', target: 'customers', joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]).get('customer_id')!;

test('queries distinct non-blank values with in and maps value → title', async () => {
  const traverseData = vi.fn(async () => traversalOf([{ id: 1, name: 'Ann' }, { id: 2, name: 'Bob' }]));
  const res = await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), rel, [1, 2, 2, null, '', 1], schema);
  expect(traverseData).toHaveBeenCalledWith('customers', { column: ['id', 'name'], filter: [{ column: 'id', operator: 'in', value: [1, 2] }], limit: 2 });
  expect(res).toEqual(new Map([['1', 'Ann'], ['2', 'Bob']]));
});

test('splits more than 500 values into batches', async () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const values = Array.from({ length: 1201 }, (_, i) => i + 1);
  await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), rel, values, schema);
  expect(traverseData).toHaveBeenCalledTimes(3);
  expect((traverseData.mock.calls[0]![1] as { filter: { value: number[] }[] }).filter[0]!.value).toHaveLength(500);
});

test('no title field, composite, or no values → no query', async () => {
  const traverseData = vi.fn();
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  expect((await lookupTitles(ctx, rel, [1], [schema[0]!])).size).toBe(0);
  expect((await lookupTitles(ctx, { ...rel, composite: true }, [1], schema)).size).toBe(0);
  expect((await lookupTitles(ctx, rel, [null], schema)).size).toBe(0);
  expect(traverseData).not.toHaveBeenCalled();
});

test('string ids are sent as strings', async () => {
  const traverseData = vi.fn(async () => traversalOf([]));
  const strSchema: Field[] = [{ ...schema[0]!, name: 'code', type: 'STRING', category: 'string' }, schema[1]!];
  const strRel = { ...rel, relatedField: 'code' };
  await lookupTitles(stubCtx({ dataMarts: { list: vi.fn(), traverseData } }), strRel, ['UA', 'PL'], strSchema);
  expect(traverseData.mock.calls[0]![1]).toMatchObject({ filter: [{ column: 'code', operator: 'in', value: ['UA', 'PL'] }] });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `src/records/title-field.ts`

```ts
import type { Schema } from '../model/types';

const label = (s: string | null) => (s ?? '').toLowerCase();
const exact = (s: string | null) => label(s) === 'title' || label(s) === 'name';
const partial = (s: string | null) => label(s).includes('title') || label(s).includes('name');

export function pickTitleField(schema: Schema): string | null {
  const strings = schema.filter((f) => f.category === 'string');
  return (
    strings.find((f) => exact(f.name) || exact(f.alias))?.name ??
    strings.find((f) => partial(f.name) || partial(f.alias))?.name ??
    strings.find((f) => !f.isPrimaryKey)?.name ??
    null
  );
}
```

Note: step 3 of the heuristic says "first string field that is not a key". A key here means a primary key. Foreign key fields are also not useful as titles, but the schema does not mark them, so this plan does not exclude them.

- [ ] **Step 3: Implement** `src/records/relationships.ts`

```ts
import type { ColumnFilter } from '../filters/build';
import type { Edge, Schema } from '../model/types';
import type { Row } from '../sdk/types';

export function primaryKeys(schema: Schema): string[] {
  return schema.filter((f) => f.isPrimaryKey).map((f) => f.name);
}

export type RelColumn = { field: string; edgeId: string; relatedMartId: string; relatedField: string; composite: boolean; joins: { sourceField: string; targetField: string }[] };

export function relationshipColumns(martId: string, edges: Edge[]): Map<string, RelColumn> {
  const out = new Map<string, RelColumn>();
  for (const e of edges) {
    if (e.source !== martId) continue;
    for (const j of e.joins) {
      if (out.has(j.sourceField)) continue;
      out.set(j.sourceField, { field: j.sourceField, edgeId: e.id, relatedMartId: e.target, relatedField: j.targetField, composite: e.joins.length > 1, joins: e.joins });
    }
  }
  return out;
}

export type ClickTarget =
  | { kind: 'record'; martId: string; pk: Record<string, unknown> }
  | { kind: 'mart'; martId: string; filters: ColumnFilter[] };

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

export function clickTarget(rel: RelColumn, row: Row, relatedSchema: Schema): ClickTarget | null {
  if (rel.joins.some((j) => blank(row[j.sourceField]))) return null;
  const pks = primaryKeys(relatedSchema);
  if (!rel.composite && pks.length === 1 && pks[0] === rel.relatedField) {
    return { kind: 'record', martId: rel.relatedMartId, pk: { [rel.relatedField]: row[rel.field] } };
  }
  const isDate = (name: string) => relatedSchema.find((f) => f.name === name)?.type.trim().toUpperCase() === 'DATE';
  return {
    kind: 'mart',
    martId: rel.relatedMartId,
    filters: rel.joins.map((j) => ({ field: j.targetField, op: isDate(j.targetField) ? 'on' : 'eq', value: row[j.sourceField] as string | number })),
  };
}

export function recordTabId(martId: string, pk: Record<string, unknown>): string {
  const keys = Object.keys(pk).sort();
  return `record:${martId}:${JSON.stringify(keys.map((k) => [k, pk[k]]))}`;
}
```

- [ ] **Step 4: Implement** `src/records/titles.ts`

```ts
import { IN_LIST_MAX } from '../config';
import { readRows } from '../api/rows';
import type { Schema } from '../model/types';
import type { Ctx } from '../sdk/types';
import type { RelColumn } from './relationships';
import { pickTitleField } from './title-field';

export async function lookupTitles(ctx: Ctx, rel: RelColumn, values: unknown[], relatedSchema: Schema, signal?: AbortSignal): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const titleField = pickTitleField(relatedSchema);
  if (rel.composite || !titleField || titleField === rel.relatedField) return out;
  const target = relatedSchema.find((f) => f.name === rel.relatedField);
  const isNum = target?.category === 'number';
  const distinct = [...new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => (isNum ? Number(v) : String(v))))];
  for (let i = 0; i < distinct.length; i += IN_LIST_MAX) {
    const batch = distinct.slice(i, i + IN_LIST_MAX);
    const rows = await readRows(ctx, rel.relatedMartId, {
      column: [rel.relatedField, titleField],
      filter: [{ column: rel.relatedField, operator: 'in', value: batch as string[] | number[] }],
      limit: batch.length,
    }, { signal });
    for (const r of rows) {
      const t = r[titleField];
      if (t !== null && t !== undefined && String(t).trim() !== '') out.set(String(r[rel.relatedField]), String(t));
    }
  }
  return out;
}
```

Run: `npx vitest run src/records && npx tsc -b` → PASS.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat: add primary key, relationship column and title lookup logic"
```

---

### Task 7: Icons, card and canvas

**Files:**
- Create: `src/ui/format.ts`, `src/ui/icons.tsx`, `src/ui/Tooltip.tsx`, `src/ui/Popover.tsx`, `src/ui/ErrorBox.tsx`, `src/ui/Skeleton.tsx`, `src/ui/canvas/MartCard.tsx`, `src/ui/canvas/Canvas.tsx`
- Test: `src/ui/format.test.ts`, `src/ui/icons.test.tsx`, `src/ui/canvas/MartCard.test.tsx`

**Interfaces:**
- Consumes: `Mart`, `Context`, `DqSummary`, `Edge` from `src/model/types.ts`; `layoutNodes` from `src/graph/layout.ts`; `martAppUrl` from `src/config.ts`.
- Produces:
  - `compactNumber(n: number): string`, `relativeTime(iso: string, now?: Date): string`
  - `<MartIcon icon={string | null} className? />`, `<ContextIcon icon={string | null} className? />`, `<DqIcon summary={DqSummary | undefined} />`, `<FreshnessIcon at={string | null} />`, `dqVisual(summary): { Icon, label, tone }`
  - `<Tooltip content={ReactNode}>{child}</Tooltip>`, `<Popover trigger={ReactNode} align?>{children}</Popover>`, `<ErrorBox error={unknown} onRetry={() => void} compact? />`, `<Skeleton rows={number} />`
  - `type CardData = { mart: Mart; contexts: Context[]; count: { state: 'loading' } | { state: 'ok'; value: number | null } | { state: 'error'; message: string }; dq?: DqSummary; fieldHit?: string; selected: boolean; onOpenApp: () => void; onRetryCount: () => void }`
  - `<MartCard data={CardData} />` (also registered as xyflow node type `mart`)
  - `CARD_SIZE = { width: 260, height: 132 }`
  - `<Canvas ids={string[]} edges={Edge[]} cards={Map<string, CardData>} direction={'LR' | 'TB'} onSelect={(id: string) => void} onClear={() => void} />`

- [ ] **Step 1: Failing tests**

`src/ui/format.test.ts`:
```ts
import { compactNumber, relativeTime } from './format';

test.each([[0, '0'], [999, '999'], [1200, '1.2K'], [12400, '12.4K'], [3_400_000, '3.4M'], [2_000_000_000, '2B']])('%d → %s', (n, s) => {
  expect(compactNumber(n)).toBe(s);
});

test('relativeTime', () => {
  const now = new Date('2026-11-14T12:00:00Z');
  expect(relativeTime('2026-11-14T10:00:00Z', now)).toBe('2 hours ago');
  expect(relativeTime('2026-11-11T12:00:00Z', now)).toBe('3 days ago');
  expect(relativeTime('2026-11-14T11:59:40Z', now)).toBe('just now');
});
```

`src/ui/icons.test.tsx`:
```tsx
import { dqVisual } from './icons';

test.each([
  [{ state: 'PASSED' }, 'Passed', 'success'],
  [{ state: 'ISSUES', warningFindings: 2 }, 'Issues found', 'warning'],
  [{ state: 'ISSUES', errorFindings: 1 }, 'Issues found', 'error'],
  [{ state: 'EXECUTION_FAILED' }, 'Run failed', 'error'],
  [{ state: 'NEVER_RUN' }, 'Never run', 'neutral'],
  [undefined, 'No data quality info', 'neutral'],
])('%o → %s', (s, label, tone) => {
  expect(dqVisual(s as never)).toMatchObject({ label, tone });
});
```

`src/ui/canvas/MartCard.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MartCardView } from './MartCard';
import type { CardData } from './MartCard';

const base: CardData = {
  mart: { id: 'o', title: 'Orders', description: 'All orders', icon: 'orders', storageId: 's', contextIds: ['c1'], dataLastUpdatedAt: '2026-11-14T10:00:00Z', accessible: true },
  contexts: [{ id: 'c1', name: 'Sales', icon: 'revenue' }],
  count: { state: 'ok', value: 12400 },
  dq: { state: 'PASSED' },
  selected: false,
  onOpenApp: vi.fn(),
  onRetryCount: vi.fn(),
};

test('shows title, count badge, context chip, DQ and freshness labels', () => {
  render(<MartCardView data={base} />);
  expect(screen.getByText('Orders')).toBeInTheDocument();
  expect(screen.getByText('12.4K')).toBeInTheDocument();
  expect(screen.getByText('Sales')).toBeInTheDocument();
  expect(screen.getByLabelText('Data quality: Passed')).toBeInTheDocument();
  expect(screen.getByLabelText(/Data updated/)).toBeInTheDocument();
  expect(screen.getByLabelText('Description')).toBeInTheDocument();
});

test('the app link calls onOpenApp and does not bubble to the card', async () => {
  const onCardClick = vi.fn();
  render(<div onClick={onCardClick}><MartCardView data={base} /></div>);
  await userEvent.click(screen.getByLabelText('Open in OWOX'));
  expect(base.onOpenApp).toHaveBeenCalled();
  expect(onCardClick).not.toHaveBeenCalled();
});

test('no description, no (i); loading count shows a spinner; error shows a dash', () => {
  const { rerender } = render(<MartCardView data={{ ...base, mart: { ...base.mart, description: null }, count: { state: 'loading' } }} />);
  expect(screen.queryByLabelText('Description')).toBeNull();
  expect(screen.getByLabelText('Counting rows')).toBeInTheDocument();
  rerender(<MartCardView data={{ ...base, count: { state: 'error', message: 'nope' } }} />);
  expect(screen.getByText('—')).toBeInTheDocument();
});

test('an inaccessible mart renders muted with a no-access label', () => {
  render(<MartCardView data={{ ...base, mart: { ...base.mart, accessible: false } }} />);
  expect(screen.getByText('No access')).toBeInTheDocument();
});

test('a field hit is shown', () => {
  render(<MartCardView data={{ ...base, fieldHit: 'customer_id' }} />);
  expect(screen.getByText('customer_id')).toBeInTheDocument();
});
```

Run → FAIL.

- [ ] **Step 2: Implement `src/ui/format.ts`**

```ts
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  const fmt = (v: number, s: string) => `${Number(v.toFixed(1)).toString()}${s}`;
  if (abs >= 1e9) return fmt(n / 1e9, 'B');
  if (abs >= 1e6) return fmt(n / 1e6, 'M');
  if (abs >= 1e3) return fmt(n / 1e3, 'K');
  return String(n);
}

export function relativeTime(iso: string, now = new Date()): string {
  const s = Math.round((now.getTime() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  const units: [number, string][] = [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3_600, 'hour'], [60, 'minute']];
  for (const [sec, name] of units) {
    const v = Math.floor(s / sec);
    if (v >= 1) return `${v} ${name}${v > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}
```

- [ ] **Step 3: Implement `src/ui/icons.tsx`**

1. Copy the key-to-icon table from `tmp/ref/apps_web_src_features_data-marts_shared_components_DataMartIcon_data-mart-icons.ts` (`DATA_MART_ICON_OPTIONS`) into a `const KEYED: Record<string, LucideIcon>`, keeping the lucide imports it uses.
2. `lucide:<name>` values: convert kebab-case to PascalCase and look the name up in `import { icons } from 'lucide-react'`. If it isn't found, use the default.

```tsx
import { Box, History, LoaderCircle, RefreshCw, Shield, ShieldAlert, ShieldBan, ShieldCheck, ShieldMinus, ShieldOff, ShieldX, Tags, icons, type LucideIcon } from 'lucide-react';
import type { DqSummary } from '../model/types';
import { relativeTime } from './format';
import { Tooltip } from './Tooltip';

const KEYED: Record<string, LucideIcon> = { /* copied from DATA_MART_ICON_OPTIONS: key → icon */ };

const pascal = (s: string) => s.replace(/(^|-)([a-z0-9])/g, (_, __, c: string) => c.toUpperCase());

export function resolveIcon(value: string | null, fallback: LucideIcon): LucideIcon {
  if (!value) return fallback;
  if (value.startsWith('lucide:')) return (icons as Record<string, LucideIcon>)[pascal(value.slice(7))] ?? fallback;
  return KEYED[value] ?? fallback;
}

export function MartIcon({ icon, className = 'size-4' }: { icon: string | null; className?: string }) {
  const I = resolveIcon(icon, Box);
  return <I className={className} aria-hidden />;
}

export function ContextIcon({ icon, className = 'size-3' }: { icon: string | null; className?: string }) {
  const I = resolveIcon(icon, Tags);
  return <I className={className} aria-hidden />;
}

type Tone = 'neutral' | 'progress' | 'success' | 'warning' | 'error' | 'notice';
const TONE: Record<Tone, string> = { neutral: 'text-muted-foreground', progress: 'text-primary', success: 'text-success', warning: 'text-warning', error: 'text-destructive', notice: 'text-notice' };

// Mirrors tmp/ref/apps_web_src_features_data-marts_shared_utils_data-quality-status.ts
export function dqVisual(s: DqSummary | undefined): { Icon: LucideIcon; label: string; tone: Tone } {
  if (!s) return { Icon: Shield, label: 'No data quality info', tone: 'neutral' };
  if (s.state === 'CANCELLED') return { Icon: ShieldBan, label: 'Cancelled', tone: 'neutral' };
  if ((s.totalChecks ?? 0) > 0 && s.notApplicableChecks === s.totalChecks) return { Icon: ShieldMinus, label: 'No applicable checks', tone: 'neutral' };
  switch (s.state) {
    case 'NEVER_RUN': return { Icon: Shield, label: 'Never run', tone: 'neutral' };
    case 'ALL_DISABLED': return { Icon: ShieldOff, label: 'All checks disabled', tone: 'neutral' };
    case 'QUEUED': return { Icon: LoaderCircle, label: 'Queued', tone: 'progress' };
    case 'RUNNING': return { Icon: LoaderCircle, label: 'Running', tone: 'progress' };
    case 'PASSED': return { Icon: ShieldCheck, label: 'Passed', tone: 'success' };
    case 'EXECUTION_FAILED': return { Icon: ShieldX, label: 'Run failed', tone: 'error' };
    case 'RESTRICTED': return { Icon: ShieldBan, label: 'Restricted', tone: 'warning' };
    case 'ISSUES': {
      const tone: Tone = (s.errorFindings ?? 0) > 0 || s.highestSeverity === 'error' ? 'error'
        : (s.warningFindings ?? 0) > 0 || s.highestSeverity === 'warning' ? 'warning'
        : (s.noticeFindings ?? 0) > 0 || s.highestSeverity === 'notice' ? 'notice' : 'warning';
      return { Icon: ShieldAlert, label: 'Issues found', tone };
    }
    default: return { Icon: Shield, label: s.state, tone: 'neutral' };
  }
}

export function DqIcon({ summary }: { summary: DqSummary | undefined }) {
  const { Icon, label, tone } = dqVisual(summary);
  return (
    <Tooltip content={`Data quality: ${label}`}>
      <span aria-label={`Data quality: ${label}`} className={TONE[tone]}><Icon className={`size-3.5 ${tone === 'progress' ? 'animate-spin' : ''}`} /></span>
    </Tooltip>
  );
}

export function FreshnessIcon({ at }: { at: string | null }) {
  const text = at ? `Data updated ${relativeTime(at)}` : 'Data updated: unknown';
  const Icon = at ? History : RefreshCw;
  return (
    <Tooltip content={text}>
      <span aria-label={text} className="text-muted-foreground"><Icon className="size-3.5" /></span>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Implement the small primitives**

`src/ui/Tooltip.tsx`:
```tsx
import * as T from '@radix-ui/react-tooltip';
import type { ReactNode } from 'react';

export function Tooltip({ content, children }: { content: ReactNode; children: ReactNode }) {
  return (
    <T.Provider delayDuration={200}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content sideOffset={4} className="z-50 max-w-xs rounded-md border bg-background px-2 py-1 text-xs text-foreground shadow-md">
            {content}
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
```

`src/ui/Popover.tsx`:
```tsx
import * as P from '@radix-ui/react-popover';
import type { ReactNode } from 'react';

export function Popover({ trigger, children, align = 'start', open, onOpenChange }: { trigger: ReactNode; children: ReactNode; align?: 'start' | 'end'; open?: boolean; onOpenChange?: (o: boolean) => void }) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content align={align} sideOffset={4} className="z-50 w-64 rounded-md border bg-background p-3 text-sm shadow-md">{children}</P.Content>
      </P.Portal>
    </P.Root>
  );
}
```

`src/ui/ErrorBox.tsx`:
```tsx
export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function ErrorBox({ error, onRetry, compact = false }: { error: unknown; onRetry: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`flex items-center gap-2 text-destructive ${compact ? 'text-xs' : 'rounded-md border border-destructive/40 p-3 text-sm'}`}>
      <span className="min-w-0 flex-1 truncate" title={errorMessage(error)}>{errorMessage(error)}</span>
      <button type="button" onClick={onRetry} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
    </div>
  );
}
```

`src/ui/Skeleton.tsx`:
```tsx
export function Skeleton({ rows }: { rows: number }) {
  return (
    <div aria-label="Loading" className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}
    </div>
  );
}
```

- [ ] **Step 5: Implement `src/ui/canvas/MartCard.tsx`**

Port the look of `tmp/ref/apps_web_src_features_data-marts_model-canvas_components_ModelCanvasFlowNode.tsx` and `tmp/ref/apps_web_src_features_data-marts_shared_canvas_erd-card.tsx`. Use their container, icon tile and title classes, but not their field list. `MartCardView` is the plain component for tests. `MartCard` wraps it for xyflow, adding the handles.

```tsx
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { ExternalLink, Info, LoaderCircle } from 'lucide-react';
import type { Context, DqSummary, Mart } from '../../model/types';
import { compactNumber } from '../format';
import { ContextIcon, DqIcon, FreshnessIcon, MartIcon } from '../icons';
import { Tooltip } from '../Tooltip';

export const CARD_SIZE = { width: 260, height: 132 };

export type CardData = {
  mart: Mart;
  contexts: Context[];
  count: { state: 'loading' } | { state: 'ok'; value: number | null } | { state: 'error'; message: string };
  dq?: DqSummary;
  fieldHit?: string;
  selected: boolean;
  onOpenApp: () => void;
  onRetryCount: () => void;
};

function CountBadge({ count, onRetry }: { count: CardData['count']; onRetry: () => void }) {
  const cls = 'inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground';
  if (count.state === 'loading') return <span className={cls} aria-label="Counting rows"><LoaderCircle className="size-3 animate-spin" /></span>;
  if (count.state === 'error') return <Tooltip content={`${count.message}. Click to retry.`}><button type="button" className={cls} onClick={(e) => { e.stopPropagation(); onRetry(); }}>—</button></Tooltip>;
  if (count.value === null) return null;
  return <Tooltip content={`${count.value.toLocaleString()} rows`}><span className={cls}>{compactNumber(count.value)}</span></Tooltip>;
}

export function MartCardView({ data }: { data: CardData }) {
  const { mart } = data;
  const ctx = data.contexts.filter((c) => mart.contextIds.includes(c.id));
  return (
    <div
      style={{ width: CARD_SIZE.width }}
      className={`bg-background rounded-xl border shadow-sm transition-shadow ${data.selected ? 'ring-2 ring-primary' : 'hover:shadow-md'} ${mart.accessible ? '' : 'opacity-60'}`}
    >
      <div className="flex items-start gap-2 p-3 pb-2">
        <div className="bg-muted flex size-8 shrink-0 items-center justify-center rounded-md"><MartIcon icon={mart.icon} /></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold" title={mart.title}>{mart.title}</span>
            <button type="button" aria-label="Open in OWOX" onClick={(e) => { e.stopPropagation(); data.onOpenApp(); }} className="nodrag text-muted-foreground hover:text-foreground">
              <ExternalLink className="size-3.5" />
            </button>
            {mart.description && (
              <Tooltip content={mart.description}>
                <span aria-label="Description" className="text-muted-foreground"><Info className="size-3.5" /></span>
              </Tooltip>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            {mart.accessible ? <CountBadge count={data.count} onRetry={data.onRetryCount} /> : <span className="text-[11px] text-muted-foreground">No access</span>}
            <DqIcon summary={data.dq} />
            <FreshnessIcon at={mart.dataLastUpdatedAt} />
          </div>
        </div>
      </div>
      {(ctx.length > 0 || data.fieldHit) && (
        <div className="flex flex-wrap gap-1 border-t px-3 py-2">
          {ctx.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground"><ContextIcon icon={c.icon} />{c.name}</span>
          ))}
          {data.fieldHit && <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[11px] text-primary">{data.fieldHit}</span>}
        </div>
      )}
    </div>
  );
}

export function MartCard({ data }: NodeProps) {
  return (
    <>
      <Handle type="target" position={Position.Left} className="!bg-border" />
      <MartCardView data={data as unknown as CardData} />
      <Handle type="source" position={Position.Right} className="!bg-border" />
    </>
  );
}
```

In `TB` mode the handles should sit on Top and Bottom. Give `MartCard` a `direction` field in `data` (`'LR' | 'TB'`, default `'LR'`) and pick `Position.Top`/`Position.Bottom` when it is `TB`. Add `direction?: 'LR' | 'TB'` to `CardData`.

- [ ] **Step 6: Implement `src/ui/canvas/Canvas.tsx`**

```tsx
import { Background, Controls, ReactFlow, ReactFlowProvider, useReactFlow, type Edge as FlowEdge, type Node } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useEffect, useMemo } from 'react';
import { layoutNodes } from '../../graph/layout';
import type { Edge } from '../../model/types';
import { CARD_SIZE, MartCard, type CardData } from './MartCard';

const nodeTypes = { mart: MartCard };

type Props = { ids: string[]; edges: Edge[]; cards: Map<string, CardData>; direction: 'LR' | 'TB'; onSelect: (id: string) => void; onClear: () => void };

function Flow({ ids, edges, cards, direction, onSelect, onClear }: Props) {
  const { fitView } = useReactFlow();
  const positions = useMemo(() => layoutNodes(ids, edges, direction, CARD_SIZE), [ids, edges, direction]);
  const nodes: Node[] = positions.map((p) => ({ id: p.id, type: 'mart', position: { x: p.x, y: p.y }, data: { ...cards.get(p.id)!, direction } as never, draggable: false }));
  const set = new Set(ids);
  const flowEdges: FlowEdge[] = edges
    .filter((e) => set.has(e.source) && set.has(e.target))
    .map((e) => ({ id: e.id, source: e.source, target: e.target, type: 'smoothstep', label: e.joins.map((j) => `${j.sourceField} → ${j.targetField}`).join(', '), labelStyle: { fontSize: 10 } }));

  useEffect(() => {
    const t = setTimeout(() => fitView({ padding: 0.15, duration: 200 }), 0);
    return () => clearTimeout(t);
  }, [positions, fitView]);

  return (
    <ReactFlow nodes={nodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={(_, n) => onSelect(n.id)} onPaneClick={onClear} nodesConnectable={false} proOptions={{ hideAttribution: true }} minZoom={0.2}>
      <Background gap={16} />
      {direction === 'LR' && <Controls showInteractive={false} />}
    </ReactFlow>
  );
}

export function Canvas(props: Props) {
  return <ReactFlowProvider><Flow {...props} /></ReactFlowProvider>;
}
```

Run: `npx vitest run src/ui && npx tsc -b` → PASS.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: add data mart card, status icons and canvas"
```

---

### Task 8: App state, header, shell and boot

**Files:**
- Create: `src/state/store.tsx`, `src/ui/header/Header.tsx`, `src/ui/App.tsx`, `src/sdk/connect.ts`, `src/ui/useModelData.ts`
- Modify: `src/main.tsx`
- Test: `src/state/store.test.ts`, `src/ui/App.test.tsx`

**Interfaces:**
- Consumes: everything from Tasks 2–7. `Explorer` comes from Task 9. In this task, `App` renders a placeholder `<div data-testid="explorer" />` where `<Explorer />` will go. Task 9 swaps it in.
- Produces:
  - `type Tab = { kind: 'mart'; id: string; martId: string; initialFilters: ColumnFilter[] } | { kind: 'record'; id: string; martId: string; pk: Record<string, unknown> }`
  - `type State = { selectedId: string | null; search: string; contextIds: string[]; tabs: Tab[]; activeTabId: string | null; modelVersion: number }`
  - `type Action = { type: 'select'; id: string | null } | { type: 'search'; q: string } | { type: 'toggleContext'; id: string } | { type: 'openMart'; martId: string; filters?: ColumnFilter[] } | { type: 'openRecord'; martId: string; pk: Record<string, unknown> } | { type: 'activate'; tabId: string } | { type: 'close'; tabId: string } | { type: 'refreshModel' }`
  - `reducer(state: State, action: Action): State`, `initialState: State`
  - `<StoreProvider>`, `useStore(): [State, Dispatch<Action>]`
  - `<AppServices ctx={Ctx}>` + `useServices(): { ctx: Ctx; schemas: SchemaLoader; counter: RowCounter }`
  - `useModel()`: `{ model: Model | null; error: unknown; reload(): void; schemaTick: number }`
  - `useCardStatus(model: Model | null, visibleIds: string[], modelVersion: number)`: `{ dq: Map<string, DqSummary>; counts: Map<string, CardData['count']>; recount(id: string): void }`
  - `bootContext(): Promise<Ctx | 'outside-host'>` in `src/sdk/connect.ts`

- [ ] **Step 1: Failing test** `src/state/store.test.ts`

```ts
import { initialState, reducer, type State } from './store';

const s = (patch: Partial<State> = {}): State => ({ ...initialState, ...patch });

test('openMart adds a tab, selects the mart and activates it; reopening activates without duplicating', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'b' });
  st = reducer(st, { type: 'openMart', martId: 'a' });
  expect(st.tabs.map((t) => t.id)).toEqual(['mart:a', 'mart:b']);
  expect(st.activeTabId).toBe('mart:a');
  expect(st.selectedId).toBe('a');
});

test('openMart with filters on an open tab replaces its initial filters', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'a', filters: [{ field: 'id', op: 'eq', value: 1 }] });
  expect(st.tabs[0]).toMatchObject({ initialFilters: [{ field: 'id', op: 'eq', value: 1 }] });
});

test('openRecord uses a stable id', () => {
  let st = reducer(s(), { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  st = reducer(st, { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  expect(st.tabs).toHaveLength(1);
  expect(st.tabs[0]!.kind).toBe('record');
});

test('closing the active tab activates the left neighbour, or the right if first', () => {
  let st = s();
  for (const m of ['a', 'b', 'c']) st = reducer(st, { type: 'openMart', martId: m });
  st = reducer(st, { type: 'activate', tabId: 'mart:b' });
  st = reducer(st, { type: 'close', tabId: 'mart:b' });
  expect(st.activeTabId).toBe('mart:a');
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st.activeTabId).toBe('mart:c');
  expect(st.selectedId).toBe('c');
});

test('closing the last tab leaves explore mode and clears the selection', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st).toMatchObject({ tabs: [], activeTabId: null, selectedId: null });
});

test('closing an inactive tab keeps the active one', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openMart', martId: 'b' });
  st = reducer(st, { type: 'close', tabId: 'mart:a' });
  expect(st.activeTabId).toBe('mart:b');
});

test('activating a record tab selects its mart', () => {
  let st = reducer(s(), { type: 'openMart', martId: 'a' });
  st = reducer(st, { type: 'openRecord', martId: 'c', pk: { id: 1 } });
  st = reducer(st, { type: 'activate', tabId: 'mart:a' });
  expect(st.selectedId).toBe('a');
});

test('search, contexts and refresh', () => {
  let st = reducer(s(), { type: 'search', q: 'ord' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  st = reducer(st, { type: 'toggleContext', id: 'c2' });
  st = reducer(st, { type: 'toggleContext', id: 'c1' });
  st = reducer(st, { type: 'refreshModel' });
  expect(st).toMatchObject({ search: 'ord', contextIds: ['c2'], modelVersion: 1 });
});
```

Run → FAIL.

- [ ] **Step 2: Implement** `src/state/store.tsx`

```tsx
import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ColumnFilter } from '../filters/build';
import { recordTabId } from '../records/relationships';

export type Tab =
  | { kind: 'mart'; id: string; martId: string; initialFilters: ColumnFilter[] }
  | { kind: 'record'; id: string; martId: string; pk: Record<string, unknown> };

export type State = { selectedId: string | null; search: string; contextIds: string[]; tabs: Tab[]; activeTabId: string | null; modelVersion: number };

export type Action =
  | { type: 'select'; id: string | null }
  | { type: 'search'; q: string }
  | { type: 'toggleContext'; id: string }
  | { type: 'openMart'; martId: string; filters?: ColumnFilter[] }
  | { type: 'openRecord'; martId: string; pk: Record<string, unknown> }
  | { type: 'activate'; tabId: string }
  | { type: 'close'; tabId: string }
  | { type: 'refreshModel' };

export const initialState: State = { selectedId: null, search: '', contextIds: [], tabs: [], activeTabId: null, modelVersion: 0 };

const martOf = (tabs: Tab[], id: string | null) => tabs.find((t) => t.id === id)?.martId ?? null;

export function reducer(state: State, a: Action): State {
  switch (a.type) {
    case 'select': return { ...state, selectedId: a.id };
    case 'search': return { ...state, search: a.q };
    case 'toggleContext': {
      const has = state.contextIds.includes(a.id);
      return { ...state, contextIds: has ? state.contextIds.filter((c) => c !== a.id) : [...state.contextIds, a.id] };
    }
    case 'openMart': {
      const id = `mart:${a.martId}`;
      const existing = state.tabs.find((t) => t.id === id);
      const tabs = existing
        ? a.filters ? state.tabs.map((t) => (t.id === id ? { ...t, initialFilters: a.filters! } as Tab : t)) : state.tabs
        : [...state.tabs, { kind: 'mart', id, martId: a.martId, initialFilters: a.filters ?? [] } as Tab];
      return { ...state, tabs, activeTabId: id, selectedId: a.martId };
    }
    case 'openRecord': {
      const id = recordTabId(a.martId, a.pk);
      const tabs = state.tabs.some((t) => t.id === id) ? state.tabs : [...state.tabs, { kind: 'record', id, martId: a.martId, pk: a.pk } as Tab];
      return { ...state, tabs, activeTabId: id, selectedId: a.martId };
    }
    case 'activate': return { ...state, activeTabId: a.tabId, selectedId: martOf(state.tabs, a.tabId) };
    case 'close': {
      const i = state.tabs.findIndex((t) => t.id === a.tabId);
      if (i < 0) return state;
      const tabs = state.tabs.filter((t) => t.id !== a.tabId);
      if (tabs.length === 0) return { ...state, tabs, activeTabId: null, selectedId: null };
      if (state.activeTabId !== a.tabId) return { ...state, tabs };
      const next = tabs[Math.max(0, i - 1)]!;
      return { ...state, tabs, activeTabId: next.id, selectedId: next.martId };
    }
    case 'refreshModel': return { ...state, modelVersion: state.modelVersion + 1 };
  }
}

const StoreCtx = createContext<[State, Dispatch<Action>] | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const value = useReducer(reducer, initialState);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore(): [State, Dispatch<Action>] {
  const v = useContext(StoreCtx);
  if (!v) throw new Error('useStore outside StoreProvider');
  return v;
}
```

Add `AppServices` and `useServices` in the same file:
```tsx
import { useMemo } from 'react';
import { createRowCounter, type RowCounter } from '../api/row-counts';
import { createSchemaLoader, type SchemaLoader } from '../api/schemas';
import type { Ctx } from '../sdk/types';

type Services = { ctx: Ctx; schemas: SchemaLoader; counter: RowCounter };
const ServicesCtx = createContext<Services | null>(null);

export function AppServices({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const value = useMemo(() => ({ ctx, schemas: createSchemaLoader(ctx), counter: createRowCounter(ctx) }), [ctx]);
  return <ServicesCtx.Provider value={value}>{children}</ServicesCtx.Provider>;
}

export function useServices(): Services {
  const v = useContext(ServicesCtx);
  if (!v) throw new Error('useServices outside AppServices');
  return v;
}
```

Run: `npx vitest run src/state` → PASS.

- [ ] **Step 3: Implement** `src/ui/useModelData.ts`

Two hooks. `useModel` loads the model. `useCardStatus` loads DQ and row counts for the visible cards. They are separate because the visible ids depend on the model.

Behavior:
1. `useModel` loads the model on mount and whenever `modelVersion` changes. On a refresh (`modelVersion > 0`), it calls `schemas.clear()` first.
2. Once the model loads, it prefetches every schema, then bumps `schemaTick` on each schema arrival, so search recomputes.
3. When `visibleIds` changes, `useCardStatus` loads DQ for visible ids it does not have yet.
4. For each visible, accessible id with no count, it sets `loading`, then runs `counter.count`.
5. A `modelVersion` change clears DQ and counts. The next pass then uses `counter.recount`, so the header Refresh recounts the visible cards.
6. `recount(id)` recounts one card. The card's error badge uses it.

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadDqSummaries } from '../api/data-quality';
import { loadModel } from '../api/model';
import type { DqSummary, Model } from '../model/types';
import { useServices, useStore } from '../state/store';
import type { CardData } from './canvas/MartCard';
import { errorMessage } from './ErrorBox';

export function useModel() {
  const { ctx, schemas } = useServices();
  const [{ modelVersion }] = useStore();
  const [model, setModel] = useState<Model | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [schemaTick, setSchemaTick] = useState(0);
  const [retry, setRetry] = useState(0);

  useEffect(() => schemas.subscribe(() => setSchemaTick((t) => t + 1)), [schemas]);

  useEffect(() => {
    let live = true;
    setError(null);
    if (modelVersion > 0) schemas.clear();
    loadModel(ctx).then(
      (m) => { if (!live) return; setModel(m); void schemas.prefetch([...m.marts.keys()]); },
      (e) => { if (live) setError(e); },
    );
    return () => { live = false; };
  }, [ctx, schemas, modelVersion, retry]);

  return { model, error, reload: () => setRetry((r) => r + 1), schemaTick };
}

export function useCardStatus(model: Model | null, visibleIds: string[], modelVersion: number) {
  const { ctx, schemas, counter } = useServices();
  const [dq, setDq] = useState(new Map<string, DqSummary>());
  const [counts, setCounts] = useState(new Map<string, CardData['count']>());
  const fresh = useRef(false);
  const seenVersion = useRef(modelVersion);

  if (seenVersion.current !== modelVersion) {
    seenVersion.current = modelVersion;
    fresh.current = true;
  }

  const runCount = useCallback((id: string, recount: boolean) => {
    setCounts((c) => new Map(c).set(id, { state: 'loading' }));
    schemas.get(id)
      .then((s) => (recount ? counter.recount(id, s) : counter.count(id, s)))
      .then(
        (value) => setCounts((c) => new Map(c).set(id, { state: 'ok', value })),
        (e) => setCounts((c) => new Map(c).set(id, { state: 'error', message: errorMessage(e) })),
      );
  }, [schemas, counter]);

  useEffect(() => {
    setDq(new Map());
    setCounts(new Map());
  }, [modelVersion]);

  const key = visibleIds.join('|');
  useEffect(() => {
    if (!model) return;
    const ids = visibleIds.filter((id) => model.marts.get(id)?.accessible);
    const recount = fresh.current;
    fresh.current = false;
    const missingDq = ids.filter((id) => recount || !dq.has(id));
    if (missingDq.length) loadDqSummaries(ctx, missingDq).then((m) => setDq((d) => new Map([...d, ...m]))).catch(() => undefined);
    ids.filter((id) => recount || !counts.has(id)).forEach((id) => runCount(id, recount));
    // dq and counts are read, not tracked: this runs when the model or the visible set changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, key]);

  return { dq, counts, recount: (id: string) => runCount(id, true) };
}
```


- [ ] **Step 4: Implement** `src/ui/header/Header.tsx`

```tsx
import { RefreshCw, Search, X } from 'lucide-react';
import type { Context } from '../../model/types';
import { useStore } from '../../state/store';
import { ContextIcon } from '../icons';

export function Header({ contexts }: { contexts: Context[] }) {
  const [state, dispatch] = useStore();
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Search data marts"
          placeholder="Search title, context or field"
          value={state.search}
          onChange={(e) => dispatch({ type: 'search', q: e.target.value })}
          className="h-8 w-full rounded-md border bg-background pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {state.search && (
          <button type="button" aria-label="Clear search" onClick={() => dispatch({ type: 'search', q: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-3.5" /></button>
        )}
      </div>
      <div className="flex flex-1 flex-wrap gap-1" role="group" aria-label="Contexts">
        {contexts.map((c) => {
          const on = state.contextIds.includes(c.id);
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => dispatch({ type: 'toggleContext', id: c.id })}
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
              <ContextIcon icon={c.icon} />{c.name}
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Refresh model" onClick={() => dispatch({ type: 'refreshModel' })} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent">
        <RefreshCw className="size-4" />Refresh
      </button>
    </header>
  );
}
```

- [ ] **Step 5: Implement** `src/ui/App.tsx`

```tsx
import { useMemo } from 'react';
import { martAppUrl } from '../config';
import { computeVisible } from '../graph/visible';
import { useServices, useStore } from '../state/store';
import { Canvas } from './canvas/Canvas';
import { CARD_SIZE, type CardData } from './canvas/MartCard';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { Skeleton } from './Skeleton';
import { useCardStatus, useModel } from './useModelData';

export function App() {
  const [state, dispatch] = useStore();
  const { ctx, schemas } = useServices();
  const { model, error, reload, schemaTick } = useModel();
  const visible = useMemo(
    () => (model ? computeVisible({ model, selectedId: state.selectedId, search: state.search, contextIds: state.contextIds, schemas: (id) => schemas.peek(id) }) : null),
    // schemaTick re-runs the search as schemas arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, state.selectedId, state.search, state.contextIds, schemas, schemaTick],
  );
  const { dq, counts, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);
  const exploring = state.tabs.length > 0;

  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) return <Skeleton rows={6} />;

  const cards = new Map<string, CardData>(visible.ids.map((id) => [id, {
    mart: model.marts.get(id)!,
    contexts: model.contexts,
    count: counts.get(id) ?? { state: 'loading' },
    dq: dq.get(id),
    fieldHit: visible.fieldHits.get(id),
    selected: state.selectedId === id,
    onOpenApp: () => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id)),
    onRetryCount: () => recount(id),
  }]));

  return (
    <div className="flex h-full flex-col">
      <Header contexts={model.contexts} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 border-r" style={exploring ? { width: CARD_SIZE.width + 48, flex: 'none' } : { flex: 1 }}>
          {visible.mode === 'empty' ? (
            <p className="p-6 text-sm text-muted-foreground">No data marts match.</p>
          ) : (
            <Canvas
              ids={visible.ids}
              edges={model.edges}
              cards={cards}
              direction={exploring ? 'TB' : 'LR'}
              onSelect={(id) => (model.marts.get(id)?.accessible ? dispatch({ type: 'openMart', martId: id }) : dispatch({ type: 'select', id }))}
              onClear={() => { if (!exploring) dispatch({ type: 'select', id: null }); }}
            />
          )}
          {visible.hiddenMatches > 0 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs shadow-sm">+{visible.hiddenMatches} more. Refine the search to see them.</div>
          )}
        </div>
        {exploring && <div data-testid="explorer" className="min-w-0 flex-1" />}
      </div>
    </div>
  );
}
```


Clicking an inaccessible mart selects it, showing its neighbours, but opens no tab.

- [ ] **Step 6: Implement** `src/sdk/connect.ts` and `src/main.tsx`

`src/sdk/connect.ts`:
```ts
import { connect } from '@owox/plugin-sdk';
import type { Ctx } from './types';

export async function bootContext(): Promise<Ctx | 'outside-host'> {
  if (new URLSearchParams(location.search).has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    return createMockCtx(demoFixtures(), { latencyMs: 250 });
  }
  try {
    return (await connect()) as unknown as Ctx;
  } catch {
    return 'outside-host';
  }
}
```

The cast is `as unknown as Ctx` because `PluginContext.owox.dataMarts.traverseData` returns the SDK's `HttpNdjsonTraversal`, which has `rowChunks` and `cancel` but a wider option type. After the cast, check at type level: `const _check: Pick<Ctx['owox']['models'], 'getEdges'> = (await connect()).owox.models;`. Put it in a `// type check only` function that is never called. If that fails to compile, the SDK changed shape and this module needs updating.

`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { bootContext } from './sdk/connect';
import { AppServices, StoreProvider } from './state/store';
import { App } from './ui/App';

const root = createRoot(document.getElementById('root')!);

bootContext().then((ctx) => {
  if (ctx === 'outside-host') {
    root.render(<p className="p-6 text-sm">Open this plugin from OWOX Data Marts.</p>);
    return;
  }
  document.documentElement.classList.toggle('dark', ctx.theme === 'dark');
  root.render(
    <StrictMode>
      <AppServices ctx={ctx}>
        <StoreProvider><App /></StoreProvider>
      </AppServices>
    </StrictMode>,
  );
});
```

- [ ] **Step 7: Failing integration test** `src/ui/App.test.tsx`

xyflow needs `ResizeObserver` and element sizes in jsdom. Add this to `src/test-setup.ts`:
```ts
class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= RO;
(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= class { m22 = 1; constructor() {} };
Object.defineProperties(HTMLElement.prototype, {
  offsetWidth: { get() { return 1000; } },
  offsetHeight: { get() { return 800; } },
});
```

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../sdk/mock/ctx';
import { demoFixtures } from '../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../state/store';
import { App } from './App';

function renderApp() {
  return render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
}

test('default view centres on the mart with the most inbound relationships', async () => {
  renderApp();
  expect(await screen.findByText('Orders')).toBeInTheDocument();
  expect(screen.getByText('Customers')).toBeInTheDocument();
  expect(screen.getAllByText(/^[\d.]+[KMB]?$/).length).toBeGreaterThan(0); // count badges arrived
});

test('search narrows the canvas; no match shows the empty message; clearing restores', async () => {
  renderApp();
  await screen.findByText('Orders');
  await userEvent.type(screen.getByLabelText('Search data marts'), 'zzzz');
  expect(await screen.findByText('No data marts match.')).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText('Clear search'));
  expect(await screen.findByText('Orders')).toBeInTheDocument();
});

test('a context chip filters to that context', async () => {
  renderApp();
  await screen.findByText('Orders');
  await userEvent.click(within(screen.getByRole('group', { name: 'Contexts' })).getByText('Marketing'));
  await waitFor(() => expect(screen.queryByText('Orders')).toBeNull());
  expect(screen.getByText('Campaigns')).toBeInTheDocument();
});

test('clicking a card enters explore mode', async () => {
  renderApp();
  await userEvent.click(await screen.findByText('Customers'));
  expect(await screen.findByTestId('explorer')).toBeInTheDocument();
});
```

Run: `npx vitest run src/ui/App.test.tsx`. Expected: FAIL before Steps 3–6 are in place, PASS after. If an xyflow node click does not register in jsdom, click the card's title element. `onNodeClick` fires from the node wrapper, so `userEvent.click` on a descendant works.

- [ ] **Step 8: Manual check in mock mode**

Run: `npx vite --port 5173` in the background, then take a screenshot with Playwright at `http://localhost:5173/?mock` (deviceScaleFactor 1) to `tmp/task8.png` and look at it:

1. Orders is in the middle.
2. Cards show badges and icons.
3. Context chips are in the header.

Stop the server.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: add app shell with header, canvas and explore-mode state"
```

---

### Task 9: Explorer: tabs, mart grid, filters, column picker, record view

**Files:**
- Create: `src/ui/explorer/Explorer.tsx`, `src/ui/explorer/TabBar.tsx`, `src/ui/explorer/MartTab.tsx`, `src/ui/explorer/RecordTab.tsx`, `src/ui/explorer/ColumnPicker.tsx`, `src/ui/explorer/FilterPopover.tsx`, `src/ui/explorer/CellValue.tsx`, `src/ui/explorer/useMartRows.ts`
- Modify: `src/ui/App.tsx` (replace the placeholder `<div data-testid="explorer" …/>` with `<div data-testid="explorer" className="min-w-0 flex-1"><Explorer model={model} /></div>`)
- Test: `src/ui/explorer/useMartRows.test.ts`, `src/ui/explorer/FilterPopover.test.tsx`, `src/ui/explorer/Explorer.test.tsx`

**Interfaces:**
- Consumes: `useStore`, `useServices`, `Tab` (Task 8); `readRows` (Task 2); `operatorsFor`, `RELATIVE_PRESETS`, `ColumnFilter`, `isComplete`, `toTraverseFilter` (Task 5); `primaryKeys`, `relationshipColumns`, `clickTarget`, `lookupTitles`, `RelColumn` (Task 6); `MartIcon`, `ErrorBox`, `Skeleton`, `Popover`, `Tooltip` (Task 7); `PAGE_SIZE` (Task 1).
- Produces:
  - `defaultColumns(schema: Schema): string[]` (first 5 names)
  - `buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, rels: Map<string, RelColumn>): TraverseOptions`
  - `useMartRows(martId, options, version)`: `{ rows: Row[] | null; loading: boolean; error: unknown; hasMore: boolean }`
  - `<Explorer model={Model} />`

- [ ] **Step 1: Failing test** `src/ui/explorer/useMartRows.test.ts`

```ts
import { buildRowQuery, defaultColumns } from './useMartRows';
import type { Schema } from '../../model/types';

const f = (name: string, isPrimaryKey = false, type = 'STRING'): Schema[number] => ({ name, alias: null, type, category: type === 'STRING' ? 'string' : 'number', description: null, isPrimaryKey });
const schema: Schema = [f('id', true, 'INT64'), f('a'), f('b'), f('c'), f('customer_id', false, 'INT64'), f('e'), f('g')];
const rels = new Map([['customer_id', { field: 'customer_id', edgeId: 'e', relatedMartId: 'customers', relatedField: 'id', composite: false, joins: [{ sourceField: 'customer_id', targetField: 'id' }] }]]);

test('defaultColumns is the first 5 fields', () => {
  expect(defaultColumns(schema)).toEqual(['id', 'a', 'b', 'c', 'customer_id']);
});

test('buildRowQuery adds primary and relationship keys, keeps schema order, applies complete filters only', () => {
  const q = buildRowQuery(schema, ['b', 'a'], [
    { field: 'a', op: 'contains', value: 'x' },
    { field: 'b', op: 'contains', value: '' },
  ], 200, rels);
  expect(q).toEqual({
    column: ['id', 'a', 'b', 'customer_id'],
    filter: [{ column: 'a', operator: 'contains', value: 'x' }],
    sort: [{ column: 'id', direction: 'asc' }],
    limit: 201,
  });
});

test('no primary key → no sort, and composite join fields are fetched too', () => {
  const noPk: Schema = [f('x'), f('cur'), f('day')];
  const comp = new Map([['cur', { field: 'cur', edgeId: 'e', relatedMartId: 'fx', relatedField: 'code', composite: true, joins: [{ sourceField: 'cur', targetField: 'code' }, { sourceField: 'day', targetField: 'day' }] }]]);
  expect(buildRowQuery(noPk, ['x', 'cur'], [], 200, comp)).toEqual({ column: ['x', 'cur', 'day'], limit: 201 });
});
```

`limit` is one more than the page size, so `hasMore` is detectable. The hook drops the extra row.

Run → FAIL.

- [ ] **Step 2: Implement** `src/ui/explorer/useMartRows.ts`

```ts
import { useEffect, useState } from 'react';
import { readRows } from '../../api/rows';
import { isComplete, toTraverseFilter, type ColumnFilter } from '../../filters/build';
import type { Schema } from '../../model/types';
import type { RelColumn } from '../../records/relationships';
import type { Row, TraverseOptions } from '../../sdk/types';
import { useServices } from '../../state/store';

export function defaultColumns(schema: Schema): string[] {
  return schema.slice(0, 5).map((f) => f.name);
}

export function buildRowQuery(schema: Schema, visible: string[], filters: ColumnFilter[], limit: number, rels: Map<string, RelColumn>): TraverseOptions {
  const need = new Set(visible);
  schema.filter((f) => f.isPrimaryKey).forEach((f) => need.add(f.name));
  for (const name of visible) rels.get(name)?.joins.forEach((j) => need.add(j.sourceField));
  const column = schema.map((f) => f.name).filter((n) => need.has(n));
  const filter = filters.flatMap((flt) => {
    const field = schema.find((x) => x.name === flt.field);
    return field && isComplete(flt, field) ? [toTraverseFilter(flt, field)] : [];
  });
  const pks = schema.filter((f) => f.isPrimaryKey).map((f) => ({ column: f.name, direction: 'asc' as const }));
  return { column, ...(filter.length ? { filter } : {}), ...(pks.length ? { sort: pks } : {}), limit: limit + 1 };
}

export function useMartRows(martId: string, options: TraverseOptions | null, version: number) {
  const { ctx } = useServices();
  const [state, setState] = useState<{ rows: Row[] | null; loading: boolean; error: unknown; hasMore: boolean }>({ rows: null, loading: true, error: null, hasMore: false });
  const key = JSON.stringify(options);
  useEffect(() => {
    if (!options) return;
    const ac = new AbortController();
    const pageLimit = (options.limit ?? 1) - 1;
    setState((s) => ({ ...s, loading: true, error: null }));
    readRows(ctx, martId, options, { signal: ac.signal }).then(
      (rows) => setState({ rows: rows.slice(0, pageLimit), loading: false, error: null, hasMore: rows.length > pageLimit }),
      (error) => { if (!ac.signal.aborted) setState({ rows: null, loading: false, error, hasMore: false }); },
    );
    return () => ac.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, martId, key, version]);
  return state;
}
```

Run → PASS.

- [ ] **Step 3: Failing test** `src/ui/explorer/FilterPopover.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { FilterEditor } from './FilterPopover';
import type { Field } from '../../model/types';

const num: Field = { name: 'amount', alias: 'Amount', type: 'NUMERIC', category: 'number', description: null, isPrimaryKey: false };
const ts: Field = { ...num, name: 'created_at', type: 'TIMESTAMP', category: 'date' };

test('number: choose ≥, type a value, apply', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={num} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'gte');
  await userEvent.type(screen.getByLabelText('Value'), '10');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'amount', op: 'gte', value: '10' });
});

test('Apply is disabled while incomplete', async () => {
  render(<FilterEditor field={num} value={undefined} onApply={vi.fn()} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'between');
  await userEvent.type(screen.getByLabelText('From'), '1');
  expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
});

test('date: relative last N days', async () => {
  const onApply = vi.fn();
  render(<FilterEditor field={ts} value={undefined} onApply={onApply} onClear={vi.fn()} />);
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'relative');
  await userEvent.selectOptions(screen.getByLabelText('Period'), 'last_n_days');
  await userEvent.clear(screen.getByLabelText('N'));
  await userEvent.type(screen.getByLabelText('N'), '7');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  expect(onApply).toHaveBeenCalledWith({ field: 'created_at', op: 'relative', value: { kind: 'last_n_days', n: 7 } });
});

test('Clear calls onClear', async () => {
  const onClear = vi.fn();
  render(<FilterEditor field={num} value={{ field: 'amount', op: 'gt', value: '1' }} onApply={vi.fn()} onClear={onClear} />);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  expect(onClear).toHaveBeenCalled();
});
```

Run → FAIL.

- [ ] **Step 4: Implement** `src/ui/explorer/FilterPopover.tsx`

1. `FilterEditor` is the plain form, so it can be tested.
2. `FilterPopover` wraps it in `Popover`. Its trigger is a `Filter` icon button, filled (`text-primary`) when a filter is active.
3. Inputs by value kind:
   1. `text` and `number`: `<input aria-label="Value">`, with `type="number"` for numbers.
   2. `date`: `<input type="date">`, or `type="time"` for the time category.
   3. Ranges: two inputs labelled `From` and `To`.
   4. `relative`: `<select aria-label="Period">` over `RELATIVE_PRESETS`, plus `<input aria-label="N" type="number" min=1 defaultValue=7>` when `needsN`.
4. The operator is a `<select aria-label="Operator">` over `operatorsFor(field)`. Changing it resets the value.
5. Apply is enabled only when `isComplete`.

```tsx
import { Filter } from 'lucide-react';
import { useState } from 'react';
import { RELATIVE_PRESETS, operatorsFor, type OpId } from '../../filters/catalogue';
import { isComplete, type ColumnFilter, type FilterValue } from '../../filters/build';
import type { Field } from '../../model/types';
import type { RelativeDatePreset } from '../../sdk/types';
import { Popover } from '../Popover';

const input = 'h-8 w-full rounded-md border bg-background px-2 text-sm';

export function FilterEditor({ field, value, onApply, onClear }: { field: Field; value: ColumnFilter | undefined; onApply: (f: ColumnFilter) => void; onClear: () => void }) {
  const ops = operatorsFor(field);
  const [op, setOp] = useState<OpId>(value?.op ?? ops[0]!.id);
  const [val, setVal] = useState<FilterValue>(value?.value);
  const def = ops.find((o) => o.id === op)!;
  const draft: ColumnFilter = { field: field.name, op, ...(def.value === 'none' ? {} : { value: val }) };
  const range = (val ?? { from: '', to: '' }) as { from: string; to: string };
  const rel = (val ?? { kind: 'today' }) as RelativeDatePreset;
  const dateType = field.category === 'time' ? 'time' : 'date';

  return (
    <form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); if (isComplete(draft, field)) onApply(draft); }}>
      <div className="text-xs font-medium text-muted-foreground">{field.alias ?? field.name}</div>
      <select aria-label="Operator" className={input} value={op} onChange={(e) => { setOp(e.target.value as OpId); setVal(undefined); }}>
        {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
      {(def.value === 'text' || def.value === 'number') && (
        <input aria-label="Value" className={input} type={def.value === 'number' ? 'number' : 'text'} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />
      )}
      {def.value === 'date' && <input aria-label="Value" className={input} type={dateType} value={String(val ?? '')} onChange={(e) => setVal(e.target.value)} />}
      {(def.value === 'number-range' || def.value === 'date-range') && (
        <div className="flex gap-2">
          {(['from', 'to'] as const).map((k) => (
            <input key={k} aria-label={k === 'from' ? 'From' : 'To'} className={input} type={def.value === 'number-range' ? 'number' : dateType}
              value={range[k] ?? ''} onChange={(e) => setVal({ ...range, [k]: e.target.value })} />
          ))}
        </div>
      )}
      {def.value === 'relative' && (
        <div className="flex gap-2">
          <select aria-label="Period" className={input} value={rel.kind} onChange={(e) => {
            const p = RELATIVE_PRESETS.find((x) => x.kind === e.target.value)!;
            setVal((p.needsN ? { kind: p.kind, n: 7 } : { kind: p.kind }) as RelativeDatePreset);
          }}>
            {RELATIVE_PRESETS.map((p) => <option key={p.kind} value={p.kind}>{p.label}</option>)}
          </select>
          {'n' in rel && <input aria-label="N" className={`${input} w-20`} type="number" min={1} value={Number.isNaN(rel.n) ? '' : rel.n} onChange={(e) => setVal({ ...rel, n: e.target.valueAsNumber } as RelativeDatePreset)} />}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClear} className="rounded-md border px-2.5 py-1 text-sm hover:bg-accent">Clear</button>
        <button type="submit" disabled={!isComplete(draft, field)} className="rounded-md bg-primary px-2.5 py-1 text-sm text-primary-foreground disabled:opacity-50">Apply</button>
      </div>
    </form>
  );
}

export function FilterPopover({ field, value, onChange }: { field: Field; value: ColumnFilter | undefined; onChange: (f: ColumnFilter | undefined) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen} trigger={
      <button type="button" aria-label={`Filter ${field.alias ?? field.name}`} className={value ? 'text-primary' : 'text-muted-foreground hover:text-foreground'}>
        <Filter className="size-3.5" fill={value ? 'currentColor' : 'none'} />
      </button>
    }>
      <FilterEditor key={JSON.stringify(value)} field={field} value={value}
        onApply={(f) => { onChange(f); setOpen(false); }} onClear={() => { onChange(undefined); setOpen(false); }} />
    </Popover>
  );
}
```

`RelativeDatePreset` in `src/sdk/types.ts` omits `next_n_days` (forward-looking, not in the spec list). `RELATIVE_PRESETS` is the source for the UI.

Run → PASS.

- [ ] **Step 5: Implement** `src/ui/explorer/CellValue.tsx`

```tsx
import type { Row } from '../../sdk/types';
import { Tooltip } from '../Tooltip';

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function CellValue({ row, field, title, onOpen }: { row: Row; field: string; title?: string; onOpen?: () => void }) {
  const raw = formatValue(row[field]);
  if (!onOpen || raw.trim() === '') return <span className="truncate">{raw}</span>;
  const link = (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="truncate text-left text-primary hover:underline">
      {title ?? raw}
    </button>
  );
  return title ? <Tooltip content={raw}>{link}</Tooltip> : link;
}
```

- [ ] **Step 6: Implement** `src/ui/explorer/ColumnPicker.tsx`

```tsx
import { Columns3 } from 'lucide-react';
import type { Schema } from '../../model/types';
import { Popover } from '../Popover';

export function ColumnPicker({ schema, visible, onChange }: { schema: Schema; visible: string[]; onChange: (cols: string[]) => void }) {
  const set = new Set(visible);
  const toggle = (name: string) => {
    const next = set.has(name) ? visible.filter((c) => c !== name) : [...visible, name];
    onChange(schema.map((f) => f.name).filter((n) => next.includes(n)));
  };
  return (
    <Popover align="end" trigger={
      <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><Columns3 className="size-4" />Columns ({visible.length}/{schema.length})</button>
    }>
      <div className="flex max-h-72 flex-col gap-1 overflow-auto">
        {schema.map((f) => (
          <label key={f.name} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={set.has(f.name)} disabled={set.has(f.name) && visible.length === 1} onChange={() => toggle(f.name)} />
            <span className="truncate">{f.alias ?? f.name}</span>
            {f.alias && <span className="truncate font-mono text-[11px] text-muted-foreground">{f.name}</span>}
          </label>
        ))}
      </div>
    </Popover>
  );
}
```

The last checked column can't be unchecked, so the grid always has at least one column.

- [ ] **Step 7: Implement** `src/ui/explorer/MartTab.tsx`

Behavior:
1. Load the schema with `schemas.get(martId)`, showing `Skeleton` while it loads and `ErrorBox` with retry on failure.
2. Local state: `visible` (init `defaultColumns(schema)`), `filters: Record<string, ColumnFilter>` (init from `tab.initialFilters`, re-initialised when `tab.initialFilters` changes identity), `limit` (init `PAGE_SIZE`), `version`.
3. `rels = relationshipColumns(martId, model.edges)`.
4. `rows = useMartRows(martId, buildRowQuery(schema, visible, Object.values(filters), limit, rels), version)`.
5. After rows load, for each visible relationship column, load the related schema with `schemas.get(rel.relatedMartId)` and call `lookupTitles(ctx, rel, rows.map((r) => r[rel.field]), relSchema)`. Keep `titles: Map<field, Map<value, title>>` and `relSchemas: Map<martId, Schema>`. Lookup failures are ignored, and the cell shows the raw value.
6. Toolbar:
   1. Mart icon and title.
   2. A row count text (`{rows.length} rows`, with `+` when `hasMore`).
   3. "Reset" (disabled when there are no filters). It clears filters and sets `limit` back to `PAGE_SIZE`.
   4. "Refresh". It bumps `version` and clears `titles`.
   5. `ColumnPicker`.
7. No primary key (`primaryKeys(schema).length === 0`): show the banner `Preview only: this data mart has no primary key.` and rows are not clickable.
8. Grid: TanStack table with `getCoreRowModel`.
   1. Columns are `visible`. Each header shows `alias ?? name` and a `FilterPopover`.
   2. A cell renders `CellValue`. When the column is in `rels`, pass `title={titles.get(field)?.get(String(value))}` and `onOpen` from `clickTarget(rel, row, relSchemas.get(rel.relatedMartId) ?? [])`. A `record` target dispatches `openRecord`; a `mart` target dispatches `openMart` with filters.
   3. A row click with a primary key dispatches `openRecord` with `pk` built from the primary keys.
   4. The header is sticky and the table scrolls inside the tab.
9. Loading:
   1. The first load (`rows === null && loading`) shows `<Skeleton rows={8} />`.
   2. A reload keeps the old rows, dims the table, and shows a thin progress bar.
   3. An error shows `ErrorBox` with retry (it bumps `version`).
10. Below the table, when `hasMore`, a "Load more" button adds `PAGE_SIZE` to `limit`.
11. With no rows: "No rows match the filters." when filters are set, else "This data mart has no rows."

```tsx
import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { PAGE_SIZE } from '../../config';
import type { ColumnFilter } from '../../filters/build';
import type { Model, Schema } from '../../model/types';
import { clickTarget, primaryKeys, relationshipColumns } from '../../records/relationships';
import { lookupTitles } from '../../records/titles';
import type { Row } from '../../sdk/types';
import { useServices, useStore, type Tab } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { MartIcon } from '../icons';
import { Skeleton } from '../Skeleton';
import { CellValue } from './CellValue';
import { ColumnPicker } from './ColumnPicker';
import { FilterPopover } from './FilterPopover';
import { buildRowQuery, defaultColumns, useMartRows } from './useMartRows';

function useSchema(martId: string, version: number) {
  const { schemas } = useServices();
  const [s, setS] = useState<{ schema: Schema | null; error: unknown }>({ schema: schemas.peek(martId) ?? null, error: null });
  useEffect(() => {
    let live = true;
    schemas.get(martId).then((schema) => live && setS({ schema, error: null }), (error) => live && setS({ schema: null, error }));
    return () => { live = false; };
  }, [schemas, martId, version]);
  return s;
}

export function MartTab({ tab, model }: { tab: Extract<Tab, { kind: 'mart' }>; model: Model }) {
  const [schemaVersion, setSchemaVersion] = useState(0);
  const { schema, error } = useSchema(tab.martId, schemaVersion);
  if (error) return <div className="p-4"><ErrorBox error={error} onRetry={() => setSchemaVersion((v) => v + 1)} /></div>;
  if (!schema) return <Skeleton rows={8} />;
  return <MartGrid tab={tab} model={model} schema={schema} />;
}

function MartGrid({ tab, model, schema }: { tab: Extract<Tab, { kind: 'mart' }>; model: Model; schema: Schema }) {
  const { ctx, schemas } = useServices();
  const [, dispatch] = useStore();
  const mart = model.marts.get(tab.martId)!;
  const [visible, setVisible] = useState(() => defaultColumns(schema));
  const [filters, setFilters] = useState<Record<string, ColumnFilter>>({});
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [version, setVersion] = useState(0);
  const [titles, setTitles] = useState(new Map<string, Map<string, string>>());
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());

  useEffect(() => {
    setFilters(Object.fromEntries(tab.initialFilters.map((f) => [f.field, f])));
    setLimit(PAGE_SIZE);
  }, [tab.initialFilters]);

  const rels = useMemo(() => relationshipColumns(tab.martId, model.edges), [tab.martId, model.edges]);
  const pks = primaryKeys(schema);
  const query = useMemo(() => buildRowQuery(schema, visible, Object.values(filters), limit, rels), [schema, visible, filters, limit, rels]);
  const { rows, loading, error, hasMore } = useMartRows(tab.martId, query, version);

  useEffect(() => {
    if (!rows) return;
    const ac = new AbortController();
    for (const name of visible) {
      const rel = rels.get(name);
      if (!rel) continue;
      schemas.get(rel.relatedMartId).then(async (rs) => {
        setRelSchemas((m) => new Map(m).set(rel.relatedMartId, rs));
        const t = await lookupTitles(ctx, rel, rows.map((r) => r[rel.field]), rs, ac.signal);
        if (!ac.signal.aborted) setTitles((m) => new Map(m).set(name, t));
      }).catch(() => undefined);
    }
    return () => ac.abort();
  }, [rows, visible, rels, ctx, schemas]);

  const columns = useMemo<ColumnDef<Row>[]>(() => visible.map((name) => {
    const field = schema.find((f) => f.name === name)!;
    const rel = rels.get(name);
    return {
      id: name,
      header: () => (
        <div className="flex items-center gap-1">
          <span className="truncate" title={field.description ?? field.name}>{field.alias ?? field.name}</span>
          <FilterPopover field={field} value={filters[name]} onChange={(f) => {
            setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; });
            setLimit(PAGE_SIZE);
          }} />
        </div>
      ),
      cell: ({ row }) => {
        if (!rel) return <CellValue row={row.original} field={name} />;
        const target = clickTarget(rel, row.original, relSchemas.get(rel.relatedMartId) ?? []);
        return (
          <CellValue row={row.original} field={name}
            title={titles.get(name)?.get(String(row.original[name]))}
            onOpen={target ? () => dispatch(target.kind === 'record' ? { type: 'openRecord', martId: target.martId, pk: target.pk } : { type: 'openMart', martId: target.martId, filters: target.filters }) : undefined} />
        );
      },
    };
  }), [visible, schema, rels, filters, titles, relSchemas, dispatch]);

  const table = useReactTable({ data: rows ?? [], columns, getCoreRowModel: getCoreRowModel() });
  const hasFilters = Object.keys(filters).length > 0;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <MartIcon icon={mart.icon} />
        <span className="font-semibold">{mart.title}</span>
        {rows && <span className="text-xs text-muted-foreground">{rows.length}{hasMore ? '+' : ''} rows</span>}
        <div className="flex-1" />
        <button type="button" disabled={!hasFilters} onClick={() => { setFilters({}); setLimit(PAGE_SIZE); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50"><RotateCcw className="size-4" />Reset</button>
        <button type="button" onClick={() => { setTitles(new Map()); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
        <ColumnPicker schema={schema} visible={visible} onChange={setVisible} />
      </div>
      {pks.length === 0 && <div className="border-b bg-muted px-3 py-1.5 text-xs text-muted-foreground">Preview only: this data mart has no primary key.</div>}
      {loading && rows && <div className="h-0.5 animate-pulse bg-primary" />}
      {error ? <div className="p-4"><ErrorBox error={error} onRetry={() => setVersion((v) => v + 1)} /></div>
        : !rows ? <Skeleton rows={8} />
        : rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'}</p>
        : (
          <div className={`min-h-0 flex-1 overflow-auto ${loading ? 'opacity-60' : ''}`}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id}>{hg.headers.map((h) => <th key={h.id} className="max-w-64 border-b px-3 py-2 text-left font-medium">{flexRender(h.column.columnDef.header, h.getContext())}</th>)}</tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => (
                  <tr key={r.id}
                    onClick={pks.length ? () => dispatch({ type: 'openRecord', martId: tab.martId, pk: Object.fromEntries(pks.map((k) => [k, r.original[k]])) }) : undefined}
                    className={`border-b ${pks.length ? 'cursor-pointer hover:bg-accent' : ''}`}>
                    {r.getVisibleCells().map((c) => <td key={c.id} className="max-w-64 px-3 py-1.5">{flexRender(c.column.columnDef.cell, c.getContext())}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
            {hasMore && <div className="p-3 text-center"><button type="button" onClick={() => setLimit((l) => l + PAGE_SIZE)} className="rounded-md border px-3 py-1 text-sm hover:bg-accent">Load more</button></div>}
          </div>
        )}
    </div>
  );
}
```

If Task 1 installed TanStack Table v8, the same API applies. If v9 changed `useReactTable` options, follow its migration note and keep the behavior above.

- [ ] **Step 8: Implement** `src/ui/explorer/RecordTab.tsx`

Behavior:
1. Load the schema.
2. Read rows with `{ columns: '*', filter: pk entries as eq filters, limit: 1 }`, where each value is `number` when the field category is `number`, else `String(value)`.
3. Show a header with the mart icon, mart title and `pk` values joined with `, `, plus a "Refresh" button.
4. The body is a two-column `<dl>` in schema order: `alias ?? name` (with the technical name in muted mono when an alias exists), then the value. Relationship fields render `CellValue` with a title lookup and a click target, as in the grid.
5. No row: "Record not found". Loading: Skeleton. Error: ErrorBox.

```tsx
import { RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { readRows } from '../../api/rows';
import type { Model, Schema } from '../../model/types';
import { clickTarget, relationshipColumns } from '../../records/relationships';
import { lookupTitles } from '../../records/titles';
import type { Row } from '../../sdk/types';
import { useServices, useStore, type Tab } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { MartIcon } from '../icons';
import { Skeleton } from '../Skeleton';
import { CellValue } from './CellValue';

export function RecordTab({ tab, model }: { tab: Extract<Tab, { kind: 'record' }>; model: Model }) {
  const { ctx, schemas } = useServices();
  const [, dispatch] = useStore();
  const mart = model.marts.get(tab.martId)!;
  const [version, setVersion] = useState(0);
  const [state, setState] = useState<{ schema: Schema | null; row: Row | null | undefined; error: unknown }>({ schema: null, row: undefined, error: null });
  const [titles, setTitles] = useState(new Map<string, string>());
  const [relSchemas, setRelSchemas] = useState(new Map<string, Schema>());
  const rels = useMemo(() => relationshipColumns(tab.martId, model.edges), [tab.martId, model.edges]);

  useEffect(() => {
    const ac = new AbortController();
    setState((s) => ({ ...s, row: undefined, error: null }));
    (async () => {
      const schema = await schemas.get(tab.martId);
      const filter = Object.entries(tab.pk).map(([column, v]) => {
        const isNum = schema.find((f) => f.name === column)?.category === 'number';
        return { column, operator: 'eq' as const, value: isNum ? Number(v) : String(v) };
      });
      const [row] = await readRows(ctx, tab.martId, { columns: '*', filter, limit: 1 }, { signal: ac.signal });
      setState({ schema, row: row ?? null, error: null });
      for (const rel of rels.values()) {
        const rs = await schemas.get(rel.relatedMartId);
        setRelSchemas((m) => new Map(m).set(rel.relatedMartId, rs));
        if (!row) continue;
        const t = await lookupTitles(ctx, rel, [row[rel.field]], rs, ac.signal);
        const title = t.get(String(row[rel.field]));
        if (title) setTitles((m) => new Map(m).set(rel.field, title));
      }
    })().catch((error) => { if (!ac.signal.aborted) setState((s) => ({ ...s, error })); });
    return () => ac.abort();
  }, [ctx, schemas, tab.martId, tab.pk, rels, version]);

  const header = (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <MartIcon icon={mart.icon} />
      <span className="font-semibold">{mart.title}</span>
      <span className="font-mono text-xs text-muted-foreground">{Object.values(tab.pk).map(String).join(', ')}</span>
      <div className="flex-1" />
      <button type="button" onClick={() => { setTitles(new Map()); setVersion((v) => v + 1); }} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><RefreshCw className="size-4" />Refresh</button>
    </div>
  );

  if (state.error) return <div className="flex h-full flex-col">{header}<div className="p-4"><ErrorBox error={state.error} onRetry={() => setVersion((v) => v + 1)} /></div></div>;
  if (state.row === undefined || !state.schema) return <div className="flex h-full flex-col">{header}<Skeleton rows={8} /></div>;
  if (state.row === null) return <div className="flex h-full flex-col">{header}<p className="p-4 text-sm text-muted-foreground">Record not found</p></div>;
  const row = state.row;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {header}
      <dl className="grid min-h-0 flex-1 grid-cols-[minmax(10rem,16rem)_1fr] content-start gap-x-4 gap-y-2 overflow-auto p-4 text-sm">
        {state.schema.map((f) => {
          const rel = rels.get(f.name);
          const target = rel ? clickTarget(rel, row, relSchemas.get(rel.relatedMartId) ?? []) : null;
          return (
            <div key={f.name} className="contents">
              <dt className="text-muted-foreground">{f.alias ?? f.name}{f.alias && <span className="ml-1 font-mono text-[11px]">{f.name}</span>}</dt>
              <dd className="min-w-0 break-words">
                <CellValue row={row} field={f.name} title={titles.get(f.name)}
                  onOpen={target ? () => dispatch(target.kind === 'record' ? { type: 'openRecord', martId: target.martId, pk: target.pk } : { type: 'openMart', martId: target.martId, filters: target.filters }) : undefined} />
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
```

`tab.pk` comes from the reducer and keeps its identity while the tab is open, so the effect does not loop.

- [ ] **Step 9: Implement** `src/ui/explorer/TabBar.tsx` and `src/ui/explorer/Explorer.tsx`

`TabBar.tsx`:
```tsx
import { X } from 'lucide-react';
import type { Model } from '../../model/types';
import { useStore } from '../../state/store';
import { MartIcon } from '../icons';

export function TabBar({ model }: { model: Model }) {
  const [state, dispatch] = useStore();
  return (
    <div role="tablist" className="flex overflow-x-auto border-b bg-muted/40">
      {state.tabs.map((t) => {
        const mart = model.marts.get(t.martId);
        const label = t.kind === 'mart' ? mart?.title ?? t.martId : `${mart?.title ?? t.martId}: ${Object.values(t.pk).map(String).join(', ')}`;
        const active = t.id === state.activeTabId;
        return (
          <div key={t.id} role="tab" aria-selected={active} onClick={() => dispatch({ type: 'activate', tabId: t.id })}
            className={`group relative flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r py-2 pl-3 pr-7 text-sm ${active ? 'bg-background font-medium' : 'text-muted-foreground hover:bg-background/60'}`}>
            <MartIcon icon={mart?.icon ?? null} className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
            <button type="button" aria-label={`Close ${label}`} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'close', tabId: t.id }); }}
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}
```

`Explorer.tsx` renders every tab and hides the inactive ones, so each tab keeps its state while open (spec, explore mode item 3):
```tsx
import type { Model } from '../../model/types';
import { useStore } from '../../state/store';
import { MartTab } from './MartTab';
import { RecordTab } from './RecordTab';
import { TabBar } from './TabBar';

export function Explorer({ model }: { model: Model }) {
  const [state] = useStore();
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TabBar model={model} />
      {state.tabs.map((t) => (
        <div key={t.id} role="tabpanel" hidden={t.id !== state.activeTabId} className="min-h-0 flex-1">
          {t.kind === 'mart' ? <MartTab tab={t} model={model} /> : <RecordTab tab={t} model={model} />}
        </div>
      ))}
    </div>
  );
}
```

Replace the placeholder in `App.tsx` as listed under Files.

- [ ] **Step 10: Failing integration test** `src/ui/explorer/Explorer.test.tsx`

```tsx
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMockCtx } from '../../sdk/mock/ctx';
import { demoFixtures } from '../../sdk/mock/fixtures';
import { AppServices, StoreProvider } from '../../state/store';
import { App } from '../App';

async function openOrders() {
  render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
  await userEvent.click(await screen.findByText('Orders'));
  const panel = await screen.findByRole('tabpanel');
  await within(panel).findByRole('table');
  return panel;
}

test('mart tab shows the first 5 columns and 200 rows with load more', async () => {
  const panel = await openOrders();
  const headers = within(panel).getAllByRole('columnheader').map((h) => h.textContent);
  expect(headers).toHaveLength(5);
  expect(within(panel).getAllByRole('row')).toHaveLength(201); // header + 200
  await userEvent.click(within(panel).getByRole('button', { name: 'Load more' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(401));
});

test('relationship column shows the customer name and opens the customer record', async () => {
  const panel = await openOrders();
  const nameCell = await waitFor(() => {
    const c = within(panel).getAllByRole('cell').find((x) => /^[A-Z][a-z]+ [A-Z][a-z]+$/.test(x.textContent ?? ''));
    expect(c).toBeDefined();
    return c!;
  });
  await userEvent.click(within(nameCell).getByRole('button'));
  const tabs = screen.getAllByRole('tab');
  expect(tabs.at(-1)!.textContent).toMatch(/^Customers: \d+/);
});

test('filter then reset', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByLabelText('Filter id'));
  await userEvent.selectOptions(screen.getByLabelText('Operator'), 'lte');
  await userEvent.type(screen.getByLabelText('Value'), '3');
  await userEvent.click(screen.getByRole('button', { name: 'Apply' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(4));
  await userEvent.click(within(panel).getByRole('button', { name: 'Reset' }));
  await waitFor(() => expect(within(panel).getAllByRole('row')).toHaveLength(201));
});

test('column picker adds a column', async () => {
  const panel = await openOrders();
  await userEvent.click(within(panel).getByRole('button', { name: /Columns \(5\/8\)/ }));
  await userEvent.click(screen.getByLabelText(/amount/i));
  await waitFor(() => expect(within(panel).getAllByRole('columnheader')).toHaveLength(6));
});

test('a mart without a primary key is preview only', async () => {
  render(<AppServices ctx={createMockCtx(demoFixtures())}><StoreProvider><App /></StoreProvider></AppServices>);
  await userEvent.type(await screen.findByLabelText('Search data marts'), 'daily');
  await userEvent.click(await screen.findByText('Daily KPIs'));
  expect(await screen.findByText('Preview only: this data mart has no primary key.')).toBeInTheDocument();
});

test('closing the last tab returns to the full canvas', async () => {
  await openOrders();
  await userEvent.click(screen.getByLabelText(/^Close Orders/));
  await waitFor(() => expect(screen.queryByTestId('explorer')).toBeNull());
});
```

The regex relies on the Task 3 naming rule: only customer names look like "First Last".

Fixture titles used here: `Orders`, `Customers`, `Daily KPIs`. Check that Task 3 used these titles.

Run: `npx vitest run src/ui` → PASS.

- [ ] **Step 11: Manual check in mock mode**

Start `npx vite --port 5173` in the background. With Playwright at `http://localhost:5173/?mock`:
1. Click Orders, then screenshot `tmp/task9-mart.png`.
2. Click a customer name, then screenshot `tmp/task9-record.png`.

Look at both: the canvas column is one card wide, tabs have close buttons, and customer names show instead of ids. Stop the server.

- [ ] **Step 12: Commit**

```bash
git add -A && git commit -m "feat: add explorer tabs with data grid, filters, column picker and record view"
```

---

### Task 10: End-to-end smoke tests and docs

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: the whole app in `?mock` mode.

- [ ] **Step 1: `playwright.config.ts`**

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  workers: 4,
  use: { baseURL: 'http://localhost:4173', trace: 'off', viewport: { width: 1440, height: 900 } },
  webServer: { command: 'npx vite build && npx vite preview --port 4173 --strictPort', port: 4173, reuseExistingServer: true, timeout: 120_000 },
});
```

- [ ] **Step 2: Write** `e2e/smoke.spec.ts`

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

test('default focus, badges and icons render', async ({ page }) => {
  await expect(page.getByText('Orders', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Data quality: Passed').first()).toBeVisible();
  await expect(page.getByLabel('Open in OWOX').first()).toBeVisible();
});

test('search narrows the canvas', async ({ page }) => {
  await page.getByLabel('Search data marts').fill('campaign');
  await expect(page.getByText('Campaigns', { exact: true })).toBeVisible();
  await expect(page.getByText('Orders', { exact: true })).toHaveCount(0);
});

test('explore, filter, reset, columns, record', async ({ page }) => {
  await page.getByText('Orders', { exact: true }).click();
  const panel = page.getByRole('tabpanel');
  await expect(panel.getByRole('row')).toHaveCount(201);
  await panel.getByLabel('Filter id').click();
  await page.getByLabel('Operator').selectOption('lte');
  await page.getByLabel('Value').fill('3');
  await page.getByRole('button', { name: 'Apply' }).click();
  await expect(panel.getByRole('row')).toHaveCount(4);
  await panel.getByRole('button', { name: 'Reset' }).click();
  await expect(panel.getByRole('row')).toHaveCount(201);
  await panel.getByRole('button', { name: /Columns/ }).click();
  await page.getByLabel(/amount/i).check();
  await expect(panel.getByRole('columnheader')).toHaveCount(6);
  await page.keyboard.press('Escape');
  await panel.getByRole('row').nth(1).click();
  await expect(page.getByRole('tab').last()).toHaveText(/^Orders: 1/);
  await page.screenshot({ path: 'tmp/e2e-record.png' });
});
```

- [ ] **Step 3: Run**

Run: `npx playwright test --workers=4 --trace off`
Expected: 3 passed. If Chromium does not launch, add `launchOptions: { executablePath: '/opt/pw-browsers/chromium' }` under `use` and rerun. Do not run `playwright install`.

- [ ] **Step 4: README**

Add a "Limitations (v1)" section:
1. Read-only.
2. Row counts are warehouse queries cached per member. Refresh recounts them.
3. "Load more" re-reads from the start, because the API has no offset.
4. A relationship title is looked up only for single-field relationships.
5. The OWOX link always points to app.owox.com.

- [ ] **Step 5: Full verification and commit**

Run: `npx vitest run && npx tsc -b && npx eslint . && npx vite build && npx playwright test --workers=4 --trace off`
Expected: all green.

```bash
git add -A && git commit -m "test: add Playwright smoke tests in mock mode and document v1 limits"
```

---

## Self-review notes

1. **Spec coverage.**
   1. Canvas focus, levels, selection, filters and search: Task 4 and Task 8.
   2. Card contents, including the link left of (i): Task 7.
   3. Header: Task 8.
   4. Explore layout, tabs, close and preloader: Task 8 and Task 9.
   5. Filters per type: Task 5 and Task 9.
   6. Reset and Refresh: Task 9 (tab) and Task 8 (model).
   7. Column picker defaulting to 5: Task 9.
   8. Relationship titles and click behavior: Task 6 and Task 9.
   9. Record tab and preview-only banner: Task 9.
   10. Errors per area: Tasks 7–9.
   11. Mock mode: Task 3.
   12. Delivery: Task 1.
2. **Deviation from the spec.** Relationship columns come from outgoing edges only. On an incoming edge, the target field is usually this mart's own primary key, and the related side is many rows, so there is no single title to show. Task 6 tests this.
3. **Hidden-for-reporting fields** are dropped at schema load (Task 2), so a hidden primary key makes a mart preview only (Review focus 1).
