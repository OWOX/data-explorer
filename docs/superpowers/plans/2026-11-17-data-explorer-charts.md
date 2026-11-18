# Data Explorer Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `Table | Charts` switch in the Data band; Charts draws scorecards (with sparklines), a time-series bar chart and a pie from backend-only `traverseData` queries under the grid's own headers and filters.

**Architecture:** Pure modules in `src/charts/` classify fields, build queries and resolve saved settings. A hook reads queries through `readRows` with an in-memory cache. SVG components draw. `MartGrid` keeps its `<thead>` and swaps `<tbody>` for `ChartsBody` when `GridState.view === 'charts'`.

**Tech Stack:** React 19, TypeScript, Tailwind 4, Vitest + Testing Library, Playwright, lucide-react. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-17-data-explorer-charts-design.md`

## Global Constraints

1. No new npm dependency. Charts are hand-written SVG.
2. No arithmetic on data values in the plugin: every value text on screen comes from a query row. Ratios for drawing only.
3. Vitest runs capped: `npx vitest run --poolOptions.threads.maxThreads=4 <path>`. Playwright: `npm run e2e -- --trace off` (already `--workers=1`).
4. Stack and pie caps: 8 values plus "Other" from a `not_in` query. Auto bucket: ≤ 60 buckets.
5. New member collection `charts`; doc id = main mart id.
6. Copy rules: unslop (no em-dash in new prose, plain words). Comments explain why, as the codebase does.
7. Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A joined mart's metric or date field (blended name with `__`): its scorecard sits in that mart's group cell and its unique count key is `<alias_path>__unique_count`. Test in Task 3 and Task 8.
2. A grid already grouped by the member (Σ on a column, bucket on a date): Charts uses that Σ function and ignores grid sorts/limit. Test in Task 2.
3. A dimension with blank values: excluded with `is_not_blank`, note shown. Test in Task 3.
4. Only one bucket of data (min = max date) or no rows: auto bucket is DAY; charts show "No rows match the filters." instead of an empty axis. Test in Task 2 and Task 7.
5. Saved settings naming a column no longer shown: falls back, does not rewrite the doc. Test in Task 4.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/sdk/mock/ctx.ts`, `src/sdk/mock/aggregate.ts` | Mock `uniqueCount` per source, with grouping |
| `src/charts/fields.ts` | `chartFields()`: metrics, dimensions, dates per mart; `pickBucket()` |
| `src/charts/queries.ts` | Pure query builders and output keys |
| `src/charts/settings.ts` | `ChartSettings` type, `resolveCharts()` |
| `src/api/chart-settings.ts` | Read/write the `charts` collection |
| `src/charts/useChartQuery.ts` | Cached, abortable query hook |
| `src/charts/svg/*.tsx` | `Sparkline`, `BarChart`, `PieChart` |
| `src/charts/ChartPanel.tsx`, `ChartMenu.tsx`, `Scorecards.tsx`, `ChartsBody.tsx` | Panels, menus, scorecard strip, layout |
| `src/charts/charts.css` | Series tokens and chart styles |
| `src/state/store.tsx`, `src/state/view-link.ts`, `src/ui/bands/DataBand.tsx`, `src/ui/explorer/MartGrid.tsx`, `src/ui/explorer/ColumnMenu.tsx` | Mode switch and integration |

---

### Task 1: Mock SDK supports per-source unique counts with grouping

**Files:**
- Modify: `src/sdk/mock/ctx.ts` (the `if (o.uniqueCount) return [{ 'Unique Count': rows.length }]` line in `traverse`)
- Modify: `src/sdk/mock/aggregate.ts` (`aggregateRows`)
- Test: `src/sdk/mock/ctx.test.ts`, `src/sdk/mock/aggregate.test.ts`

**Interfaces:**
- Produces: mock `traverseData` honouring `uniqueCount: string[]` (`''` = main mart PK, alias path = joined mart PK), alone or with `column`/`aggregation`/`dateTrunc`. Keys: `Unique Count`, `<aliasPath with . → _>__unique_count`.

- [ ] **Step 1: Write failing tests** in `src/sdk/mock/ctx.test.ts`, using the demo fixtures already used there (find a mart with a PK and a joined mart via `joinTree`; read the existing tests for the setup helper):

```ts
it('uniqueCount with grouping counts distinct primary keys per group', async () => {
  const ctx = mockCtx(); // the helper the file already uses
  const rows = await read(ctx, ORDERS_ID, { column: ['order_date'], dateTrunc: [{ column: 'order_date', unit: 'YEAR' }], uniqueCount: [''] });
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(typeof r['Unique Count']).toBe('number');
});
it('uniqueCount names a joined source by its alias path', async () => {
  const rows = await read(mockCtx(), ORDERS_ID, { uniqueCount: ['', CUSTOMERS_PATH] });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveProperty('Unique Count');
  expect(rows[0]).toHaveProperty(`${CUSTOMERS_PATH.replace(/\./g, '_')}__unique_count`);
});
```

Replace `ORDERS_ID`, `CUSTOMERS_PATH`, `read`, `mockCtx` with the identifiers the test file and fixtures already define (grep `demoFixtures` and `aliasPath`).

- [ ] **Step 2: Run** `npx vitest run --poolOptions.threads.maxThreads=4 src/sdk/mock` → FAIL.

- [ ] **Step 3: Implement.** In `traverse`: compute, per uniqueCount source, the PK field names (main: `m.fields.filter(f => f.isPrimaryKey)`; joined: the hop's mart PKs blended with `blendedName(aliasPath, pk)`), add those names to `wanted` so their values are on each row. Then:
  1. No `column`: return one row with each source's distinct count of the JSON of its PK tuple (ignoring rows whose PK is all null).
  2. With `column`: call `aggregateRows(rows, column, aggregation, dateTrunc, sort, uniq)` where `uniq: { key: string; pk: string[] }[]`, and in `aggregateRows` add, per group, `key → new Set(members.map(r => JSON.stringify(pk.map(k => r[k])))).size`. A sort rule may name the key.
- [ ] **Step 4: Run** the tests → PASS. Run the whole mock folder again → PASS.
- [ ] **Step 5: Commit** `Mock: uniqueCount per source, with grouping`.

---

### Task 2: Chart fields and auto bucket

**Files:**
- Create: `src/charts/fields.ts`
- Test: `src/charts/fields.test.ts`

**Interfaces:**
- Consumes: `Field` (`src/model/types.ts`), `Aggregation`, `allowedFunctions`, `canBucket`, `AggFn`, `DateBucket` (`src/model/aggregation.ts`).
- Produces:

```ts
export type Metric = { field: Field; fn: AggFn; martId: string };
export type ChartMart = { martId: string; aliasPath: string; hasPk: boolean; metrics: Metric[]; dates: Field[]; dimensions: Field[] };
export type ChartFields = { marts: ChartMart[]; metrics: Metric[]; dimensions: Field[]; dates: Field[] };
/** `shown` is the grid's shown column names in grid order; `schema` the blended schema; `mainMartId` the grid's mart. */
export function chartFields(schema: Field[], shown: string[], agg: Aggregation, mainMartId: string, groupOrder: string[]): ChartFields;
/** The smallest bucket giving at most 60 buckets between two ISO dates or timestamps; DAY when either is missing or unparsable. */
export function pickBucket(min: unknown, max: unknown): DateBucket;
export const MAX_BUCKETS = 60;
```

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { chartFields, pickBucket } from './fields';
import type { Field } from '../model/types';
import { NO_AGGREGATION } from '../model/aggregation';

const f = (name: string, category: Field['category'], extra: Partial<Field> = {}): Field => ({ name, alias: null, type: category === 'number' ? 'FLOAT' : category === 'date' ? 'DATE' : 'STRING', category, description: null, isPrimaryKey: false, ...extra });
const schema = [
  f('id', 'string', { isPrimaryKey: true }), f('date', 'date'), f('amount', 'number'), f('qty', 'number'), f('channel', 'string'),
  f('c__city', 'string', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } }),
  f('calc', 'number', { isCalculated: true }),
];

describe('chartFields', () => {
  it('classifies shown fields per mart, in group order', () => {
    const r = chartFields(schema, ['id', 'date', 'amount', 'channel', 'c__city', 'c__ltv', 'calc'], NO_AGGREGATION, 'M', ['M', 'C']);
    expect(r.marts.map((m) => m.martId)).toEqual(['M', 'C']);
    expect(r.marts[0]!.hasPk).toBe(true);
    expect(r.marts[0]!.metrics.map((m) => [m.field.name, m.fn])).toEqual([['amount', 'SUM']]);
    expect(r.marts[1]!.metrics.map((m) => m.field.name)).toEqual(['c__ltv']);
    expect(r.marts[1]!.aliasPath).toBe('c');
    expect(r.dimensions.map((d) => d.name)).toEqual(['channel', 'c__city']);
    expect(r.dates.map((d) => d.name)).toEqual(['date']);
  });
  it('uses the grid Σ function of a column', () => {
    const r = chartFields(schema, ['amount'], { aggregations: [{ column: 'amount', function: 'AVG' }, { column: 'amount', function: 'MAX' }], dateTrunc: [] }, 'M', ['M']);
    expect(r.metrics[0]!.fn).toBe('AVG');
  });
  it('falls back to the first allowed function when SUM is not allowed', () => {
    const r = chartFields([f('x', 'number', { allowedAggregations: ['MAX', 'MIN'] })], ['x'], NO_AGGREGATION, 'M', ['M']);
    expect(r.metrics[0]!.fn).toBe('MIN'); // AGGREGATE_FUNCTIONS order
  });
  it('a joined mart with a primary key is hasPk', () => {
    const s = [...schema, f('c__id', 'string', { isPrimaryKey: true, joined: { martId: 'C', label: 'Customers', aliasPath: 'c' } })];
    expect(chartFields(s, ['c__ltv'], NO_AGGREGATION, 'M', ['M', 'C']).marts.find((m) => m.martId === 'C')!.hasPk).toBe(true);
  });
});

describe('pickBucket', () => {
  it.each([
    ['2026-01-01', '2026-02-15', 'DAY'],
    ['2026-01-01', '2026-10-01', 'WEEK'],
    ['2022-01-01', '2026-01-01', 'MONTH'],
    ['2015-01-01', '2026-01-01', 'QUARTER'],
    ['1900-01-01', '2026-01-01', 'YEAR'],
    ['2026-01-01', '2026-01-01', 'DAY'],
    [null, '2026-01-01', 'DAY'],
    ['2026-01-01T10:00:00Z', '2026-01-20T10:00:00Z', 'DAY'],
  ])('%s..%s → %s', (a, b, want) => expect(pickBucket(a, b)).toBe(want));
});
```

Note on `hasPk` for a joined mart: the blended schema only carries joined fields the member can see; when the joined PK is not in the blended schema, `hasPk` is false and no Records card shows for that mart.

- [ ] **Step 2: Run** → FAIL (module missing).
- [ ] **Step 3: Implement**

```ts
// Which shown columns the charts draw: metrics (numbers), dimensions (text, booleans) and dates, grouped by the data mart they belong to.
import { AGGREGATE_FUNCTIONS, allowedFunctions, canBucket, type AggFn, type Aggregation, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';

export type Metric = { field: Field; fn: AggFn; martId: string };
export type ChartMart = { martId: string; aliasPath: string; hasPk: boolean; metrics: Metric[]; dates: Field[]; dimensions: Field[] };
export type ChartFields = { marts: ChartMart[]; metrics: Metric[]; dimensions: Field[]; dates: Field[] };
export const MAX_BUCKETS = 60;

const martOf = (f: Field, main: string) => f.joined?.martId ?? main;

function metricFn(f: Field, agg: Aggregation): AggFn | null {
  const allowed = allowedFunctions(f);
  const chosen = agg.aggregations.find((r) => r.column === f.name && allowed.includes(r.function));
  if (chosen) return chosen.function;
  if (allowed.includes('SUM')) return 'SUM';
  return AGGREGATE_FUNCTIONS.find((fn) => allowed.includes(fn)) ?? null;
}

export function chartFields(schema: Field[], shown: string[], agg: Aggregation, mainMartId: string, groupOrder: string[]): ChartFields {
  const by = new Map(schema.map((f) => [f.name, f]));
  const fields = shown.flatMap((n) => by.get(n) ?? []);
  const marts = groupOrder.map((martId): ChartMart => {
    const own = fields.filter((f) => martOf(f, mainMartId) === martId);
    const aliasPath = martId === mainMartId ? '' : (schema.find((f) => f.joined?.martId === martId)?.joined?.aliasPath ?? '');
    const hasPk = schema.some((f) => f.isPrimaryKey && martOf(f, mainMartId) === martId);
    const metrics = own.flatMap((f): Metric[] => {
      if (f.category !== 'number' || f.isPrimaryKey || f.isCalculated) return [];
      const fn = metricFn(f, agg);
      return fn ? [{ field: f, fn, martId }] : [];
    });
    return { martId, aliasPath, hasPk, metrics, dates: own.filter((f) => canBucket(f)), dimensions: own.filter((f) => (f.category === 'string' || f.category === 'boolean') && !f.isPrimaryKey) };
  });
  return { marts, metrics: marts.flatMap((m) => m.metrics), dimensions: marts.flatMap((m) => m.dimensions), dates: marts.flatMap((m) => m.dates) };
}

const DAY_MS = 86_400_000;
const SPAN_DAYS: [DateBucket, number][] = [['DAY', 1], ['WEEK', 7], ['MONTH', 30.44], ['QUARTER', 91.31], ['YEAR', 365.25]];

export function pickBucket(min: unknown, max: unknown): DateBucket {
  const a = Date.parse(String(min ?? ''));
  const b = Date.parse(String(max ?? ''));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 'DAY';
  // Only to choose a bucket: no value derived here is shown.
  const days = Math.abs(b - a) / DAY_MS + 1;
  return SPAN_DAYS.find(([, d]) => days / d <= MAX_BUCKETS)?.[0] ?? 'YEAR';
}
```

- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `Charts: field classification and auto bucket`.

---

### Task 3: Query builders

**Files:**
- Create: `src/charts/queries.ts`
- Test: `src/charts/queries.test.ts`

**Interfaces:**
- Consumes: `ChartMart`, `Metric` (Task 2); `TraverseFilter`, `TraverseOptions` (`src/sdk/types.ts`); `aggregatedKey`, `DateBucket`.
- Produces:

```ts
export const TOP_N = 8;
export const metricKey: (m: Metric) => string;                          // aggregatedKey(m.field.name, m.fn)
export const uniqueKey: (aliasPath: string) => string;                  // '' → 'Unique Count', 'a.b' → 'a_b__unique_count'
export function scorecardsQuery(marts: ChartMart[], filter: TraverseFilter[]): TraverseOptions | null;   // null: nothing to count
export function rangeQuery(date: Field, filter: TraverseFilter[]): TraverseOptions;                      // MIN, MAX
export const rangeKeys: (date: Field) => { min: string; max: string };
export function sparklineQuery(mart: ChartMart, date: Field, bucket: DateBucket, filter: TraverseFilter[]): TraverseOptions | null;
export function topValuesQuery(dim: Field, metric: Metric, filter: TraverseFilter[]): TraverseOptions;
export function seriesQuery(date: Field, bucket: DateBucket, metric: Metric, filter: TraverseFilter[], stack?: { dim: Field; top: string[] }): TraverseOptions;
export function seriesOtherQuery(date: Field, bucket: DateBucket, metric: Metric, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions;
export function pieOtherQuery(metric: Metric, filter: TraverseFilter[], dim: Field, top: string[]): TraverseOptions;
```

Date fields on DATE/DATETIME/TIMESTAMP: a `dateTrunc` rule carries `timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone` only when `canZone(field)` and the zone passes `isTimeZone` (same rule the grid uses).

- [ ] **Step 1: Write failing tests** (reuse `f()` from Task 2's test, copy it in):

```ts
const amount: Metric = { field: f('amount', 'number'), fn: 'SUM', martId: 'M' };
const ltv: Metric = { field: f('c__ltv', 'number', { joined: { martId: 'C', label: 'Customers', aliasPath: 'c.x' } }), fn: 'AVG', martId: 'C' };
const date = f('date', 'date');
const channel = f('channel', 'string');
const flt = [{ column: 'channel', operator: 'eq' as const, value: 'web' }];
const main: ChartMart = { martId: 'M', aliasPath: '', hasPk: true, metrics: [amount], dates: [date], dimensions: [channel] };
const cust: ChartMart = { martId: 'C', aliasPath: 'c.x', hasPk: true, metrics: [ltv], dates: [], dimensions: [] };

it('scorecards: all metrics and a unique count per mart with a key', () => {
  expect(scorecardsQuery([main, cust], flt)).toEqual({ column: ['amount', 'c__ltv'], aggregation: [{ column: 'amount', function: 'SUM' }, { column: 'c__ltv', function: 'AVG' }], uniqueCount: ['', 'c.x'], filter: flt });
  expect(uniqueKey('c.x')).toBe('c_x__unique_count');
  expect(uniqueKey('')).toBe('Unique Count');
});
it('scorecards: unique count alone when no metric; null when nothing', () => {
  expect(scorecardsQuery([{ ...main, metrics: [] }], [])).toEqual({ uniqueCount: [''] });
  expect(scorecardsQuery([{ ...main, metrics: [], hasPk: false }], [])).toBeNull();
});
it('top values: blank excluded, metric desc, 8', () => {
  expect(topValuesQuery(channel, amount, [])).toEqual({ column: ['channel', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }], filter: [{ column: 'channel', operator: 'is_not_blank' }], sort: [{ column: 'amount', direction: 'desc' }], limit: 8 });
});
it('series stacked: in top values; other: not_in', () => {
  const s = seriesQuery(date, 'MONTH', amount, flt, { dim: channel, top: ['a', 'b'] });
  expect(s.column).toEqual(['date', 'channel', 'amount']);
  expect(s.filter).toEqual([...flt, { column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'in', value: ['a', 'b'] }]);
  expect(s.sort).toEqual([{ column: 'date', direction: 'asc' }]);
  expect(s.dateTrunc?.[0]).toMatchObject({ column: 'date', unit: 'MONTH' });
  const o = seriesOtherQuery(date, 'MONTH', amount, flt, channel, ['a', 'b']);
  expect(o.column).toEqual(['date', 'amount']);
  expect(o.filter?.at(-1)).toEqual({ column: 'channel', operator: 'not_in', value: ['a', 'b'] });
});
it('sparklines: the mart’s metrics and its unique count by bucket', () => {
  expect(sparklineQuery(cust, date, 'DAY', [])).toMatchObject({ column: ['date', 'c__ltv'], uniqueCount: ['c.x'], sort: [{ column: 'date', direction: 'asc' }] });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the functions exactly per the signatures; omit `filter` when the list is empty (as `buildGroupedQuery` does). A boolean dimension's `top` values are sent as strings. **Step 4: Run** → PASS. **Step 5: Commit** `Charts: query builders`.

---

### Task 4: Saved chart settings

**Files:**
- Create: `src/charts/settings.ts`, `src/api/chart-settings.ts`
- Modify: `plugin.json` (add `{ "name": "charts", "scope": "member" }`), `src/state/store.tsx` (`Services` gets `chartSettings: ChartSettingsStore`, built in `AppServices`)
- Test: `src/charts/settings.test.ts`, `src/api/chart-settings.test.ts`

**Interfaces:**

```ts
// src/charts/settings.ts
export type Orientation = 'vertical' | 'horizontal';
export type ChartSettings = {
  scorecards?: { hidden?: string[]; sparklines?: boolean };
  timeSeries?: { date?: string; bucket?: DateBucket | 'AUTO'; metric?: string; stack?: string | null; orientation?: Orientation };
  pie?: { metric?: string; dimension?: string };
};
export type ResolvedCharts = {
  hidden: Set<string>; sparklines: boolean;
  date: Field | null; bucket: DateBucket | 'AUTO'; metric: Metric | null; stack: Field | null; orientation: Orientation;
  pieMetric: Metric | null; pieDimension: Field | null;
};
export const recordsCardId: (martId: string) => string;   // `records:${martId}`
export function resolveCharts(s: ChartSettings, cf: ChartFields): ResolvedCharts;
// src/api/chart-settings.ts
export const CHARTS_COLLECTION = 'charts';
export interface ChartSettingsStore { load(martId: string): Promise<ChartSettings>; save(martId: string, s: ChartSettings): void }
export function createChartSettings(ctx: Ctx): ChartSettingsStore;
```

- [ ] **Step 1: Failing tests.** `resolveCharts`: defaults (first date, AUTO, first metric, stack null, vertical, sparklines true, pie = first metric × first dimension); saved names that are shown are used; a saved `stack` of a hidden column → null; a saved `metric` not shown → first metric; `bucket: 'WEEK'` kept; invalid orientation → vertical. `createChartSettings` with `stubCtx` (`src/api/test-ctx.ts`; read `src/api/preferences.test.ts` for how collections are stubbed): `load` returns `{}` on missing doc and on throw; `load` drops non-object parts; `save` does one `put(martId, settings)` and swallows a rejection with `console.warn`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement**, modelled on `src/api/preferences.ts`. `resolveCharts` does not touch storage, so a fallback never rewrites the doc. **Step 4: Run** → PASS, plus `npx vitest run --poolOptions.threads.maxThreads=4 src/api src/state` to catch `Services` typing in tests that build services by hand (grep `AppServices` / `Services` in tests and add the new member where a literal is built). **Step 5: Commit** `Charts: member settings in the charts collection`.

---

### Task 5: View mode in grid state, view link, the switch

**Files:**
- Modify: `src/state/store.tsx` (`GridState` gets `view?: 'charts'`)
- Modify: `src/state/view-link.ts` (`g.vw?: 1` encode/decode)
- Modify: `src/ui/explorer/MartGrid.tsx` (`stable()` includes `view`; `Grid` keeps `view` state, adopts it from `seed.saved`, includes it in `onChange` but **not** in `columnStore` writes)
- Modify: `src/ui/bands/DataBand.tsx` (the switch in `afterHint`)
- Create: `src/ui/bands/ViewSwitch.tsx`
- Test: `src/state/view-link.test.ts` (existing), `src/ui/bands/view-switch.test.tsx`

**Interfaces:**
- Produces: `GridState.view?: 'charts'`; `ViewSwitch({ value: 'table' | 'charts', onChange })`; `MartGrid` exposes the mode to its body as `view` (used in Task 8).

- [ ] **Step 1: Failing tests.**
  1. view link round trip: a grid with `view: 'charts'` decodes with `view: 'charts'`; one without has no `view` key; `vw: 2` or `vw: 'x'` is ignored and counted in `dropped`.
  2. `view-switch.test.tsx` (copy the page render helper from `src/ui/bands/page.test.tsx` or `undo-grid.test.tsx`): a mart opens on Table (`radio` "Table" checked); clicking "Charts" checks it and `aria-checked` flips; Undo (the page header button) brings Table back; the grid-columns collection receives no `view` field (assert on the stub's `put` calls).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
  1. `ViewSwitch`: `<div role="radiogroup" aria-label="Show data as" className="dm-seg">` with two `<button role="radio" aria-checked>`: `Table2` "Table", `ChartColumn` "Charts". Arrow keys move between them. CSS `.dm-seg` in `src/ui/bands/bands.css`: 28px tall, 1px border, 6px radius, the checked button `bg-accent`.
  2. `DataBand`: `const view = grids[gridMart.id]?.view === 'charts' ? 'charts' : 'table'`; `onChange={(v) => dispatch({ type: 'editGrid', martId: id, grid: { ...grids[id]!, view: v === 'charts' ? 'charts' : undefined } })}`, rendered only when the grid has a saved state (it always has one after its first `saveGrid`). Strip `undefined` keys before dispatch so `deepEqual` is stable: build the object with a spread that omits `view` for table.
  3. `MartGrid` `stable()`: append `g.view ?? 'table'`. In the seed adoption block also `setView(saved.view)`. The `onChange` payload adds `...(view ? { view } : {})`.
- [ ] **Step 4: Run** the two tests, then `npx vitest run --poolOptions.threads.maxThreads=4 src/ui src/state` → PASS.
- [ ] **Step 5: Commit** `Data band: Table / Charts switch in the grid state and the view link`.

---

### Task 6: Chart query hook

**Files:**
- Create: `src/charts/useChartQuery.ts`
- Test: `src/charts/useChartQuery.test.tsx`

**Interfaces:**

```ts
export type ChartResult = { rows: Row[] | null; error: unknown; loading: boolean; retry: () => void };
/** null options: nothing runs and rows stay null. The cache is per AppServices ctx (a WeakMap keyed by ctx). */
export function useChartQuery(martId: string, options: TraverseOptions | null, version: number): ChartResult;
```

- [ ] **Step 1: Failing tests** with `renderHook` inside `AppServices` with a `stubCtx` whose `traverseData` is a `vi.fn` returning `traversalOf(rows)`:
  1. returns rows; a second hook with an equal options object does not call `traverseData` again (cache);
  2. a version bump re-reads;
  3. options change while loading → the first traversal's `cancel` is called, and only the second result is shown;
  4. an error shows `error`, `retry()` re-reads (the failed entry is not cached);
  5. `null` options → no call.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** with `readRows(ctx, martId, options, { signal })` and an `AbortController` per effect; cache key `${martId}:${version}:${JSON.stringify(options)}`; the cache holds resolved rows only. **Step 4: Run** → PASS. **Step 5: Commit** `Charts: cached, abortable query hook`.

---

### Task 7: SVG charts and the panel

**Files:**
- Create: `src/charts/svg/Sparkline.tsx`, `src/charts/svg/BarChart.tsx`, `src/charts/svg/PieChart.tsx`, `src/charts/ChartPanel.tsx`, `src/charts/charts.css` (import it from `src/styles.css` the way `bands.css` is imported)
- Test: `src/charts/svg/charts.test.tsx`

Read `/Users/flakss/.claude-owox.com-personal/plugins/cache/*/dataviz/**/SKILL.md` (find it with `ls`) and its `references/palette.md` before choosing colours; take 8 categorical colours plus a neutral for "Other" from there, defined as `--dm-series-1..9` on `:root` with dark-mode values under `@media (prefers-color-scheme: dark)` and the app's dark selector (grep `dark` in `src/styles.css` for the selector it uses).

**Interfaces:**

```ts
export type Point = { x: string; y: number | null; label: string; valueText: string };            // x = bucket start, label = formatted bucket
export function Sparkline(props: { points: Point[]; ariaLabel: string }): JSX.Element;          // 100% width, 28px tall, no axes
export type Series = { name: string; color: string; points: Point[] };                          // same x list across series
export function BarChart(props: { series: Series[]; orientation: 'vertical' | 'horizontal'; ariaLabel: string; formatTick: (n: number) => string }): JSX.Element;
export type Slice = { name: string; value: number; valueText: string; color: string };
export function PieChart(props: { slices: Slice[]; ariaLabel: string }): JSX.Element;
export function ChartPanel(props: { title: string; actions?: ReactNode; loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode }): JSX.Element;
```

Rules (from the spec):
1. Width from a `ResizeObserver` on the wrapper (jsdom: fall back to 600). Vertical bars: 240px plot height, value axis 4 ticks from 0 to the largest stacked total of returned values (`Math.max` over per-x sums is a drawing scale, not a shown value; tick labels use `formatTick`). Horizontal: 20px per x, labels on the left, oldest at the top.
2. Bucket labels thinned so no two overlap (keep every k-th).
3. Each bar segment and slice is wrapped in the codebase `Tooltip` with `name · label: valueText` and the share in percent (`Math.round(value / total * 100)`) for slices.
4. Legend (swatch + name) under the bar chart when `series.length > 1`, beside the pie.
5. `<svg role="img" aria-label={ariaLabel}>`, plus a `sr-only` `<table>` listing every point or slice.
6. `ChartPanel`: `<section className="dm-chart">` with a header row (title left, `actions` right), a `Skeleton` while loading with no rows, `ErrorBox` with `onRetry`, `empty` text when set, `note` in muted small text under the chart.

- [ ] **Step 1: Failing tests**: Sparkline renders one path with `aria-label`; BarChart with 2 series × 3 x renders 6 `rect[data-series]`, horizontal flips (`data-orientation="horizontal"` on the svg, rects with `height` = 20 - gap); null y renders no rect; PieChart with 3 slices renders 3 `path[data-slice]` and a single slice of 100% renders a `circle`; sr-only table holds the `valueText`s; ChartPanel shows the ErrorBox and Retry calls `onRetry`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS. **Step 5: Commit** `Charts: SVG sparkline, bar and pie, and the chart panel`.

---

### Task 8: Charts body in the grid (scorecards, time series, pie, menus)

**Files:**
- Create: `src/charts/ChartsBody.tsx`, `src/charts/Scorecards.tsx`, `src/charts/ChartMenu.tsx`
- Modify: `src/ui/explorer/MartGrid.tsx` (in Charts mode: `SortTitle` renders the non-sortable title, `ColumnControls` hides sort items, `<tbody>` becomes `<ChartsBody>`; the Load more button and row selection are off), `src/ui/explorer/ColumnMenu.tsx` (`ColumnMenuEnv.sortable?: boolean`, default true; when false the sort row and sort mark are not rendered)
- Test: `src/charts/charts-body.test.tsx`

**Interfaces:**
- Consumes: everything above. `MartGrid` passes: `martId`, `schema` (blended), `shown`, `aggNow`, `filters` (`toTraverseFilters(schema, Object.values(filters))`), `groups` (the `groups` memo: `{ id, span, title }[]`), `version`, `paused || !!blocked`, `formatOf` (column format resolver as the cells use it), `hasFilters`.
- Produces: `export function ChartsBody(props: { martId: string; schema: Schema; shown: string[]; agg: Aggregation; filter: TraverseFilter[]; groups: { id: string; span: number; title: string }[]; version: number; paused: boolean; hasFilters: boolean; formatOf: (column: string, type: string) => Format }): JSX.Element` that renders a `<tbody>`.

Layout inside `<tbody>`:
1. Row 1: the gutter `<th>` (`Gutter`), then one `<td colSpan={g.span} data-chart-group={g.id}>` per group with `<Scorecards>` (flex-wrap, `gap-2`, card `min-w-[9rem] flex-1`), then the fill `<td>`. The strip's ⋮ sits at the end of the main group's cell.
2. Row 2: `<td colSpan={outputs+2}>` holding a `sticky left-0` div of width = the scroller's client width (pass a ref-measured width) with the time-series panel, then the pie panel.

Behaviour:
1. `cf = chartFields(schema, shown, agg, martId, groups.map(g => g.id))`; `settings` loaded once from `useServices().chartSettings.load(martId)`; `r = resolveCharts(settings, cf)`; each menu change does `setSettings(next); chartSettings.save(martId, next)`.
2. Bucket: `r.bucket === 'AUTO'` → `rangeQuery(r.date)` then `pickBucket(row[min], row[max])`; else the chosen bucket. Sparklines and the time series wait for the bucket.
3. Scorecards: one `scorecardsQuery`; card value text = `formatValue(row[key], type, formatOf(col, type))` (from `src/format/formats.ts`; for `Records` use `formatNumber`). Card label: Records, or `${fieldLabel(field)} · ${AGG_LABELS[fn]}`. Hidden cards (`r.hidden`) are skipped.
4. Sparklines (`r.sparklines`, per mart with a date): `sparklineQuery(mart, mart.dates.includes(r.date) ? r.date : mart.dates[0], bucket, filter)`; points from rows, `label = formatBucket(row[date], bucket)`.
5. Time series: with `r.stack`: `topValuesQuery` → `top` (strings, in returned order) → `seriesQuery` with stack → `seriesOtherQuery` only when `top.length === TOP_N`; series per top value plus "Other" (colour 9). Without: one `seriesQuery`. Title `${metric label} by ${BUCKET_LABELS[bucket].toLowerCase()}` + ` · by ${dimension label}`. Header actions: orientation buttons (`aria-pressed`, labels "Vertical bars", "Horizontal bars") then ⋮.
6. Pie: `topValuesQuery(pieDimension, pieMetric)` then `pieOtherQuery` when 8 came back. Note "Rows with a blank <dimension> are not shown." on both dimension charts.
7. ⋮ menus (`ChartMenu`, a button `aria-label="<chart> options"` with `EllipsisVertical`, opening a `Panel` from `MenuParts` with `Row`s and `menuitemradio` checks): Scorecards: one checkbox row per card + "Sparklines"; Time series: "Date field" (only >1), "Bucket" (Auto, Day, Week, Month, Quarter, Year), "Metric" (only >1), "Stack by" ("No stacking" + dimensions); Pie: "Metric", "Dimension". Submenus open beside, as `ColumnMenu` does (read it for the pattern).
8. Empty states: no metric and no PK anywhere → a single row "Show a number column to chart it."; a query returning 0 rows → `empty = hasFilters ? 'No rows match the filters.' : 'This data mart has no rows.'`.
9. `paused` → no query runs (pass `null` options to `useChartQuery`).

- [ ] **Step 1: Failing tests** in `charts-body.test.tsx`, rendering the page with the mock ctx (`src/sdk/mock/ctx.ts`) the way `joined-columns.test.tsx` does, opening a mart that has a PK, a date, a number and a string, plus a joined mart with a number column shown:
  1. Click "Charts": a `Records` card and an `<field> · Sum` card are inside `td[data-chart-group=<main id>]`; the joined metric card is inside the joined group's cell.
  2. A date column shown → sparklines (`svg[aria-label*="trend"]`) present; hide it via the picker → gone and no time-series panel.
  3. Time series ⋮ → Stack by → a dimension: `rect[data-series]` from more than one series; the `charts` collection got a `put` with `timeSeries.stack`.
  4. Orientation button "Horizontal bars" → `svg[data-orientation=horizontal]`, saved.
  5. A filter set from the column header in Charts mode changes the traverse calls' `filter` (spy on `traverseData`).
  6. Sort buttons are not in the header in Charts mode; Table mode shows them again.
  7. Folding the Data band in Charts mode issues no new `traverseData` call.
  8. A saved doc `{ pie: { dimension: 'not_shown' } }` → pie uses the first dimension, and no `put` is made on load.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** this file, then `npx vitest run --poolOptions.threads.maxThreads=4` (all) → PASS; `npm run lint` and `npx tsc -b` clean.
- [ ] **Step 5: Commit** `Charts: scorecards, time series and pie under the grid headers`.

---

### Task 9: e2e and README

**Files:**
- Create: `e2e/charts.spec.ts` (copy setup from an existing spec in `e2e/`)
- Modify: `README.md`

- [ ] **Step 1: e2e**: open the dev app on the mock, select the demo orders mart, click "Charts", expect a scorecard with text "Records", a bar chart svg; open Time series options → Stack by → first dimension, expect a legend; click "Horizontal bars", expect `svg[data-orientation=horizontal]`; click "Table", expect grid rows back.
- [ ] **Step 2: Run** `npm run e2e -- --trace off e2e/charts.spec.ts` → PASS.
- [ ] **Step 3: README**: under "What this gives you" add a 📊 **Charts** paragraph (switch, scorecards per data mart with Records and sparklines, time series with stacking and orientation, pie, ⋮ options saved per member, every number computed by OWOX); under "What it costs" one line: each chart is a `traverseData` query, run only while Charts is shown and the band is open; under "What it writes" add the chart options.
- [ ] **Step 4: Commit** `Charts: e2e and README`.
