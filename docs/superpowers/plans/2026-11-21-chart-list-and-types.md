# Chart List and New Chart Types Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Charts view draws a member-built list of charts (seven types), managed from a ⋮ menu in the Data band header, each with its own settings, a type switch, Remove and Copy to clipboard, and panels only as wide as their content.

**Architecture:** The saved doc becomes `{ version: 2, scorecards, charts: ChartSpec[] }`. Each chart type is a module in `src/charts/kinds/` implementing one `ChartKindDef` interface (eligible, create, resolve, title, Panel). `ChartsBody` resolves the list and mounts each kind's Panel; it portals the list menu into a slot the Data band header renders next to the Table / Charts switch. Every number comes from a backend query (the plugin never sums, counts or buckets); every chart is hand-drawn SVG.

**Tech Stack:** React 19, TypeScript 6, Vitest 5 + Testing Library (jsdom), Playwright 1.65, Tailwind 4, lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-21-chart-list-and-types-design.md`

## Global Constraints

- No new dependency. Charts are hand-drawn SVG in `src/charts/svg/`.
- Saved doc: `version: 2`; a doc without `version: 2` keeps `scorecards` and drops every other key. Collection `charts`, member scope, keyed by main mart id (unchanged).
- A saved name that is no longer shown falls back for this view only and is never written back.
- Defaults when `charts` is absent: `[{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie' }]`. Written only on the member's first change. An empty saved list stays empty.
- Every value on screen is a returned row's value formatted by the existing helpers (`measureText`, `metricText`, `tickText`). Sizes are drawing ratios only.
- Click filters reuse `dimensionFilter` and `bucketFilter` from `src/charts/clickFilters.ts`; "Other" is never clickable.
- Top lists use `TOP_N` (8). Scatter reads at most 200 rows (`SCATTER_LIMIT`).
- Menu labels: header button `Charts options`; panel menus `Time series options`, `Pie options`, `Ranked bar options`, `Line options`, `Heatmap options`, `Scatter options`, `Spread options`. Common panel rows, in this order at the end: `Chart type`, `Copy to clipboard`, `Remove`. Header rows: scorecard ticks, `Sparklines`, one tick per chart, `Add chart`.
- Copy order: `navigator.clipboard.write` PNG, then copy event with `text/html` `<img src="data:…">`, then download `<title>.png`. Toasts: `Chart copied` / `Clipboard is blocked here, the chart was downloaded as PNG`.
- Panel widths: pie, ranked bar, scatter, spread `min(100%, 26rem)`; time series, line, heatmap `clamp(20rem, <buckets × 28 + 64>px, 100%)` (horizontal time series `min(100%, 26rem)`).
- Tests: `npx vitest run --poolOptions.threads.maxThreads=4 <path>`; e2e: `npx playwright test --workers=1 --trace off <spec>`. Never run either unbounded.
- Commit messages: `Charts: <what changed>` style as in `git log`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never put a model name anywhere else.

## Review Focus

1. A chart whose fields are no longer shown (columns hidden) is not drawn, issues no query, stays in the header list labelled `<title> (columns hidden)`, and draws again with its saved setup when the columns come back. Pinned in Task 3.
2. Two quick edits (add a chart, then change its metric at once) both land in the saved doc. Pinned in Task 2.
3. Switching a chart to a type with a narrower measure set (an AVG ranked bar switched to pie) draws the pie with a summable measure and keeps the saved `measure` untouched until the member picks one. Pinned in Task 3.
4. Copy to clipboard on a panel that is still loading or failed shows `Nothing to copy yet` and writes nothing. Pinned in Task 10.
5. A hidden chart and a removed chart send no query; removing the last chart saves `charts: []`, and the defaults do not come back. Pinned in Task 3.

## File map

| File | Responsibility |
|---|---|
| `src/charts/settings.ts` | Saved-doc types, defaults, pick helpers, list edits |
| `src/api/chart-settings.ts` | Load/save and `clean` of the v2 doc |
| `src/charts/kinds/types.ts` | `ChartKindDef`, `PanelProps`, `carry` |
| `src/charts/kinds/index.ts` | `KINDS` registry, `eligibleKinds` |
| `src/charts/kinds/timeSeries.tsx`, `pie.tsx`, `rankedBar.tsx`, `line.tsx`, `heatmap.tsx`, `scatter.tsx`, `spread.tsx` | One chart type each |
| `src/charts/useDateSeries.ts` | Series over a date (shared by time series and line) |
| `src/charts/ChartPanel.tsx` | Frame, title, menu, width, copy |
| `src/charts/ChartMenu.tsx` | Adds the `action` item kind |
| `src/charts/ChartsBody.tsx` | Resolves the list, mounts panels, portals the list menu |
| `src/charts/menuSlot.ts` | Context carrying the header slot element |
| `src/charts/listMenu.ts` | Builds header and per-panel common menu items |
| `src/charts/queries.ts` | Adds `heatmapQuery`, `scatterQuery`, `spreadQuery` |
| `src/charts/svg/LineChart.tsx`, `Heatmap.tsx`, `Scatter.tsx`, `SpreadChart.tsx` | New drawings |
| `src/charts/copyImage.ts` | PNG export and the three copy routes |
| `src/charts/Scorecards.tsx` | `ResolvedCharts` replaced by `Spark` |
| `src/ui/bands/DataBand.tsx` | Renders the slot, provides it |
| `src/charts/TimeSeriesPanel.tsx`, `src/charts/PiePanel.tsx` | Deleted (moved into kinds) |

---

### Task 1: Saved doc v2 helpers (additive)

**Files:**
- Modify: `src/charts/settings.ts`
- Test: `src/charts/settings.test.ts` (new tests appended; existing tests untouched in this task)

**Interfaces:**
- Produces (all exported from `src/charts/settings.ts`):
  - `CHART_KINDS`, `type ChartKind`, `isChartKind(v): v is ChartKind`
  - `type ChartSpec = { id: string; kind: ChartKind; hidden?: boolean; measure?: string; measure2?: string | null; date?: string; bucket?: DateBucket | 'AUTO'; dimension?: string; dimension2?: string; stack?: string | null; orientation?: Orientation; area?: boolean }`
  - `type ChartSettingsV2 = { version?: 2; scorecards?: { hidden?: string[]; sparklines?: boolean }; charts?: ChartSpec[] }`
  - `type Spark = { hidden: Set<string>; sparklines: boolean; date: Field | null }`
  - `DEFAULT_CHARTS: ChartSpec[]`, `chartsOf(s): ChartSpec[]`, `scorecardsOf(s): { hidden: Set<string>; sparklines: boolean }`
  - `pickMeasure(list: Measure[], saved?: string | null): Measure | null`
  - `pickField(list: Field[], saved?: string | null, fallback?: Field | null): Field | null`
  - `pickBucketChoice(v: unknown): DateBucket | 'AUTO'`
  - `newChartId(): string`, `editCharts(s, edit): ChartSettingsV2`, `patchChart(s, id, patch): ChartSettingsV2`

- [ ] **Step 1: Write the failing tests** (append to `src/charts/settings.test.ts`)

```ts
import { chartsOf, DEFAULT_CHARTS, editCharts, isChartKind, newChartId, patchChart, pickBucketChoice, pickField, pickMeasure, scorecardsOf, type ChartSettingsV2 } from './settings';

describe('saved doc v2', () => {
  test('no charts saved means the default time series and pie; an empty list stays empty', () => {
    expect(chartsOf({})).toEqual(DEFAULT_CHARTS);
    expect(DEFAULT_CHARTS.map((c) => c.kind)).toEqual(['timeSeries', 'pie']);
    expect(chartsOf({ version: 2, charts: [] })).toEqual([]);
  });
  test('editCharts applies to the defaults when nothing is saved and always writes version 2', () => {
    const s = editCharts({ scorecards: { sparklines: false } }, (list) => list.filter((c) => c.kind !== 'pie'));
    expect(s).toEqual({ version: 2, scorecards: { sparklines: false }, charts: [{ id: 'time-series', kind: 'timeSeries' }] });
  });
  test('patchChart changes one chart by id and keeps the rest', () => {
    const s: ChartSettingsV2 = { version: 2, charts: [{ id: 'a', kind: 'pie' }, { id: 'b', kind: 'line' }] };
    expect(patchChart(s, 'b', { area: true }).charts).toEqual([{ id: 'a', kind: 'pie' }, { id: 'b', kind: 'line', area: true }]);
  });
  test('pickMeasure: the saved id, else the first metric, else the first measure', () => {
    const rec = { kind: 'records', aliasPath: '', recordsId: 'records:M' } as const;
    const amt = { kind: 'metric', metric: { field: { name: 'amount' }, fn: 'SUM' } } as never;
    expect(pickMeasure([rec, amt], 'records')).toBe(rec);
    expect(pickMeasure([rec, amt], 'gone')).toBe(amt);
    expect(pickMeasure([rec], undefined)).toBe(rec);
    expect(pickMeasure([], 'x')).toBeNull();
  });
  test('pickField: saved name, else the fallback (first by default, null when given)', () => {
    const a = { name: 'a' } as never; const b = { name: 'b' } as never;
    expect(pickField([a, b], 'b')).toBe(b);
    expect(pickField([a, b], 'gone')).toBe(a);
    expect(pickField([a, b], 'gone', null)).toBeNull();
    expect(pickField([], undefined)).toBeNull();
  });
  test('pickBucketChoice keeps AUTO and real buckets only', () => {
    expect(pickBucketChoice('WEEK')).toBe('WEEK');
    expect(pickBucketChoice('HOUR')).toBe('AUTO');
    expect(pickBucketChoice(undefined)).toBe('AUTO');
  });
  test('scorecardsOf reads hidden and sparklines with their defaults', () => {
    expect(scorecardsOf({})).toEqual({ hidden: new Set(), sparklines: true });
    expect(scorecardsOf({ scorecards: { hidden: ['x'], sparklines: false } })).toEqual({ hidden: new Set(['x']), sparklines: false });
  });
  test('ids are unique and kinds are checked', () => {
    expect(newChartId()).not.toBe(newChartId());
    expect(isChartKind('heatmap')).toBe(true);
    expect(isChartKind('donut')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/settings.test.ts`
Expected: FAIL, `chartsOf` (and the rest) not exported.

- [ ] **Step 3: Implement** (append to `src/charts/settings.ts`; keep `resolveCharts` and the old types for now, Task 2 removes them)

```ts
export const CHART_KINDS = ['timeSeries', 'pie', 'rankedBar', 'line', 'heatmap', 'scatter', 'spread'] as const;
export type ChartKind = (typeof CHART_KINDS)[number];
export const isChartKind = (v: unknown): v is ChartKind => (CHART_KINDS as readonly unknown[]).includes(v);

/** One chart the member added: its type and the saved names of its fields. Names resolve against the shown columns at draw time. */
export type ChartSpec = {
  id: string; kind: ChartKind; hidden?: boolean;
  measure?: string; measure2?: string | null; date?: string; bucket?: DateBucket | 'AUTO';
  dimension?: string; dimension2?: string; stack?: string | null; orientation?: Orientation; area?: boolean;
};
export type ChartSettingsV2 = { version?: 2; scorecards?: { hidden?: string[]; sparklines?: boolean }; charts?: ChartSpec[] };
/** What the scorecards need: hidden cards, the sparklines switch and the date their trends are drawn on. */
export type Spark = { hidden: Set<string>; sparklines: boolean; date: Field | null };

/** What a mart shows before the member changes anything: today's two panels. Fixed ids, so an edit of a default keeps its id. */
export const DEFAULT_CHARTS: ChartSpec[] = [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie' }];
export const chartsOf = (s: ChartSettingsV2): ChartSpec[] => s.charts ?? DEFAULT_CHARTS;
export const scorecardsOf = (s: ChartSettingsV2) => ({ hidden: new Set(s.scorecards?.hidden ?? []), sparklines: s.scorecards?.sparklines ?? true });

export const pickMeasure = (list: Measure[], saved?: string | null): Measure | null =>
  list.find((m) => measureId(m) === saved) ?? list.find((m) => m.kind === 'metric') ?? list[0] ?? null;
export const pickField = (list: Field[], saved?: string | null, fallback: Field | null = list[0] ?? null): Field | null =>
  list.find((f) => f.name === saved) ?? fallback;
export const pickBucketChoice = (v: unknown): DateBucket | 'AUTO' => (v === 'AUTO' || isDateBucket(v) ? (v as DateBucket | 'AUTO') : 'AUTO');

let seq = 0;
export const newChartId = (): string => `c-${Date.now().toString(36)}-${(seq++).toString(36)}`;
/** One edit of the list: the saved list, or the defaults it stands for, with `edit` applied. Always version 2. */
export const editCharts = (s: ChartSettingsV2, edit: (list: ChartSpec[]) => ChartSpec[]): ChartSettingsV2 => ({ ...s, version: 2, charts: edit(chartsOf(s)) });
export const patchChart = (s: ChartSettingsV2, id: string, patch: Partial<ChartSpec>): ChartSettingsV2 =>
  editCharts(s, (list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/settings.test.ts`
Expected: PASS (old and new tests).

- [ ] **Step 5: Commit**

```bash
git add src/charts/settings.ts src/charts/settings.test.ts
git commit -m "Charts: saved doc v2 helpers for a list of charts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Switch to the chart list (time series and pie as kinds)

**Files:**
- Create: `src/charts/kinds/types.ts`, `src/charts/kinds/index.ts`, `src/charts/kinds/timeSeries.tsx`, `src/charts/kinds/pie.tsx`, `src/charts/useDateSeries.ts`
- Modify: `src/charts/settings.ts` (remove `ChartSettings` v1 type, `ResolvedCharts`, `resolveCharts`; rename `ChartSettingsV2` to `ChartSettings`), `src/api/chart-settings.ts`, `src/charts/ChartMenu.tsx`, `src/charts/ChartPanel.tsx`, `src/charts/ChartsBody.tsx`, `src/charts/Scorecards.tsx`, `src/charts/charts.css`
- Delete: `src/charts/TimeSeriesPanel.tsx`, `src/charts/PiePanel.tsx` (move `seriesColor`, `OTHER_COLOR`, `tickText` to `src/charts/kinds/timeSeries.tsx` and re-export where imported; move `sharesWhole` to `src/charts/kinds/pie.tsx`)
- Test: `src/api/chart-settings.test.ts`, `src/charts/settings.test.ts`, `src/charts/copies.test.ts`, `src/charts/charts-body.test.tsx`, `src/charts/TimeSeriesPanel.test.ts` (rename to `src/charts/kinds/timeSeries.test.ts`, fix import), `src/charts/sharedReads.test.ts`, `src/charts/chartsBodyMemo.test.tsx`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces:
  - `src/charts/kinds/types.ts`:
    ```ts
    export type PanelProps<R> = { martId: string; cf: ChartFields; spec: ChartSpec; r: R; spark: Spark; filter: TraverseFilter[]; version: number; idle: boolean; hasFilters: boolean; formatOf: Formatter; ready: boolean;
      /** Rows every panel menu ends with (Chart type, Remove), built by ChartsBody. */ tail: MenuItem[];
      onChange: (patch: Partial<ChartSpec>) => void; onFilter: (add: ColumnFilter[]) => void };
    export type ChartKindDef<R> = { kind: ChartKind; label: string; eligible(cf: ChartFields): boolean; create(cf: ChartFields, from?: ChartSpec): Omit<ChartSpec, 'id' | 'hidden'>; resolve(spec: ChartSpec, cf: ChartFields): R | null; title(r: R, cf: ChartFields): string; Panel: (p: PanelProps<R>) => ReactNode };
    export const carry = (from: ChartSpec | undefined, keys: (keyof ChartSpec)[]): Partial<ChartSpec>;
    export const seriesWidth = (buckets: number | null): string;
    export const BOX_WIDTH = 'min(100%, 26rem)';
    ```
  - `src/charts/kinds/index.ts`: `export const KINDS: Record<ChartKind, ChartKindDef<any>>` and `export const eligibleKinds = (cf: ChartFields): ChartKindDef<any>[]`. In this task `KINDS` holds `timeSeries` and `pie`; the other five keys are added by Tasks 5 to 9 (type it as `Partial<Record<…>>` now and make it total in Task 9; `ChartsBody` skips a spec whose kind is not registered).
  - `ChartMenu` `MenuItem` gains `{ kind: 'action'; label: string; onPick: () => void }`.
  - `ChartPanel` props: `{ title; name; items: MenuItem[] | null; extra?: ReactNode; width: string; loading; error; onRetry; empty?; note?; children }`. It renders `<ChartMenu name={name} items={items} />` when `items` is not null.
  - `src/charts/useDateSeries.ts`: `useDateSeries(a): DateSeries` (below).
  - `Scorecards.tsx`: `sparkDate(mart, spark: Spark)`, `sparkQueryOf(mart, spark, bucket, filter)`, `sharedSeriesQuery(cf, spark, measure, bucket, filter)`, `MartCards({ …, spark, … })` replace their `r: ResolvedCharts` parameter with `spark: Spark` (same field names `hidden`, `sparklines`, `date`).

- [ ] **Step 1: Rewrite the settings tests for v2**

In `src/api/chart-settings.test.ts`, replace the save/read and malformed-doc tests with:

```ts
test('save does one put under the mart id and load reads it back', async () => {
  const store = new Map<string, unknown>();
  const s = { version: 2 as const, charts: [{ id: 'a', kind: 'pie' as const, measure: 'amount' }] };
  const cs = createChartSettings(ctxWith(async (id) => (store.has(id) ? { document: store.get(id) } : null), async (id, d) => { store.set(id, d); }));
  cs.save('M', s);
  await vi.waitFor(() => expect(store.get('M')).toEqual(s));
  expect(await cs.load('M')).toEqual(s);
});

test('a v1 document keeps its scorecards and drops its time series and pie', async () => {
  const doc = { scorecards: { hidden: ['a'] }, timeSeries: { metric: 'm' }, pie: { dimension: 'd' } };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M')).toEqual({ scorecards: { hidden: ['a'] } });
});

test('a v2 document keeps known chart keys of the right type and drops bad charts', async () => {
  const doc = { version: 2, charts: [
    { id: 'a', kind: 'line', measure: 'm', measure2: null, bucket: 'FORTNIGHT', area: 'yes', orientation: 'diagonal', extra: 1 },
    { id: 'b', kind: 'donut' },
    { kind: 'pie' },
    { id: 'a', kind: 'pie' },
    { id: 'c', kind: 'heatmap', hidden: true, dimension: 'x', dimension2: 'y', stack: null, bucket: 'WEEK' },
  ] };
  expect(await createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M')).toEqual({ version: 2, charts: [
    { id: 'a', kind: 'line', measure: 'm', measure2: null },
    { id: 'c', kind: 'heatmap', hidden: true, dimension: 'x', dimension2: 'y', stack: null, bucket: 'WEEK' },
  ] });
});
```

(Keep the existing `load is empty on a missing document`, `a failed read gives {} …` and `a non-object document or part is dropped` tests; in the last one, the expected value stays `{}`. Use the file's existing `ctxWith` helper; if its signature differs from `(get, put)`, adapt the two calls above to it.)

In `src/charts/settings.test.ts` and `src/charts/copies.test.ts`, port every `resolveCharts` assertion with this mapping, keeping each test's intent and expected values:

| Old | New |
|---|---|
| `resolveCharts({ timeSeries: { metric: X } }, cf).measure` | `pickMeasure(measuresOf(cf), X)` |
| `resolveCharts({ pie: { metric: X } }, cf).pieMeasure` | `pickMeasure(pieMeasures(cf), X)` |
| `.date` with `timeSeries.date: X` | `pickField(cf.dates, X)` |
| `.stack` with `timeSeries.stack: X` | `pickField(cf.dimensions, X, null)` |
| `.pieDimension` with `pie.dimension: X` | `pickField(cf.dimensions, X)` |
| `.bucket` with `timeSeries.bucket: X` | `pickBucketChoice(X)` |
| `.orientation` with `timeSeries.orientation: X` | `KINDS.timeSeries.resolve({ id: 't', kind: 'timeSeries', orientation: X }, cf)!.orientation` |

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/api/chart-settings.test.ts src/charts/settings.test.ts src/charts/copies.test.ts`
Expected: FAIL (v1 keys still kept; `KINDS` missing).

- [ ] **Step 3: `clean` for v2** (`src/api/chart-settings.ts`)

Replace the `timeSeries` and `pie` blocks of `clean` with:

```ts
import { isChartKind, type ChartSettings, type ChartSpec } from '../charts/settings';

function cleanSpec(v: unknown): ChartSpec | null {
  const o = obj(v);
  if (!o || typeof o.id !== 'string' || !isChartKind(o.kind)) return null;
  const out: ChartSpec = { id: o.id, kind: o.kind };
  if (typeof o.hidden === 'boolean') out.hidden = o.hidden;
  for (const k of ['measure', 'date', 'dimension', 'dimension2'] as const) if (typeof o[k] === 'string') out[k] = o[k] as string;
  for (const k of ['measure2', 'stack'] as const) if (o[k] === null || typeof o[k] === 'string') out[k] = o[k] as string | null;
  if (o.bucket === 'AUTO' || isDateBucket(o.bucket)) out.bucket = o.bucket as ChartSpec['bucket'];
  if (o.orientation === 'vertical' || o.orientation === 'horizontal') out.orientation = o.orientation;
  if (typeof o.area === 'boolean') out.area = o.area;
  return out;
}
```

and at the end of `clean`, before `return out`:

```ts
  // Charts are read from a version 2 doc only: a v1 doc's fixed panels are dropped, the defaults stand in.
  if (d.version === 2 && Array.isArray(d.charts)) {
    const seen = new Set<string>();
    out.version = 2;
    out.charts = d.charts.map(cleanSpec).filter((c): c is ChartSpec => !!c && !seen.has(c.id) && !!seen.add(c.id));
  }
```

In `src/charts/settings.ts`: delete the v1 `ChartSettings`, `ResolvedCharts` and `resolveCharts`, and rename `ChartSettingsV2` to `ChartSettings` everywhere (`export type ChartSettings = { version?: 2; … }`).

- [ ] **Step 4: Menu `action` item** (`src/charts/ChartMenu.tsx`)

```ts
export type MenuItem =
  | { kind: 'check'; label: string; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; value: string; options: { value: string; label: string }[]; onPick: (value: string) => void }
  | { kind: 'action'; label: string; onPick: () => void };
```

In the panel's rows, render an action as a plain row that closes the menu and then runs:

```tsx
{items.map((it, i) => it.kind === 'check' ? (
  <Row key={i} check checkbox checked={it.checked} label={it.label} onActivate={it.onToggle} onHover={hoverOther} onLeaveRow={leaveRow} />
) : it.kind === 'action' ? (
  <Row key={i} label={it.label} onActivate={() => { close(); it.onPick(); }} onHover={hoverOther} onLeaveRow={leaveRow} />
) : (
  <Row key={i} sub expanded={sub?.key === i} label={it.label} onActivate={(r) => open(i, r, true)} onOpen={(r) => open(i, r, true)}
    onHover={(r) => hoverRow(i, r)} onLeaveRow={leaveRow} />
))}
```

Add to `src/charts/ChartMenu.test.tsx`:

```tsx
test('an action row closes the menu and runs', async () => {
  const onPick = vi.fn();
  render(<ChartMenu name="Sales" items={[{ kind: 'action', label: 'Remove', onPick }]} />);
  await userEvent.click(screen.getByRole('button', { name: 'Sales options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
  expect(onPick).toHaveBeenCalledOnce();
  expect(screen.queryByRole('menu')).toBeNull();
});
```

- [ ] **Step 5: `ChartPanel` owns its menu and width** (`src/charts/ChartPanel.tsx`)

```tsx
import type { ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { Hint } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';

/** One chart's frame: title, extra buttons, its ⋮ menu (null before the saved settings load) and the width its content needs. */
export function ChartPanel({ title, name, items, extra, width, loading, error, onRetry, empty, note, children }: {
  title: string; name: string; items: MenuItem[] | null; extra?: ReactNode; width: string;
  loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode;
}) {
  return (
    <section className="dm-chart" data-chart-kind={name} style={{ width }}>
      <header className="dm-chart-head">
        <div className="dm-chart-titlegroup">
          <h3 className="dm-chart-title">{title}</h3>
          {note && <Hint text={note} label={`About ${title}`} />}
        </div>
        {items && <div className="dm-chart-actions">{extra}<ChartMenu name={name} items={items} /></div>}
      </header>
      {error ? <ErrorBox error={error} onRetry={onRetry} />
        : loading ? <Skeleton rows={4} />
        : empty ? <p className="dm-muted dm-chart-empty">{empty}</p>
        : children}
    </section>
  );
}
```

In `src/charts/charts.css`, replace the `.dm-chart-panels` rule with a wrapping flex row (the panel sets its own width):

```css
/* Each panel is as wide as its content needs (ChartPanel sets the width); they wrap onto more rows when the band is narrow.
   The same 0.75rem inset as the scorecard cells, so the left edges line up; 1.5rem between blocks either way. */
.dm-chart-panels { display: flex; flex-wrap: wrap; align-items: flex-start; gap: 1.5rem; padding: 0.75rem 0.75rem 1.5rem; }
.dm-chart { flex: none; max-width: 100%; }
```

- [ ] **Step 6: Registry types** (`src/charts/kinds/types.ts`)

```ts
import type { ReactNode } from 'react';
import type { ColumnFilter } from '../../filters/build';
import type { TraverseFilter } from '../../sdk/types';
import type { MenuItem } from '../ChartMenu';
import type { ChartFields } from '../fields';
import type { Formatter } from '../Scorecards';
import type { ChartKind, ChartSpec, Spark } from '../settings';

export type PanelProps<R> = {
  martId: string; cf: ChartFields; spec: ChartSpec; r: R; spark: Spark; filter: TraverseFilter[]; version: number; idle: boolean;
  hasFilters: boolean; formatOf: Formatter; ready: boolean;
  /** Rows every panel menu ends with (Chart type, Remove), built by ChartsBody. */
  tail: MenuItem[];
  onChange: (patch: Partial<ChartSpec>) => void; onFilter: (add: ColumnFilter[]) => void;
};

export type ChartKindDef<R> = {
  kind: ChartKind;
  /** Shown in "Add chart" and "Chart type", and as the panel menu's name ("Pie options"). */
  label: string;
  /** Whether the shown columns can draw it. */
  eligible(cf: ChartFields): boolean;
  /** A new chart's saved fields; on a type switch, `from` is the chart being switched and its usable fields are kept. */
  create(cf: ChartFields, from?: ChartSpec): Omit<ChartSpec, 'id' | 'hidden'>;
  /** Saved names to shown fields, falling back per field; null when it cannot draw with what is shown. */
  resolve(spec: ChartSpec, cf: ChartFields): R | null;
  /** The chart's name in the header list. */
  title(r: R, cf: ChartFields): string;
  Panel: (p: PanelProps<R>) => ReactNode;
};

/** The fields of `from` named in `keys` that are set: what a type switch keeps. */
export const carry = (from: ChartSpec | undefined, keys: (keyof ChartSpec)[]): Partial<ChartSpec> =>
  Object.fromEntries(keys.filter((k) => from?.[k] !== undefined).map((k) => [k, from![k]]));

/** A date chart's width: 28px per bucket plus the axis, at least 20rem, at most the band. Unknown bucket count: 20rem. */
export const seriesWidth = (buckets: number | null): string => `clamp(20rem, ${(buckets ?? 0) * 28 + 64}px, 100%)`;
export const BOX_WIDTH = 'min(100%, 26rem)';
```

- [ ] **Step 7: `useDateSeries`** (`src/charts/useDateSeries.ts`)

Move the data half of the old `TimeSeriesPanel` here unchanged in behaviour (same queries, same sharing with the sparkline read, same Other handling):

```ts
import { formatBucket, type DateBucket } from '../model/aggregation';
import type { Field } from '../model/types';
import type { Row, TraverseFilter } from '../sdk/types';
import type { ChartFields } from './fields';
import { measureKey, seriesOtherQuery, seriesQuery, TOP_N, topValuesQuery, type Measure } from './queries';
import { measureLabel, measureText, numberOf, sharedSeriesQuery, type Formatter } from './Scorecards';
import type { Spark } from './settings';
import type { Series } from './svg/BarChart';
import { useChartQuery } from './useChartQuery';

export const seriesColor = (i: number): string => `var(--dm-series-${i + 1})`;
export const OTHER_COLOR = 'var(--dm-series-9)';

export type DateSeries = { series: Series[] | null; failed: { error: unknown; retry: () => void } | undefined; empty: boolean; loading: boolean; label: string; names: string[] | undefined };

/**
 * A measure over a date, one point per bucket, split by a dimension's top values plus "Other" when `stack` is set.
 * Unstacked, it rides on the sparklines' read when it can (same key, one billed read). Each value is a returned row's value.
 */
export function useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, formatOf, range }: {
  martId: string; cf: ChartFields; spark: Spark; date: Field; bucket: DateBucket | null; measure: Measure; stack: Field | null;
  filter: TraverseFilter[]; version: number; idle: boolean; formatOf: Formatter; range?: { error: unknown; retry: () => void };
}): DateSeries {
  const live = !idle && !!bucket;
  const top = useChartQuery(martId, !idle && stack ? topValuesQuery(stack, measure, filter) : null, version);
  const names = top.rows?.map((row) => String(row[stack!.name]));
  const sharedOptions = live && !stack ? sharedSeriesQuery(cf, spark, measure, bucket, filter) : null;
  const shared = useChartQuery(martId, sharedOptions, version);
  const viaShared = !!sharedOptions && !shared.error;
  const own = useChartQuery(martId, live && !viaShared && (!stack || (names && names.length > 0)) ? seriesQuery(date, bucket!, measure, filter, stack ? { dim: stack, top: names! } : undefined) : null, version);
  const series = viaShared ? shared : own;
  const needOther = !!stack && names?.length === TOP_N;
  const other = useChartQuery(martId, live && needOther ? seriesOtherQuery(date, bucket!, measure, filter, stack!, names!) : null, version);
  const hasOther = needOther && !!other.rows?.some((x) => x[measureKey(measure)] != null);
  const label = measureLabel(cf, measure);
  const failed = [...(range ? [range] : []), top, series, other].find((q) => q.error);
  const empty = stack ? top.rows?.length === 0 : series.rows?.length === 0;
  const loading = !empty && (!bucket || !series.rows || (needOther && !other.rows));
  if (!series.rows || loading || empty) return { series: null, failed, empty, loading, label, names };

  const key = measureKey(measure);
  const cell = (row: Row | undefined) => ({ y: row ? numberOf(row[key]) : null, valueText: row ? measureText(measure, row[key], formatOf) : '' });
  const pivot = (name: string, color: string, rows: Row[], xs: string[]): Series => {
    const at = new Map(rows.map((x) => [String(x[date.name]), x]));
    return { name, color, points: xs.map((x) => ({ x, label: formatBucket(x, bucket!) ?? x, ...cell(at.get(x)) })) };
  };
  const all = [...series.rows, ...(other.rows ?? [])];
  const xs = [...new Set(all.map((x) => String(x[date.name])))].sort();
  if (!stack) return { series: [pivot(label, seriesColor(0), series.rows, xs)], failed, empty, loading, label, names };
  const rowsOf = (n: string) => series.rows!.filter((x) => String(x[stack.name]) === n);
  const out = [...names!.map((n, i) => pivot(n, seriesColor(i), rowsOf(n), xs)), ...(hasOther ? [{ ...pivot('Other', OTHER_COLOR, other.rows ?? [], xs), other: true }] : [])];
  return { series: out, failed, empty, loading, label, names };
}
```

- [ ] **Step 8: Time series kind** (`src/charts/kinds/timeSeries.tsx`)

```tsx
import { ChartBar, ChartColumn } from 'lucide-react';
import { formatValue, type Format } from '../../format/formats';
import { BUCKET_LABELS, DATE_BUCKETS, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import { bucketFilter, dimensionFilter, isBucketDate } from '../clickFilters';
import { compactValue } from '../compact';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { measuresOf, type ChartFields } from '../fields';
import { bucketZone, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure, type Orientation } from '../settings';
import { BarChart } from '../svg/BarChart';
import { useBucket } from '../useBucket';
import { useDateSeries } from '../useDateSeries';
import { BOX_WIDTH, carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

export { OTHER_COLOR, seriesColor } from '../useDateSeries';
export type TimeSeriesR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; stack: Field | null; orientation: Orientation };

/** An axis tick in the measure's format: short ($10.2K) when it has a short form, else the value rounded to 2 decimals unless the format scales or rounds it itself. */
export const tickText = (n: number, type: string, format: Format): string => compactValue(n, type, format) ?? formatValue(format.kind === 'percent' || format.kind === 'money' ? n : Number(n.toFixed(2)), type, format);

/** The shared rows of a date chart's menu: Date field (when there is a choice), Bucket and Metric (when there is a choice). */
export function dateMenu(cf: ChartFields, r: { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure }, onChange: PanelProps<unknown>['onChange']): MenuItem[] {
  const measures = measureOptions(cf, measuresOf(cf));
  return [
    ...(cf.dates.length > 1 ? [{ kind: 'radio', label: 'Date field', value: r.date.name, options: cf.dates.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v: string) => onChange({ date: v }) } as MenuItem] : []),
    { kind: 'radio', label: 'Bucket', value: r.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v) => onChange({ bucket: v as DateBucket | 'AUTO' }) },
    ...(measures.length > 1 ? [{ kind: 'radio', label: 'Metric', value: measureId(r.measure), options: measures, onPick: (v: string) => onChange({ measure: v }) } as MenuItem] : []),
  ];
}

function TimeSeriesPanel({ martId, cf, r, spark, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<TimeSeriesR>) {
  const { date, measure, stack } = r;
  const { bucket, error, retry } = useBucket(martId, date, r.bucket, filter, version, idle);
  const s = useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, formatOf, range: { error, retry } });
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    ...dateMenu(cf, r, onChange),
    { kind: 'radio', label: 'Stack by', value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }, ...cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) }))], onPick: (v) => onChange({ stack: v === '' ? null : v }) },
    ...tail,
  ];
  const orient = (o: Orientation, label: string, Icon: typeof ChartColumn) => (
    <button key={o} type="button" aria-label={label} aria-pressed={r.orientation === o} onClick={() => onChange({ orientation: o })}
      className={`inline-flex size-7 items-center justify-center rounded-md hover:bg-accent ${r.orientation === o ? 'bg-accent' : ''}`}>
      <Icon className="size-4" aria-hidden />
    </button>
  );
  const title = `${s.label} by ${BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase()}`;
  const full = stack ? `${title} · by ${fieldLabel(stack)}` : title;
  const buckets = s.series?.[0]?.points.length ?? null;
  return (
    <ChartPanel title={bucket ? full : `${s.label} by date`} name="Time series" items={ready ? items : null}
      extra={<>{orient('vertical', 'Vertical bars', ChartColumn)}{orient('horizontal', 'Horizontal bars', ChartBar)}</>}
      width={r.orientation === 'horizontal' ? BOX_WIDTH : seriesWidth(buckets)}
      loading={s.loading} error={s.failed?.error} onRetry={s.failed?.retry ?? (() => {})} empty={s.empty ? emptyText(hasFilters) : null}
      note={stack ? `Rows with a blank ${fieldLabel(stack)} are not shown.` : undefined}>
      {s.series && (() => {
        const shown = s.series;
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date, x, bucket!, bucketZone(date)), ...(stack && i !== undefined && !shown[i]!.other ? [dimensionFilter(stack, shown[i]!.name)] : [])]);
        return <BarChart series={shown} orientation={r.orientation} ariaLabel={full} formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={bucket ? pick : undefined} canPick={isBucketDate} stacked={!!stack} xTitle={columnTitle(date)} />;
      })()}
    </ChartPanel>
  );
}

export const timeSeries: ChartKindDef<TimeSeriesR> = {
  kind: 'timeSeries',
  label: 'Time series',
  eligible: (cf) => cf.dates.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'timeSeries', ...carry(from, ['measure', 'date', 'bucket', 'stack']) }),
  resolve(spec, cf) {
    const date = pickField(cf.dates, spec.date);
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    if (!date || !measure) return null;
    return { date, bucket: pickBucketChoice(spec.bucket), measure, stack: pickField(cf.dimensions, spec.stack, null), orientation: spec.orientation === 'horizontal' ? 'horizontal' : 'vertical' };
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by date`,
  Panel: TimeSeriesPanel,
};
```

- [ ] **Step 9: Pie kind** (`src/charts/kinds/pie.tsx`)

Port `PiePanel` with these changes: props are `PanelProps<PieR>`; the Metric row's `onPick` calls `onChange({ measure: v })`; items end with `...tail`; render through the new `ChartPanel` with `name="Pie"`, `items={ready ? items : null}`, `width={BOX_WIDTH}`. Keep `sharesWhole` exported from here.

```tsx
export type PieR = { measure: Measure; dimension: Field };

export const pie: ChartKindDef<PieR> = {
  kind: 'pie',
  label: 'Pie',
  eligible: (cf) => cf.dimensions.length > 0 && pieMeasures(cf).length > 0,
  create: (_cf, from) => ({ kind: 'pie', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const measure = pickMeasure(pieMeasures(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
  Panel: PiePanel,
};
```

Its Panel body is the old `PiePanel` body with `const { measure, dimension: dim } = r;` in place of `r.pieMeasure` / `r.pieDimension`.

- [ ] **Step 10: Registry** (`src/charts/kinds/index.ts`)

```ts
import type { ChartFields } from '../fields';
import type { ChartKind } from '../settings';
import { pie } from './pie';
import { timeSeries } from './timeSeries';
import type { ChartKindDef } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- each kind resolves to its own shape; the body only passes it back to that kind's Panel
type AnyKind = ChartKindDef<any>;
/** Every chart type, in "Add chart" order. Tasks 5 to 9 add the rest. */
export const KINDS: Partial<Record<ChartKind, AnyKind>> = { timeSeries, pie };
export const eligibleKinds = (cf: ChartFields): AnyKind[] => Object.values(KINDS).filter((k): k is AnyKind => !!k && k.eligible(cf));
```

- [ ] **Step 11: Scorecards take `Spark`** (`src/charts/Scorecards.tsx`)

Replace `import { measureId, type ResolvedCharts } from './settings';` with `import { measureId, type Spark } from './settings';` and change the parameter `r: ResolvedCharts` to `spark: Spark` in `sparkDate`, `sparkQueryOf`, `sharedSeriesQuery` and `MartCards` (rename uses of `r.` to `spark.` inside them). Behaviour is unchanged.

- [ ] **Step 12: `ChartsBody` draws the list** (`src/charts/ChartsBody.tsx`)

Keep the load / `latest` / `change` logic, the `cf` memo, the empty and gate states and the scorecard strip. Replace the rest as follows:

```tsx
// Every save is a version 2 doc.
const change = (edit: (cur: ChartSettings) => ChartSettings) => {
  if (!latest.current) return;
  const next: ChartSettings = { ...edit(latest.current), version: 2 };
  latest.current = next;
  setSettings(next);
  chartSettings.save(martId, next);
};

const specs = chartsOf(settings ?? {});
// Hidden charts resolve to nothing, so they mount no panel and read nothing.
const drawn = useMemo(() => specs.map((spec) => {
  const def = KINDS[spec.kind];
  return { spec, def, r: def && !spec.hidden ? def.resolve(spec, cf) : null };
}), [specs, cf]);
// The sparklines draw on the first shown chart's date and bucket; with none, each mart's first date by Auto.
const lead = drawn.find((d) => d.r && (d.r as { date?: unknown }).date) as { r: { date: Field; bucket?: DateBucket | 'AUTO' } } | undefined;
const { hidden, sparklines } = scorecardsOf(settings ?? {});
const spark: Spark = useMemo(() => ({ hidden, sparklines, date: lead?.r.date ?? null }), [settings, lead?.r.date]);
const idle = paused || !settings || !!gate;
const { bucket } = useBucket(martId, spark.date, lead?.r.bucket ?? 'AUTO', filter, version, idle);
```

(`useMemo` dependencies: build `hidden` inside the memo from `settings` to keep the Set stable; the hook order must not depend on `drawn`, so all hooks run before the early returns, as today.)

The scorecard cells keep `<MartCards … spark={spark} bucket={bucket} … />` and keep the current `ChartMenu name="Scorecards"` for now (Task 3 moves it). The panels cell becomes:

```tsx
<div data-chart-panels className="dm-chart-panels sticky" style={{ left: GUTTER_PX, width: Math.max(0, scrollerWidth - GUTTER_PX) }}>
  {drawn.map(({ spec, def, r }) => def && r ? (
    <def.Panel key={spec.id} martId={martId} cf={cf} spec={spec} r={r} spark={spark} filter={filter} version={version} idle={idle}
      hasFilters={hasFilters} formatOf={formatOf} ready={!!settings} tail={[]}
      onChange={(p: Partial<ChartSpec>) => change((cur) => patchChart(cur, spec.id, p))} onFilter={onFilter} />
  ) : null)}
</div>
```

- [ ] **Step 13: Update the body tests for v2**

In `src/charts/charts-body.test.tsx`, `src/charts/sharedReads.test.ts` and `src/charts/chartsBodyMemo.test.tsx`, rewrite each seeded doc and each expected `puts` doc:

| Old seed / expectation | New |
|---|---|
| `{ timeSeries: { … } }` | `{ version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', … }, { id: 'pie', kind: 'pie' }] }` |
| `{ pie: { … } }` | `{ version: 2, charts: [{ id: 'time-series', kind: 'timeSeries' }, { id: 'pie', kind: 'pie', … }] }` |
| keys `metric` | `measure` |
| `{ timeSeries: { orientation: 'horizontal' }, pie: { dimension: 'status' } }` | both charts with those fields |

Expectations of `puts` become the full v2 doc, for example the stack test:

```ts
expect(t.puts).toHaveBeenCalledWith('orders', { version: 2, charts: [{ id: 'time-series', kind: 'timeSeries', stack: 'status' }, { id: 'pie', kind: 'pie' }] });
```

Add, in `src/charts/charts-body.test.tsx` (Review Focus 2):

```tsx
test('two quick edits both land in the saved doc', async () => {
  const t = await charts();
  await userEvent.click(screen.getByRole('button', { name: 'Horizontal bars' }));
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Dimension' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: /Product/ }));
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, charts: [
    { id: 'time-series', kind: 'timeSeries', orientation: 'horizontal' },
    { id: 'pie', kind: 'pie', dimension: 'products__title' },
  ] });
});

test('a v1 doc draws the default charts and keeps its hidden scorecards', async () => {
  await charts({ charts: { scorecards: { hidden: ['amount'] }, timeSeries: { orientation: 'horizontal' } } as never });
  expect(document.querySelector('svg[data-orientation]')?.getAttribute('data-orientation')).toBe('vertical');
  expect(cardNames(group('orders'))).not.toContain('Amount · Sum');
});
```

(If the products title column in the fixture has another label than `/Product/`, use the label the existing pie-dimension test already clicks.)

- [ ] **Step 14: Run the chart tests, then the whole suite and the type check**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts src/api/chart-settings.test.ts`
Expected: PASS.
Run: `npx tsc -b && npx eslint src && npx vitest run --poolOptions.threads.maxThreads=4`
Expected: no errors, all tests pass.

- [ ] **Step 15: Commit**

```bash
git add -A src/charts src/api/chart-settings.ts src/api/chart-settings.test.ts
git commit -m "Charts: draw a saved list of charts; time series and pie become chart kinds

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Header list menu, chart type switch and Remove

**Files:**
- Create: `src/charts/menuSlot.ts`, `src/charts/listMenu.ts`, `src/charts/listMenu.test.ts`
- Modify: `src/ui/bands/DataBand.tsx`, `src/charts/ChartsBody.tsx`
- Test: `src/charts/charts-body.test.tsx`

**Interfaces:**
- Consumes: `KINDS`, `eligibleKinds`, `ChartKindDef`, `chartsOf`, `editCharts`, `patchChart`, `newChartId`, `cardsOf`, `MenuItem` (with `action`).
- Produces:
  - `src/charts/menuSlot.ts`: `export const ChartsMenuSlot = createContext<HTMLElement | null>(null);`
  - `src/charts/listMenu.ts`:
    ```ts
    export function listItems(a: { cf: ChartFields; settings: ChartSettings; resolved: { spec: ChartSpec; title: string | null }[]; change: (edit: (cur: ChartSettings) => ChartSettings) => void }): MenuItem[];
    export function tailItems(a: { cf: ChartFields; spec: ChartSpec; change: (edit: (cur: ChartSettings) => ChartSettings) => void }): MenuItem[];
    ```

- [ ] **Step 1: Write the failing pure tests** (`src/charts/listMenu.test.ts`)

```ts
import { vi } from 'vitest';
import type { ChartFields } from './fields';
import { listItems, tailItems } from './listMenu';
import type { ChartSettings } from './settings';

// A mart with a key, a date, a number and a string: every kind but scatter and spread is eligible.
const date = { name: 'created_at', category: 'date', type: 'TIMESTAMP' } as never;
const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:orders', title: '', hasPk: true, metrics: [{ field: amount, fn: 'SUM' }], dates: [date], dimensions: [dim] }], dates: [date], dimensions: [dim], counter: null };

test('the header list has the cards, Sparklines, one tick per chart and Add chart with the eligible kinds', () => {
  const change = vi.fn();
  const items = listItems({ cf, settings: {}, resolved: [{ spec: { id: 'time-series', kind: 'timeSeries' }, title: 'amount · Sum by date' }, { spec: { id: 'pie', kind: 'pie' }, title: null }], change });
  // Card labels come from metricLabel: the field label (no alias here) and AGG_LABELS.SUM.
  expect(items.map((i) => i.label)).toEqual(['Unique Records', 'amount · Sum', 'Sparklines', 'amount · Sum by date', 'Pie (columns hidden)', 'Add chart']);
  const add = items.at(-1)!;
  // Later tasks register more kinds: only the two that exist now are pinned; scatter and spread are not eligible for this mart.
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).toEqual(expect.arrayContaining(['Time series', 'Pie']));
  expect(add.kind === 'radio' && add.options.map((o) => o.label)).not.toContain('Scatter');
});

test('unticking a chart hides it and keeps its setup; Add chart appends a new chart', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', dimension: 'status' }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const items = () => listItems({ cf, settings: s, resolved: (s.charts ?? []).map((spec) => ({ spec, title: 'P' })), change });
  const tick = items().find((i) => i.label === 'P')!;
  if (tick.kind === 'check') tick.onToggle();
  expect(s.charts).toEqual([{ id: 'a', kind: 'pie', dimension: 'status', hidden: true }]);
  const add = items().at(-1)!;
  if (add.kind === 'radio') add.onPick('timeSeries');
  expect(s.charts!.map((c) => c.kind)).toEqual(['pie', 'timeSeries']);
  expect(s.charts![1]!.id).toMatch(/^c-/);
});

test('Chart type keeps the usable fields and the id; Remove deletes; removing the last chart saves an empty list', () => {
  let s: ChartSettings = { version: 2, charts: [{ id: 'a', kind: 'pie', measure: 'amount', dimension: 'status', hidden: false }] };
  const change = (edit: (c: ChartSettings) => ChartSettings) => { s = edit(s); };
  const [type, remove] = tailItems({ cf, spec: s.charts![0]!, change });
  expect(type!.label).toBe('Chart type');
  if (type!.kind === 'radio') type!.onPick('timeSeries');
  expect(s.charts).toEqual([{ id: 'a', kind: 'timeSeries', measure: 'amount', hidden: false }]);
  if (remove!.kind === 'action') remove!.onPick();
  expect(s).toEqual({ version: 2, charts: [] });
});
```

(If `AGG_LABELS.SUM` in `src/model/aggregation.ts:23` is not `Sum`, use its value in the expected labels.)

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/listMenu.test.ts`
Expected: FAIL, module `./listMenu` not found.

- [ ] **Step 3: Implement `listMenu.ts`**

```ts
import type { MenuItem } from './ChartMenu';
import type { ChartFields } from './fields';
import { eligibleKinds, KINDS } from './kinds';
import { cardsOf } from './Scorecards';
import { editCharts, newChartId, patchChart, type ChartKind, type ChartSettings, type ChartSpec } from './settings';

type Change = (edit: (cur: ChartSettings) => ChartSettings) => void;

/** The Data band header's Charts menu: scorecard ticks, Sparklines, a tick per chart (hide/show, setup kept) and Add chart. */
export function listItems({ cf, settings, resolved, change }: { cf: ChartFields; settings: ChartSettings; resolved: { spec: ChartSpec; title: string | null }[]; change: Change }): MenuItem[] {
  const hidden = new Set(settings.scorecards?.hidden ?? []);
  const toggleCard = (id: string) => change((cur) => {
    const h = new Set(cur.scorecards?.hidden ?? []);
    if (!h.delete(id)) h.add(id);
    return { ...cur, scorecards: { ...cur.scorecards, hidden: [...h] } };
  });
  return [
    ...cf.marts.flatMap((m, i) => cardsOf(m).map((c): MenuItem => ({ kind: 'check', label: i === 0 ? c.label : `${m.title} · ${c.label}`, checked: !hidden.has(c.id), onToggle: () => toggleCard(c.id) }))),
    { kind: 'check', label: 'Sparklines', checked: settings.scorecards?.sparklines ?? true, onToggle: () => change((cur) => ({ ...cur, scorecards: { ...cur.scorecards, sparklines: !(cur.scorecards?.sparklines ?? true) } })) },
    ...resolved.map(({ spec, title }): MenuItem => ({
      kind: 'check',
      // A chart that cannot draw with the shown columns keeps its place and setup; its title needs fields, so it is named by type.
      label: title ?? `${KINDS[spec.kind]?.label ?? spec.kind} (columns hidden)`,
      checked: !spec.hidden,
      onToggle: () => change((cur) => patchChart(cur, spec.id, { hidden: !spec.hidden })),
    })),
    {
      kind: 'radio', label: 'Add chart', value: '',
      options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label })),
      onPick: (v) => change((cur) => editCharts(cur, (list) => [...list, { id: newChartId(), ...KINDS[v as ChartKind]!.create(cf) }])),
    },
  ];
}

/** The rows every chart's own menu ends with: Chart type (the eligible kinds; usable fields, id and hidden kept) and Remove. */
export function tailItems({ cf, spec, change }: { cf: ChartFields; spec: ChartSpec; change: Change }): MenuItem[] {
  return [
    {
      kind: 'radio', label: 'Chart type', value: spec.kind,
      options: eligibleKinds(cf).map((k) => ({ value: k.kind, label: k.label })),
      onPick: (v) => change((cur) => editCharts(cur, (list) => list.map((c) => (c.id === spec.id ? { id: c.id, ...(c.hidden !== undefined ? { hidden: c.hidden } : {}), ...KINDS[v as ChartKind]!.create(cf, c) } : c)))),
    },
    { kind: 'action', label: 'Remove', onPick: () => change((cur) => editCharts(cur, (list) => list.filter((c) => c.id !== spec.id))) },
  ];
}
```

The labels of the card ticks must equal today's (the first test asserts `Unique Records`, `Amount · Sum`).

- [ ] **Step 4: Run the pure tests**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/listMenu.test.ts`
Expected: PASS.

- [ ] **Step 5: Slot in the header** (`src/charts/menuSlot.ts`, `src/ui/bands/DataBand.tsx`)

```ts
// src/charts/menuSlot.ts
import { createContext } from 'react';
/** The header element the Charts list menu portals into: next to the Table / Charts switch. Null outside the Data band. */
export const ChartsMenuSlot = createContext<HTMLElement | null>(null);
```

In `DataBand`:

```tsx
const [slot, setSlot] = useState<HTMLElement | null>(null);
// …in afterHint, right after the ViewSwitch:
{gridMart?.accessible && saved?.view === 'charts' && <span ref={setSlot} data-chart-list-slot className="inline-flex" />}
// …and wrap the MartGrid:
<ChartsMenuSlot.Provider value={slot}><MartGrid … /></ChartsMenuSlot.Provider>
```

- [ ] **Step 6: Wire `ChartsBody`**

1. Remove the `items` array, `patch`, `toggleCard` and the `<ChartMenu name="Scorecards" … />` from the scorecard cell.
2. Read the slot and portal the list menu once the doc has loaded:

```tsx
const slot = useContext(ChartsMenuSlot);
const resolved = drawn.map(({ spec, def }) => {
  const r = def?.resolve({ ...spec, hidden: false }, cf) ?? null;
  return { spec, title: def && r ? def.title(r, cf) : null };
});
// …inside the returned JSX, anywhere in the first row's main cell:
{slot && settings && createPortal(<ChartMenu name="Charts" items={listItems({ cf, settings, resolved, change })} />, slot)}
```

3. Pass `tail={tailItems({ cf, spec, change })}` to each panel instead of `[]`.

- [ ] **Step 7: Body tests for the header menu**

In `src/charts/charts-body.test.tsx`, replace every `'Scorecards options'` with `'Charts options'` and add:

```tsx
test('the Charts menu sits in the band header and adds, hides and removes charts', async () => {
  const t = await charts();
  const header = data().querySelector('[data-chart-list-slot]')!;
  await userEvent.click(within(header as HTMLElement).getByRole('button', { name: 'Charts options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Add chart' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pie' }));
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(3));
  const added = (t.puts.mock.lastCall![1] as ChartSettings).charts!;
  expect(added.map((c) => c.kind)).toEqual(['timeSeries', 'pie', 'pie']);

  await userEvent.click(within(header as HTMLElement).getByRole('button', { name: 'Charts options' }));
  await userEvent.click(screen.getAllByRole('menuitemcheckbox', { name: /^Amount · Sum by / })[0]!);
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(2));

  const pies = screen.getAllByRole('button', { name: 'Pie options' });
  await userEvent.click(pies[1]!);
  await userEvent.click(screen.getByRole('menuitem', { name: 'Remove' }));
  await waitFor(() => expect(data().querySelectorAll('section.dm-chart')).toHaveLength(1));
});

test('a hidden chart sends no query', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'p', kind: 'pie', hidden: true }] } });
  await waitFor(() => expect(group('orders')).not.toBeNull());
  expect(t.queries.filter((q) => q.limit === 8)).toHaveLength(0);
});

test('a chart whose fields are not shown is listed as columns hidden and drawn again when they return', async () => {
  await charts({ columns: ['id', 'amount', 'created_at'], charts: { version: 2, charts: [{ id: 'p', kind: 'pie', dimension: 'status' }] } });
  expect(data().querySelectorAll('section.dm-chart')).toHaveLength(0);
  await userEvent.click(screen.getByRole('button', { name: 'Charts options' }));
  expect(screen.getByRole('menuitemcheckbox', { name: 'Pie (columns hidden)' })).toBeTruthy();
});

test('Chart type switches a chart in place and keeps its usable saved fields', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'p', kind: 'pie', measure: 'amount', dimension: 'status' }] } });
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Time series' }));
  expect(t.puts).toHaveBeenLastCalledWith('orders', { version: 2, charts: [{ id: 'p', kind: 'timeSeries', measure: 'amount' }] });
});
```

(The last test exercises Review Focus 3 through the kinds registered so far; Task 5 adds the ranked-bar half: see its Step 1.)

- [ ] **Step 8: Run tests and checks**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts src/ui/bands`
Expected: PASS.
Run: `npx tsc -b && npx eslint src`
Expected: no errors.

- [ ] **Step 9: Commit**

```bash
git add -A src/charts src/ui/bands/DataBand.tsx
git commit -m "Charts: a Charts menu in the band header lists, adds, hides and removes charts; each chart switches type

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Queries for heatmap, scatter and spread

**Files:**
- Modify: `src/charts/queries.ts`
- Test: `src/charts/queries.test.ts`

**Interfaces:**
- Produces (exported from `src/charts/queries.ts`):
  - `SCATTER_LIMIT = 200`
  - `type HeatX = { kind: 'date'; date: Field; bucket: DateBucket } | { kind: 'dim'; dim: Field; top: string[] }`
  - `heatmapQuery(x: HeatX, y: Field, yTop: string[], measure: Measure, filter: TraverseFilter[]): TraverseOptions`
  - `scatterQuery(dim: Field, x: Measure, y: Measure, filter: TraverseFilter[]): TraverseOptions`
  - `spreadFns(field: Field): AggFn[]` (`['P50','P25','P75']` plus `'MIN','MAX'` when both allowed; `[]` when a percentile is missing)
  - `spreadQuery(dim: Field, field: Field, filter: TraverseFilter[]): TraverseOptions`

- [ ] **Step 1: Write the failing tests** (append to `src/charts/queries.test.ts`)

```ts
import { heatmapQuery, SCATTER_LIMIT, scatterQuery, spreadFns, spreadQuery } from './queries';

const fld = (name: string, category: string, extra: object = {}) => ({ name, category, type: category === 'number' ? 'NUMERIC' : category === 'date' ? 'DATE' : 'STRING', ...extra }) as never;
const status = fld('status', 'string');
const channel = fld('channel', 'string');
const day = fld('day', 'date');
const amount = fld('amount', 'number');
const sum = { kind: 'metric', metric: { field: amount, fn: 'SUM' } } as const;
const recs = { kind: 'records', aliasPath: '', recordsId: 'records:M' } as const;

test('heatmap by date buckets the date and keeps the rows to the top list', () => {
  expect(heatmapQuery({ kind: 'date', date: day, bucket: 'MONTH' }, status, ['a', 'b'], sum, [])).toEqual({
    column: ['day', 'status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }],
    dateTrunc: [{ column: 'day', unit: 'MONTH' }], sort: [{ column: 'day', direction: 'asc' }],
    filter: [{ column: 'status', operator: 'is_not_blank' }, { column: 'status', operator: 'in', value: ['a', 'b'] }],
  });
});

test('heatmap by two dimensions keeps both axes to their top lists', () => {
  const o = heatmapQuery({ kind: 'dim', dim: channel, top: ['x'] }, status, ['a'], recs, []);
  expect(o.column).toEqual(['channel', 'status']);
  expect(o.uniqueCount).toEqual(['']);
  expect(o.filter).toEqual([
    { column: 'status', operator: 'is_not_blank' }, { column: 'status', operator: 'in', value: ['a'] },
    { column: 'channel', operator: 'is_not_blank' }, { column: 'channel', operator: 'in', value: ['x'] },
  ]);
});

test('scatter reads two measures per dimension value, the top 200 by X', () => {
  const avg = { kind: 'metric', metric: { field: amount, fn: 'AVG' } } as const;
  expect(scatterQuery(status, sum, avg, [])).toEqual({
    column: ['status', 'amount'], aggregation: [{ column: 'amount', function: 'SUM' }, { column: 'amount', function: 'AVG' }],
    sort: [{ column: 'amount', direction: 'desc' }], limit: SCATTER_LIMIT,
    filter: [{ column: 'status', operator: 'is_not_blank' }],
  });
});

test('spread needs the three percentiles; whiskers only when MIN and MAX are allowed', () => {
  expect(spreadFns(amount)).toEqual([]);
  const governed = fld('net', 'number', { allowedAggregations: ['P25', 'P50', 'P75', 'MIN', 'MAX'] });
  expect(spreadFns(governed)).toEqual(['P50', 'P25', 'P75', 'MIN', 'MAX']);
  expect(spreadFns(fld('n2', 'number', { allowedAggregations: ['P25', 'P50', 'P75'] }))).toEqual(['P50', 'P25', 'P75']);
  expect(spreadQuery(status, governed, [])).toEqual({
    column: ['status', 'net'], aggregation: ['P50', 'P25', 'P75', 'MIN', 'MAX'].map((fn) => ({ column: 'net', function: fn })),
    sort: [{ column: 'net', direction: 'desc' }], limit: 8, filter: [{ column: 'status', operator: 'is_not_blank' }],
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/queries.test.ts`
Expected: FAIL, exports missing.

- [ ] **Step 3: Implement** (append to `src/charts/queries.ts`; `measureColumns`, `measureParts`, `aggs`, `fit`, `withFilter`, `notBlank`, `list`, `truncRule` already exist in this module)

```ts
import { allowedFunctions, type AggFn } from '../model/aggregation';

export const SCATTER_LIMIT = 200;
export type HeatX = { kind: 'date'; date: Field; bucket: DateBucket } | { kind: 'dim'; dim: Field; top: string[] };

/** One cell per (x, y): rows kept to the top values of y (and of x when it is a dimension); a date x is bucketed. */
export function heatmapQuery(x: HeatX, y: Field, yTop: string[], measure: Measure, filter: TraverseFilter[]): TraverseOptions {
  const xCol = x.kind === 'date' ? x.date.name : x.dim.name;
  const o: TraverseOptions = {
    column: [xCol, y.name, ...measureColumns(measure)],
    ...measureParts(measure),
    ...(x.kind === 'date' ? { dateTrunc: [truncRule(x.date, x.bucket)], sort: [{ column: xCol, direction: 'asc' as const }] } : {}),
  };
  const axes: TraverseFilter[] = [notBlank(y), { column: y.name, operator: 'in', value: list(yTop) }, ...(x.kind === 'dim' ? [notBlank(x.dim), { column: x.dim.name, operator: 'in', value: list(x.top) } as TraverseFilter] : [])];
  return { ...o, filter: [...fit(o, filter), ...axes] };
}

const columnsOf = (ms: Measure[]): string[] => [...new Set(ms.flatMap(measureColumns))];

/** Two measures per value of a dimension, the top SCATTER_LIMIT values by X. A sort on an aggregated column sorts by its first function, so X's rule comes first. */
export function scatterQuery(dim: Field, x: Measure, y: Measure, filter: TraverseFilter[]): TraverseOptions {
  const metrics = [x, y].flatMap((m) => (m.kind === 'metric' ? [m.metric] : []));
  const paths = [...new Set([x, y].flatMap((m) => (m.kind === 'records' ? [m.aliasPath] : [])))];
  const o: TraverseOptions = {
    column: [dim.name, ...columnsOf([x, y])],
    ...(metrics.length ? { aggregation: aggs(metrics) } : {}),
    ...(paths.length ? { uniqueCount: paths } : {}),
    sort: [{ column: x.kind === 'metric' ? x.metric.field.name : measureKey(x), direction: 'desc' }],
    limit: SCATTER_LIMIT,
  };
  return { ...o, filter: [...fit(o, filter), notBlank(dim)] };
}

/** The functions a spread reads: the median first (it sorts the rows), the quartiles, and the whiskers when governance allows them. Empty when a percentile is not allowed. */
export function spreadFns(field: Field): AggFn[] {
  const allowed = allowedFunctions(field);
  if (!(['P25', 'P50', 'P75'] as const).every((fn) => allowed.includes(fn))) return [];
  return ['P50', 'P25', 'P75', ...(allowed.includes('MIN') && allowed.includes('MAX') ? (['MIN', 'MAX'] as const) : [])];
}

export function spreadQuery(dim: Field, field: Field, filter: TraverseFilter[]): TraverseOptions {
  const o: TraverseOptions = {
    column: [dim.name, field.name],
    aggregation: spreadFns(field).map((fn) => ({ column: field.name, function: fn })),
    sort: [{ column: field.name, direction: 'desc' }],
    limit: TOP_N,
  };
  return { ...o, filter: [...fit(o, filter), notBlank(dim)] };
}
```

If the existing `notBlank` / `list` / `measureColumns` are declared with `const` after this point, move these functions below them.

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/queries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/charts/queries.ts src/charts/queries.test.ts
git commit -m "Charts: queries for heatmap, scatter and spread

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ranked bar

**Files:**
- Create: `src/charts/kinds/rankedBar.tsx`, `src/charts/kinds/rankedBar.test.ts`
- Modify: `src/charts/kinds/index.ts` (register after `pie`)
- Test: `src/charts/charts-body.test.tsx`

**Interfaces:**
- Consumes: `topValuesQuery`, `pieOtherQuery`, `TOP_N`, `BarChart`, `dimensionFilter`, `measureOptions`, `measuresOf`, `pickMeasure`, `pickField`, `carry`, `BOX_WIDTH`, `tickText`, `seriesColor`, `OTHER_COLOR`.
- Produces: `rankedBar: ChartKindDef<RankedR>`, `type RankedR = { measure: Measure; dimension: Field }`, `OTHER_X = '\u0000other'`.

- [ ] **Step 1: Write the failing tests**

`src/charts/kinds/rankedBar.test.ts`:

```ts
import type { ChartFields } from '../fields';
import { rankedBar } from './rankedBar';

const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const amount = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: amount, fn: 'AVG' }], dates: [], dimensions: [dim] }], dates: [], dimensions: [dim], counter: null };

test('ranked bar: eligible with a dimension and any measure, AVG included', () => {
  expect(rankedBar.eligible(cf)).toBe(true);
  const r = rankedBar.resolve({ id: 'x', kind: 'rankedBar', measure: 'amount' }, cf)!;
  expect(r.measure).toMatchObject({ kind: 'metric', metric: { fn: 'AVG' } });
  expect(r.dimension).toBe(dim);
  expect(rankedBar.title(r, cf)).toBe('amount · Average by status');
});

test('ranked bar: a switch keeps measure and dimension', () => {
  expect(rankedBar.create(cf, { id: 'p', kind: 'pie', measure: 'amount', dimension: 'status', date: 'd' })).toEqual({ kind: 'rankedBar', measure: 'amount', dimension: 'status' });
});
```

(Use the label `AGG_LABELS.AVG` actually produces for the title assertion; read it from `src/model/aggregation.ts:23` and adjust the string.)

Append to `src/charts/charts-body.test.tsx` (completes Review Focus 3):

```tsx
test('a ranked bar draws one bar per top value; switching its AVG measure to pie draws a summed pie', async () => {
  const t = await charts({ charts: { version: 2, charts: [{ id: 'r', kind: 'rankedBar', measure: 'amount', dimension: 'status' }] } });
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Ranked bar"] svg[data-orientation="horizontal"]')).not.toBeNull());
  await userEvent.click(screen.getByRole('button', { name: 'Ranked bar options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Chart type' }));
  await userEvent.click(screen.getByRole('menuitemradio', { name: 'Pie' }));
  await waitFor(() => expect(data().querySelector('section[data-chart-kind="Pie"] [data-slice]')).not.toBeNull());
  expect(t.queries.at(-1)!.aggregation?.[0]?.function).toBe('SUM');
  expect((t.puts.mock.lastCall![1] as ChartSettings).charts).toEqual([{ id: 'r', kind: 'pie', measure: 'amount', dimension: 'status' }]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/kinds/rankedBar.test.ts src/charts/charts-body.test.tsx`
Expected: FAIL, module missing / kind not registered.

- [ ] **Step 3: Implement** (`src/charts/kinds/rankedBar.tsx`)

```tsx
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import { measureKey, pieOtherQuery, TOP_N, topValuesQuery, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { BarChart, type Series } from '../svg/BarChart';
import { useChartQuery } from '../useChartQuery';
import { OTHER_COLOR, seriesColor, tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type RankedR = { measure: Measure; dimension: Field };
/** The x of the "Other" bar: never a real value, so it is never filtered to. */
export const OTHER_X = '\u0000other';

function RankedBarPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<RankedR>) {
  const { measure, dimension: dim } = r;
  const top = useChartQuery(martId, idle ? null : topValuesQuery(dim, measure, filter), version);
  const names = top.rows?.map((row) => String(row[dim.name]));
  const needOther = names?.length === TOP_N;
  const other = useChartQuery(martId, !idle && needOther ? pieOtherQuery(measure, filter, dim, names!, cf.counter) : null, version);
  const failed = [top, other].find((q) => q.error);
  const empty = top.rows?.length === 0;
  const loading = !empty && (!top.rows || (needOther && !other.rows));
  const key = measureKey(measure);
  const point = (x: string, label: string, v: unknown) => ({ x, label, y: numberOf(v), valueText: measureText(measure, v, formatOf) });
  const otherRow = other.rows?.[0];
  const series = (): Series[] => [{ name: measureLabel(cf, measure), color: seriesColor(0), points: [
    ...top.rows!.map((row, i) => point(names![i]!, names![i]!, row[key])),
    ...(needOther && otherRow && otherRow[key] != null ? [point(OTHER_X, 'Other', otherRow[key])] : []),
  ] }];
  const [tickType, tickFormat] = measureFormat(measure, formatOf);
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    ...tail,
  ];
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Ranked bar" items={ready ? items : null} width={BOX_WIDTH}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(dim)} are not shown.`}>
      {top.rows && !loading && <BarChart series={series()} orientation="horizontal" ariaLabel={title} stacked={false}
        formatTick={(n) => tickText(n, tickType, tickFormat)} onPick={(x) => onFilter([dimensionFilter(dim, x)])} canPick={(x) => x !== OTHER_X} />}
    </ChartPanel>
  );
}
void OTHER_COLOR; // the single series keeps one colour; Other is told apart by its label and is not clickable

export const rankedBar: ChartKindDef<RankedR> = {
  kind: 'rankedBar',
  label: 'Ranked bar',
  eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'rankedBar', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    const dimension = pickField(cf.dimensions, spec.dimension);
    return measure && dimension ? { measure, dimension } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.dimension)}`,
  Panel: RankedBarPanel,
};
```

Remove the `void OTHER_COLOR` line and the `OTHER_COLOR` import if lint flags them as unused; they are not needed.

- [ ] **Step 4: Register and run**

In `src/charts/kinds/index.ts` import `rankedBar` and set `KINDS = { timeSeries, pie, rankedBar }`.
Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A src/charts
git commit -m "Charts: a ranked bar chart of a measure by a dimension's top values

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Line / area chart with an optional second measure

**Files:**
- Create: `src/charts/svg/LineChart.tsx`, `src/charts/kinds/line.tsx`, `src/charts/kinds/line.test.ts`
- Modify: `src/charts/kinds/index.ts`, `src/charts/svg/charts.test.tsx`

**Interfaces:**
- Consumes: `useDateSeries`, `useBucket`, `dateMenu`, `tickText`, `seriesWidth`, `Series`, `bucketFilter`, `dimensionFilter`, `isBucketDate`, `bucketZone`.
- Produces:
  - `LineChart({ left: Series[]; right?: Series | null; area: boolean; ariaLabel: string; formatLeft: (n: number) => string; formatRight?: (n: number) => string; onPick?: (x: string, seriesIndex?: number) => void; canPick?: (x: string) => boolean; xTitle?: string })`
  - `line: ChartKindDef<LineR>`, `type LineR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; measure2: Measure | null; stack: Field | null; area: boolean }`

- [ ] **Step 1: Write the failing tests**

`src/charts/kinds/line.test.ts`:

```ts
import type { ChartFields } from '../fields';
import { line } from './line';

const date = { name: 'day', category: 'date', type: 'DATE' } as never;
const dim = { name: 'status', category: 'string', type: 'STRING' } as never;
const a = { name: 'a', category: 'number', type: 'NUMERIC' } as never;
const b = { name: 'b', category: 'number', type: 'NUMERIC' } as never;
const cf: ChartFields = { marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: a, fn: 'SUM' }, { field: b, fn: 'SUM' }], dates: [date], dimensions: [dim] }], dates: [date], dimensions: [dim], counter: null };

test('line: no second measure by default; a second measure turns the stack off', () => {
  expect(line.resolve({ id: 'l', kind: 'line', stack: 'status' }, cf)).toMatchObject({ measure2: null, stack: dim, area: false });
  const two = line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'b', stack: 'status', area: true }, cf)!;
  expect(two.measure2).toMatchObject({ metric: { field: b } });
  expect(two.stack).toBeNull();
  expect(two.area).toBe(true);
});

test('line: a saved second measure equal to the first, or not shown, is off', () => {
  expect(line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'a' }, cf)!.measure2).toBeNull();
  expect(line.resolve({ id: 'l', kind: 'line', measure: 'a', measure2: 'gone' }, cf)!.measure2).toBeNull();
});
```

Append to `src/charts/svg/charts.test.tsx`:

```tsx
import { LineChart } from './LineChart';

const pts = (ys: (number | null)[]) => ys.map((y, i) => ({ x: `2026-0${i + 1}-01`, label: `M${i + 1}`, y, valueText: String(y) }));

test('LineChart draws one path per series, a right axis for the second measure and area fills when asked', () => {
  const { container } = render(<LineChart left={[{ name: 'A', color: 'red', points: pts([1, 3, 2]) }]} right={{ name: 'B', color: 'blue', points: pts([100, 50, 80]) }}
    area ariaLabel="A and B" formatLeft={String} formatRight={(n) => `${n}%`} />);
  expect(container.querySelectorAll('path[data-line]')).toHaveLength(2);
  expect(container.querySelectorAll('path[data-area]')).toHaveLength(2);
  expect(container.querySelector('[data-axis="right"]')).not.toBeNull();
  expect(screen.getByRole('img', { name: 'A and B' })).toBeTruthy();
});

test('LineChart: a null value breaks the line; a bucket is pickable by keyboard', async () => {
  const onPick = vi.fn();
  const { container } = render(<LineChart left={[{ name: 'A', color: 'red', points: pts([1, null, 2]) }]} area={false} ariaLabel="A" formatLeft={String} onPick={onPick} />);
  expect(container.querySelector('path[data-line]')!.getAttribute('d')!.match(/M/g)).toHaveLength(2);
  const first = screen.getByRole('button', { name: 'Filter to M1' });
  first.focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('2026-01-01');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/kinds/line.test.ts src/charts/svg/charts.test.tsx`
Expected: FAIL, modules missing.

- [ ] **Step 3: Implement `LineChart`** (`src/charts/svg/LineChart.tsx`)

```tsx
import type { KeyboardEvent } from 'react';
import { Tooltip, TipLines } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';
import type { Series } from './BarChart';

const PLOT_H = 240;
const TOP = 8;
const AXIS_H = 24;
const TITLE_H = 18;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** Lines (and optional area fills) over buckets; a second measure on its own right axis. Positions are ratios for drawing only; every shown value is the caller's text. */
export function LineChart({ left, right = null, area, ariaLabel, formatLeft, formatRight = formatLeft, onPick, canPick, xTitle }: {
  left: Series[]; right?: Series | null; area: boolean; ariaLabel: string; formatLeft: (n: number) => string; formatRight?: (n: number) => string;
  onPick?: (x: string, seriesIndex?: number) => void; canPick?: (x: string) => boolean; xTitle?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const xs = left[0]?.points ?? [];
  const maxOf = (ss: Series[]) => Math.max(0, ...ss.flatMap((s) => s.points.map((p) => p.y ?? 0)));
  const maxL = maxOf(left);
  const maxR = right ? maxOf([right]) : 0;
  const ticks = [0, 1, 2, 3].map((t) => t / 3);
  const leftW = Math.max(32, Math.max(...ticks.map((t) => formatLeft(t * maxL).length)) * CHAR_W + 12);
  const rightW = right ? Math.max(32, Math.max(...ticks.map((t) => formatRight(t * maxR).length)) * CHAR_W + 12) : 8;
  const plotW = Math.max(20, width - leftW - rightW);
  const step = xs.length > 1 ? plotW / (xs.length - 1) : 0;
  const px = (i: number) => leftW + (xs.length > 1 ? i * step : plotW / 2);
  const py = (y: number, max: number) => TOP + PLOT_H - (max > 0 ? y / max : 0) * PLOT_H;
  const height = TOP + PLOT_H + AXIS_H + (xTitle ? TITLE_H : 0);
  const pathOf = (s: Series, max: number) => {
    let d = ''; let open = false;
    s.points.forEach((p, i) => {
      if (p.y === null) { open = false; return; }
      d += `${open ? ' L' : `${d ? ' ' : ''}M`}${px(i).toFixed(1)} ${py(p.y, max).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const areaOf = (s: Series, max: number) => {
    // One closed shape per unbroken run, down to the zero line.
    const runs: number[][] = []; let run: number[] = [];
    s.points.forEach((p, i) => { if (p.y === null) { if (run.length) runs.push(run); run = []; } else run.push(i); });
    if (run.length) runs.push(run);
    return runs.map((r) => `M${px(r[0]!).toFixed(1)} ${TOP + PLOT_H} ${r.map((i) => `L${px(i).toFixed(1)} ${py(s.points[i]!.y!, max).toFixed(1)}`).join(' ')} L${px(r.at(-1)!).toFixed(1)} ${TOP + PLOT_H} Z`).join(' ');
  };
  const all = right ? [...left.map((s) => ({ s, max: maxL })), { s: right, max: maxR }] : left.map((s) => ({ s, max: maxL }));
  const pickable = (x: string) => !!onPick && (canPick?.(x) ?? true);
  const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((p) => p.label.length), 0) * CHAR_W + 8) / Math.max(1, step || plotW)));
  const band = xs.length > 1 ? step : plotW;
  return (
    <div ref={ref} className="dm-line-chart">
      <svg role={xs.some((p) => pickable(p.x)) ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line className="dm-chart-grid" x1={leftW} x2={leftW + plotW} y1={py(t * maxL, maxL)} y2={py(t * maxL, maxL)} />
            <text className="dm-chart-text" x={leftW - 6} y={py(t * maxL, maxL)} textAnchor="end" dominantBaseline="middle">{formatLeft(t * maxL)}</text>
            {right && <text data-axis="right" className="dm-chart-text" x={leftW + plotW + 6} y={py(t * maxR, maxR)} dominantBaseline="middle">{formatRight(t * maxR)}</text>}
          </g>
        ))}
        {xs.map((p, i) => (i % labelStep === 0 ? <text key={p.x} className="dm-chart-text" x={px(i)} y={TOP + PLOT_H + 16} textAnchor="middle">{p.label}</text> : null))}
        {xTitle && <text className="dm-chart-axis-title" x={leftW + plotW / 2} y={TOP + PLOT_H + AXIS_H + 10} textAnchor="middle">{xTitle}</text>}
        {area && all.map(({ s, max }) => <path key={`a-${s.name}`} data-area={s.name} d={areaOf(s, max)} fill={s.color} fillOpacity={0.18} stroke="none" />)}
        {all.map(({ s, max }, k) => <path key={s.name} data-line={s.name} d={pathOf(s, max)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={right && k === all.length - 1 ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {xs.map((p, i) => {
          const content = <TipLines lines={[p.label, ...all.filter(({ s }) => s.points[i]?.y != null).map(({ s }) => <span key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} /> {s.name}: {s.points[i]!.valueText}</span>)]} />;
          const pick = pickable(p.x) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${p.label}`, style: { cursor: 'pointer' }, onClick: () => onPick!(p.x), onKeyDown: press(() => onPick!(p.x)) } : {};
          return <Tooltip key={p.x} content={content}><rect data-bucket={p.x} fill="transparent" x={px(i) - band / 2} y={TOP} width={band} height={PLOT_H} {...pick} /></Tooltip>;
        })}
      </svg>
      {all.length > 1 && (
        <ul className="dm-chart-legend">
          {all.map(({ s }, k) => <li key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} />{s.name}{right && k === all.length - 1 ? ' (right axis)' : ''}</li>)}
        </ul>
      )}
      <table className="sr-only">
        <thead><tr><th>{xTitle ?? 'Bucket'}</th>{all.map(({ s }) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((p, i) => <tr key={p.x}><th scope="row">{p.label}</th>{all.map(({ s }) => <td key={s.name}>{s.points[i]?.valueText ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Implement the kind** (`src/charts/kinds/line.tsx`)

```tsx
import { BUCKET_LABELS, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { bucketFilter, dimensionFilter, isBucketDate } from '../clickFilters';
import { measuresOf } from '../fields';
import { bucketZone, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure } from '../settings';
import { LineChart } from '../svg/LineChart';
import { useBucket } from '../useBucket';
import { seriesColor, useDateSeries } from '../useDateSeries';
import { dateMenu, tickText } from './timeSeries';
import { carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

export type LineR = { date: Field; bucket: DateBucket | 'AUTO'; measure: Measure; measure2: Measure | null; stack: Field | null; area: boolean };

function LinePanel({ martId, cf, r, spark, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<LineR>) {
  const { date, measure, measure2, stack } = r;
  const { bucket, error, retry } = useBucket(martId, date, r.bucket, filter, version, idle);
  const range = { error, retry };
  const one = useDateSeries({ martId, cf, spark, date, bucket, measure, stack, filter, version, idle, formatOf, range });
  // The second measure is its own unstacked series; with none, its hook reads nothing.
  const two = useDateSeries({ martId, cf, spark, date, bucket, measure: measure2 ?? measure, stack: null, filter, version, idle: idle || !measure2, formatOf });
  const failed = one.failed ?? (measure2 ? two.failed : undefined);
  const loading = one.loading || (!!measure2 && two.loading);
  const [lt, lf] = measureFormat(measure, formatOf);
  const [rt, rf] = measure2 ? measureFormat(measure2, formatOf) : [lt, lf];
  const others = measureOptions(cf, measuresOf(cf)).filter((o) => o.value !== measureId(measure));
  const items: MenuItem[] = [
    ...dateMenu(cf, r, onChange),
    { kind: 'radio', label: 'Second measure', value: measure2 ? measureId(measure2) : '', options: [{ value: '', label: 'Off' }, ...others], onPick: (v) => onChange({ measure2: v === '' ? null : v }) },
    ...(measure2 ? [] : [{ kind: 'radio', label: 'Stack by', value: stack?.name ?? '', options: [{ value: '', label: 'No stacking' }, ...cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) }))], onPick: (v: string) => onChange({ stack: v === '' ? null : v }) } as MenuItem]),
    { kind: 'check', label: 'Area', checked: r.area, onToggle: () => onChange({ area: !r.area }) },
    ...tail,
  ];
  const by = BUCKET_LABELS[bucket ?? 'DAY'].toLowerCase();
  const title = `${one.label}${measure2 ? ` and ${two.label}` : ''} by ${by}${stack ? ` · by ${fieldLabel(stack)}` : ''}`;
  const rightSeries = measure2 && two.series?.[0] ? { ...two.series[0], color: seriesColor(1) } : null;
  return (
    <ChartPanel title={bucket ? title : `${one.label} by date`} name="Line" items={ready ? items : null} width={seriesWidth(one.series?.[0]?.points.length ?? null)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={one.empty ? emptyText(hasFilters) : null}
      note={stack ? `Rows with a blank ${fieldLabel(stack)} are not shown.` : undefined}>
      {one.series && !loading && (() => {
        const left = one.series;
        const pick = (x: string, i?: number) => onFilter([bucketFilter(date, x, bucket!, bucketZone(date)), ...(stack && i !== undefined && !left[i]!.other ? [dimensionFilter(stack, left[i]!.name)] : [])]);
        return <LineChart left={left} right={rightSeries} area={r.area} ariaLabel={title} formatLeft={(n) => tickText(n, lt, lf)} formatRight={(n) => tickText(n, rt, rf)} onPick={bucket ? pick : undefined} canPick={isBucketDate} xTitle={columnTitle(date)} />;
      })()}
    </ChartPanel>
  );
}

export const line: ChartKindDef<LineR> = {
  kind: 'line',
  label: 'Line',
  eligible: (cf) => cf.dates.length > 0 && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'line', ...carry(from, ['measure', 'measure2', 'date', 'bucket', 'stack', 'area']) }),
  resolve(spec, cf) {
    const date = pickField(cf.dates, spec.date);
    const list = measuresOf(cf);
    const measure = pickMeasure(list, spec.measure);
    if (!date || !measure) return null;
    const measure2 = list.find((m) => measureId(m) === spec.measure2 && measureId(m) !== measureId(measure)) ?? null;
    return { date, bucket: pickBucketChoice(spec.bucket), measure, measure2, stack: measure2 ? null : pickField(cf.dimensions, spec.stack, null), area: spec.area === true };
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)}${r.measure2 ? ` and ${measureLabel(cf, r.measure2)}` : ''} by date`,
  Panel: LinePanel,
};
```

The time series's left-axis click with a stack picks the series under the cursor only for bars; for lines the bucket alone is filtered (the `i` argument is never passed by `LineChart`), which is intended.

- [ ] **Step 5: Register and run**

Add `line` to `KINDS` after `rankedBar`.
Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/charts
git commit -m "Charts: a line and area chart with an optional second measure on a right axis

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Heatmap

**Files:**
- Create: `src/charts/svg/Heatmap.tsx`, `src/charts/kinds/heatmap.tsx`, `src/charts/kinds/heatmap.test.ts`
- Modify: `src/charts/kinds/index.ts`, `src/charts/svg/charts.test.tsx`

**Interfaces:**
- Consumes: `heatmapQuery`, `HeatX`, `topValuesQuery`, `useBucket`, `bucketFilter`, `dimensionFilter`, `isBucketDate`, `bucketZone`, `formatBucket`.
- Produces:
  - `Heatmap({ xs: Axis[]; ys: Axis[]; cell: (x: string, y: string) => { value: number | null; text: string } | undefined; ariaLabel: string; onPick?: (x: string, y: string) => void; canPickX?: (x: string) => boolean; xTitle?: string; yTitle?: string })` with `type Axis = { key: string; label: string }`
  - `heatmap: ChartKindDef<HeatR>`, `type HeatR = { rows: Field; cols: { kind: 'date'; date: Field; bucket: DateBucket | 'AUTO' } | { kind: 'dim'; dim: Field }; measure: Measure }`

- [ ] **Step 1: Write the failing tests**

`src/charts/kinds/heatmap.test.ts`:

```ts
import type { ChartFields } from '../fields';
import { heatmap } from './heatmap';

const date = { name: 'day', category: 'date', type: 'DATE' } as never;
const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const c = { name: 'channel', category: 'string', type: 'STRING' } as never;
const amt = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const mk = (dates: never[], dims: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics: [{ field: amt, fn: 'SUM' }], dates, dimensions: dims }], dates, dimensions: dims, counter: null });

test('heatmap columns: a saved second dimension, else the date, else another dimension', () => {
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap', dimension: 'status', dimension2: 'channel' }, mk([date], [s, c]))!.cols).toEqual({ kind: 'dim', dim: c });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap', dimension: 'status' }, mk([date], [s, c]))!.cols).toMatchObject({ kind: 'date', date });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap' }, mk([], [s, c]))!.cols).toEqual({ kind: 'dim', dim: c });
  expect(heatmap.resolve({ id: 'h', kind: 'heatmap' }, mk([], [s]))).toBeNull();
  expect(heatmap.eligible(mk([], [s]))).toBe(false);
  expect(heatmap.eligible(mk([date], [s]))).toBe(true);
});
```

Append to `src/charts/svg/charts.test.tsx`:

```tsx
import { Heatmap } from './Heatmap';

test('Heatmap draws a cell per pair with a value, darker for larger values, and picks a cell by keyboard', async () => {
  const onPick = vi.fn();
  const values: Record<string, number> = { 'x1|y1': 1, 'x2|y1': 4 };
  render(<Heatmap xs={[{ key: 'x1', label: 'X1' }, { key: 'x2', label: 'X2' }]} ys={[{ key: 'y1', label: 'Y1' }]} ariaLabel="H"
    cell={(x, y) => (values[`${x}|${y}`] === undefined ? undefined : { value: values[`${x}|${y}`]!, text: String(values[`${x}|${y}`]) })} onPick={onPick} />);
  const cells = document.querySelectorAll('rect[data-cell]');
  expect(cells).toHaveLength(2);
  expect(Number(cells[1]!.getAttribute('fill-opacity'))).toBeGreaterThan(Number(cells[0]!.getAttribute('fill-opacity')));
  screen.getByRole('button', { name: 'Filter to X2, Y1' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('x2', 'y1');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/kinds/heatmap.test.ts src/charts/svg/charts.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Heatmap`** (`src/charts/svg/Heatmap.tsx`)

```tsx
import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type Axis = { key: string; label: string };
const ROW_H = 24;
const TOP = 4;
const AXIS_H = 24;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** A grid of cells, one colour whose strength is the cell's share of the largest value (drawing only); the text is the caller's. */
export function Heatmap({ xs, ys, cell, ariaLabel, onPick, canPickX, xTitle, yTitle }: {
  xs: Axis[]; ys: Axis[]; cell: (x: string, y: string) => { value: number | null; text: string } | undefined; ariaLabel: string;
  onPick?: (x: string, y: string) => void; canPickX?: (x: string) => boolean; xTitle?: string; yTitle?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const left = Math.min(160, Math.max(...ys.map((y) => y.label.length), 0) * CHAR_W + 12);
  const colW = Math.max(8, (width - left - 4) / Math.max(1, xs.length));
  const height = TOP + ys.length * ROW_H + AXIS_H + (xTitle ? 18 : 0);
  const max = Math.max(0, ...xs.flatMap((x) => ys.map((y) => cell(x.key, y.key)?.value ?? 0)));
  const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((x) => x.label.length), 0) * CHAR_W + 8) / colW));
  const pickable = (x: string) => !!onPick && (canPickX?.(x) ?? true);
  return (
    <div ref={ref} className="dm-heatmap">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ys.map((y, j) => <text key={y.key} className="dm-chart-text" x={left - 6} y={TOP + j * ROW_H + ROW_H / 2} textAnchor="end" dominantBaseline="middle">{y.label}</text>)}
        {xs.map((x, i) => (i % labelStep === 0 ? <text key={x.key} className="dm-chart-text" x={left + i * colW + colW / 2} y={TOP + ys.length * ROW_H + 16} textAnchor="middle">{x.label}</text> : null))}
        {xTitle && <text className="dm-chart-axis-title" x={left + (xs.length * colW) / 2} y={TOP + ys.length * ROW_H + AXIS_H + 10} textAnchor="middle">{xTitle}</text>}
        {yTitle && <title>{yTitle}</title>}
        {xs.flatMap((x, i) => ys.map((y, j) => {
          const c = cell(x.key, y.key);
          if (!c || c.value === null) return null;
          const name = `${x.label}, ${y.label}`;
          const pick = pickable(x.key) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${name}`, style: { cursor: 'pointer' }, onClick: () => onPick!(x.key, y.key), onKeyDown: press(() => onPick!(x.key, y.key)) } : {};
          return (
            <Tooltip key={`${x.key}|${y.key}`} content={`${name}: ${c.text}`}>
              <rect data-cell={`${x.key}|${y.key}`} x={left + i * colW + 1} y={TOP + j * ROW_H + 1} width={Math.max(1, colW - 2)} height={ROW_H - 2}
                fill="var(--dm-series-1)" fillOpacity={(0.12 + 0.88 * (max > 0 ? Math.max(0, c.value) / max : 0)).toFixed(3)} {...pick} />
            </Tooltip>
          );
        }))}
      </svg>
      <table className="sr-only">
        <thead><tr><th>{yTitle ?? ''}</th>{xs.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{ys.map((y) => <tr key={y.key}><th scope="row">{y.label}</th>{xs.map((x) => <td key={x.key}>{cell(x.key, y.key)?.text ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Implement the kind** (`src/charts/kinds/heatmap.tsx`)

```tsx
import { BUCKET_LABELS, DATE_BUCKETS, formatBucket, type DateBucket } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { bucketFilter, dimensionFilter, isBucketDate } from '../clickFilters';
import { measuresOf } from '../fields';
import { bucketZone, heatmapQuery, measureKey, topValuesQuery, type Measure } from '../queries';
import { measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickBucketChoice, pickField, pickMeasure } from '../settings';
import { Heatmap } from '../svg/Heatmap';
import { useBucket } from '../useBucket';
import { useChartQuery } from '../useChartQuery';
import { carry, seriesWidth, type ChartKindDef, type PanelProps } from './types';

type Cols = { kind: 'date'; date: Field; bucket: DateBucket | 'AUTO' } | { kind: 'dim'; dim: Field };
export type HeatR = { rows: Field; cols: Cols; measure: Measure };

function HeatmapPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<HeatR>) {
  const { rows: y, cols, measure } = r;
  const date = cols.kind === 'date' ? cols.date : null;
  const { bucket, error, retry } = useBucket(martId, date, cols.kind === 'date' ? cols.bucket : 'AUTO', filter, version, idle || !date);
  const yTop = useChartQuery(martId, idle ? null : topValuesQuery(y, measure, filter), version);
  const xTop = useChartQuery(martId, !idle && cols.kind === 'dim' ? topValuesQuery(cols.dim, measure, filter) : null, version);
  const yNames = yTop.rows?.map((row) => String(row[y.name]));
  const xNames = cols.kind === 'dim' ? xTop.rows?.map((row) => String(row[cols.dim.name])) : undefined;
  const x = cols.kind === 'date' ? (bucket ? { kind: 'date' as const, date: cols.date, bucket } : null) : xNames ? { kind: 'dim' as const, dim: cols.dim, top: xNames } : null;
  const ready2 = !idle && !!x && !!yNames?.length && (x.kind === 'date' || x.top.length > 0);
  const cells = useChartQuery(martId, ready2 ? heatmapQuery(x!, y, yNames!, measure, filter) : null, version);
  const failed = [{ error, retry }, yTop, xTop, cells].find((q) => q.error);
  const empty = yTop.rows?.length === 0 || xTop.rows?.length === 0 || cells.rows?.length === 0;
  const loading = !empty && !cells.rows;
  const key = measureKey(measure);
  const xCol = cols.kind === 'date' ? cols.date.name : cols.dim.name;
  const at = new Map((cells.rows ?? []).map((row) => [`${String(row[xCol])}|${String(row[y.name])}`, row]));
  const xs = cols.kind === 'date'
    ? [...new Set((cells.rows ?? []).map((row) => String(row[xCol])))].sort().map((k) => ({ key: k, label: formatBucket(k, bucket!) ?? k }))
    : (xNames ?? []).map((k) => ({ key: k, label: k }));
  const ys = (yNames ?? []).map((k) => ({ key: k, label: k }));
  const colOptions = [...cf.dates.map((d) => ({ value: `date:${d.name}`, label: columnTitle(d) })), ...cf.dimensions.filter((d) => d !== y).map((d) => ({ value: `dim:${d.name}`, label: columnTitle(d) }))];
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Rows', value: y.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    { kind: 'radio', label: 'Columns', value: cols.kind === 'date' ? `date:${cols.date.name}` : `dim:${cols.dim.name}`, options: colOptions,
      onPick: (v) => onChange(v.startsWith('date:') ? { date: v.slice(5), dimension2: undefined } : { dimension2: v.slice(4) }) },
    ...(cols.kind === 'date' ? [{ kind: 'radio', label: 'Bucket', value: cols.bucket, options: [{ value: 'AUTO', label: 'Auto' }, ...DATE_BUCKETS.map((b) => ({ value: b, label: BUCKET_LABELS[b] }))], onPick: (v: string) => onChange({ bucket: v as DateBucket | 'AUTO' }) } as MenuItem] : []),
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, measuresOf(cf)), onPick: (v) => onChange({ measure: v }) },
    ...tail,
  ];
  const xLabel = cols.kind === 'date' ? fieldLabel(cols.date) : fieldLabel(cols.dim);
  const title = `${measureLabel(cf, measure)} by ${fieldLabel(y)} × ${xLabel}`;
  return (
    <ChartPanel title={title} name="Heatmap" items={ready ? items : null} width={seriesWidth(xs.length || null)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(y)} are not shown.`}>
      {cells.rows && <Heatmap xs={xs} ys={ys} ariaLabel={title} xTitle={cols.kind === 'date' ? columnTitle(cols.date) : columnTitle(cols.dim)} yTitle={columnTitle(y)}
        cell={(xk, yk) => { const row = at.get(`${xk}|${yk}`); return row ? { value: numberOf(row[key]), text: measureText(measure, row[key], formatOf) } : undefined; }}
        canPickX={cols.kind === 'date' ? isBucketDate : undefined}
        onPick={(xk, yk) => onFilter([dimensionFilter(y, yk), cols.kind === 'date' ? bucketFilter(cols.date, xk, bucket!, bucketZone(cols.date)) : dimensionFilter(cols.dim, xk)])} />}
    </ChartPanel>
  );
}

export const heatmap: ChartKindDef<HeatR> = {
  kind: 'heatmap',
  label: 'Heatmap',
  eligible: (cf) => cf.dimensions.length > 0 && (cf.dates.length > 0 || cf.dimensions.length > 1) && measuresOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'heatmap', ...carry(from, ['measure', 'dimension', 'dimension2', 'date', 'bucket']) }),
  resolve(spec, cf) {
    const rows = pickField(cf.dimensions, spec.dimension);
    const measure = pickMeasure(measuresOf(cf), spec.measure);
    if (!rows || !measure) return null;
    const second = cf.dimensions.find((d) => d.name === spec.dimension2 && d !== rows);
    const date = pickField(cf.dates, spec.date);
    const other = cf.dimensions.find((d) => d !== rows);
    const cols: Cols | null = second ? { kind: 'dim', dim: second } : date ? { kind: 'date', date, bucket: pickBucketChoice(spec.bucket) } : other ? { kind: 'dim', dim: other } : null;
    return cols ? { rows, cols, measure } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${fieldLabel(r.rows)} × ${fieldLabel(r.cols.kind === 'date' ? r.cols.date : r.cols.dim)}`,
  Panel: HeatmapPanel,
};
```

- [ ] **Step 5: Register and run**

Add `heatmap` to `KINDS` after `line`.
Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/charts
git commit -m "Charts: a heatmap of a measure by two dimensions or a dimension and a date

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Scatter

**Files:**
- Create: `src/charts/svg/Scatter.tsx`, `src/charts/kinds/scatter.tsx`, `src/charts/kinds/scatter.test.ts`
- Modify: `src/charts/kinds/index.ts`, `src/charts/svg/charts.test.tsx`

**Interfaces:**
- Consumes: `scatterQuery`, `SCATTER_LIMIT`, `measureKey`, `dimensionFilter`, `tickText`, `BOX_WIDTH`.
- Produces:
  - `Scatter({ points: Dot[]; ariaLabel: string; xTitle: string; yTitle: string; formatX: (n: number) => string; formatY: (n: number) => string; onPick?: (key: string) => void })` with `type Dot = { key: string; label: string; x: number; y: number; xText: string; yText: string }`
  - `scatter: ChartKindDef<ScatterR>`, `type ScatterR = { dimension: Field; x: Measure; y: Measure }`

- [ ] **Step 1: Write the failing tests**

`src/charts/kinds/scatter.test.ts`:

```ts
import type { ChartFields } from '../fields';
import { scatter } from './scatter';

const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const a = { name: 'a', category: 'number', type: 'NUMERIC' } as never;
const b = { name: 'b', category: 'number', type: 'NUMERIC' } as never;
const mk = (metrics: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: false, metrics, dates: [], dimensions: [s] }], dates: [], dimensions: [s], counter: null });

test('scatter needs two measures; Y defaults to the first measure that is not X', () => {
  expect(scatter.eligible(mk([{ field: a, fn: 'SUM' }] as never))).toBe(false);
  const cf = mk([{ field: a, fn: 'SUM' }, { field: b, fn: 'SUM' }] as never);
  const r = scatter.resolve({ id: 's', kind: 'scatter' }, cf)!;
  expect([r.x, r.y].map((m) => m.kind === 'metric' && m.metric.field.name)).toEqual(['a', 'b']);
  expect(scatter.resolve({ id: 's', kind: 'scatter', measure: 'b', measure2: 'b' }, cf)!.y).toMatchObject({ metric: { field: a } });
});
```

Append to `src/charts/svg/charts.test.tsx`:

```tsx
import { Scatter } from './Scatter';

test('Scatter draws one dot per point and picks one by keyboard', async () => {
  const onPick = vi.fn();
  render(<Scatter ariaLabel="S" xTitle="X" yTitle="Y" formatX={String} formatY={String} onPick={onPick}
    points={[{ key: 'p', label: 'P', x: 1, y: 2, xText: '1', yText: '2' }, { key: 'q', label: 'Q', x: 3, y: 1, xText: '3', yText: '1' }]} />);
  expect(document.querySelectorAll('circle[data-dot]')).toHaveLength(2);
  screen.getByRole('button', { name: 'Filter to Q' }).focus();
  await userEvent.keyboard('{Enter}');
  expect(onPick).toHaveBeenCalledWith('q');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/kinds/scatter.test.ts src/charts/svg/charts.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `Scatter`** (`src/charts/svg/Scatter.tsx`)

```tsx
import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type Dot = { key: string; label: string; x: number; y: number; xText: string; yText: string };
const PLOT_H = 220;
const TOP = 8;
const AXIS_H = 40;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** One dot per point; positions are ratios of each axis's range from zero, for drawing only. */
export function Scatter({ points, ariaLabel, xTitle, yTitle, formatX, formatY, onPick }: {
  points: Dot[]; ariaLabel: string; xTitle: string; yTitle: string; formatX: (n: number) => string; formatY: (n: number) => string; onPick?: (key: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const lo = (v: number[]) => Math.min(0, ...v);
  const hi = (v: number[]) => Math.max(0, ...v);
  const [x0, x1, y0, y1] = [lo(points.map((p) => p.x)), hi(points.map((p) => p.x)), lo(points.map((p) => p.y)), hi(points.map((p) => p.y))];
  const ticks = [0, 1, 2, 3].map((t) => t / 3);
  const left = Math.max(32, Math.max(...ticks.map((t) => formatY(y0 + t * (y1 - y0)).length)) * CHAR_W + 12);
  const plotW = Math.max(20, width - left - 12);
  const px = (x: number) => left + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * plotW;
  const py = (y: number) => TOP + PLOT_H - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * PLOT_H;
  const height = TOP + PLOT_H + AXIS_H;
  return (
    <div ref={ref} className="dm-scatter">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => {
          const yv = y0 + t * (y1 - y0); const xv = x0 + t * (x1 - x0);
          return (
            <g key={k}>
              <line className="dm-chart-grid" x1={left} x2={left + plotW} y1={py(yv)} y2={py(yv)} />
              <text className="dm-chart-text" x={left - 6} y={py(yv)} textAnchor="end" dominantBaseline="middle">{formatY(yv)}</text>
              <text className="dm-chart-text" x={px(xv)} y={TOP + PLOT_H + 14} textAnchor="middle">{formatX(xv)}</text>
            </g>
          );
        })}
        <text className="dm-chart-axis-title" x={left + plotW / 2} y={TOP + PLOT_H + 32} textAnchor="middle">{xTitle}</text>
        <text className="dm-chart-axis-title" x={10} y={TOP + PLOT_H / 2} textAnchor="middle" transform={`rotate(-90 10 ${TOP + PLOT_H / 2})`}>{yTitle}</text>
        {points.map((p) => {
          const pick = onPick ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${p.label}`, style: { cursor: 'pointer' }, onClick: () => onPick(p.key), onKeyDown: press(() => onPick(p.key)) } : {};
          return <Tooltip key={p.key} content={`${p.label}: ${xTitle} ${p.xText}, ${yTitle} ${p.yText}`}><circle data-dot={p.key} cx={px(p.x)} cy={py(p.y)} r={4} fill="var(--dm-series-1)" fillOpacity={0.75} {...pick} /></Tooltip>;
        })}
      </svg>
      <table className="sr-only">
        <thead><tr><th /><th>{xTitle}</th><th>{yTitle}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{p.xText}</td><td>{p.yText}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 4: Implement the kind** (`src/charts/kinds/scatter.tsx`)

```tsx
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { measuresOf } from '../fields';
import { measureKey, SCATTER_LIMIT, scatterQuery, type Measure } from '../queries';
import { measureFormat, measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickField, pickMeasure } from '../settings';
import { Scatter, type Dot } from '../svg/Scatter';
import { useChartQuery } from '../useChartQuery';
import { tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type ScatterR = { dimension: Field; x: Measure; y: Measure };

function ScatterPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<ScatterR>) {
  const { dimension: dim, x, y } = r;
  const read = useChartQuery(martId, idle ? null : scatterQuery(dim, x, y, filter), version);
  const [xk, yk] = [measureKey(x), measureKey(y)];
  const points: Dot[] = (read.rows ?? []).flatMap((row) => {
    const xv = numberOf(row[xk]); const yv = numberOf(row[yk]);
    if (xv === null || yv === null) return [];
    const key = String(row[dim.name]);
    return [{ key, label: key, x: xv, y: yv, xText: measureText(x, row[xk], formatOf), yText: measureText(y, row[yk], formatOf) }];
  });
  const [xt, xf] = measureFormat(x, formatOf);
  const [yt, yf] = measureFormat(y, formatOf);
  const options = measureOptions(cf, measuresOf(cf));
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (v) => onChange({ dimension: v }) },
    { kind: 'radio', label: 'X metric', value: measureId(x), options, onPick: (v) => onChange({ measure: v }) },
    { kind: 'radio', label: 'Y metric', value: measureId(y), options: options.filter((o) => o.value !== measureId(x)), onPick: (v) => onChange({ measure2: v }) },
    ...tail,
  ];
  const title = `${measureLabel(cf, y)} vs ${measureLabel(cf, x)} per ${fieldLabel(dim)}`;
  const full = read.rows?.length === SCATTER_LIMIT;
  return (
    <ChartPanel title={title} name="Scatter" items={ready ? items : null} width={BOX_WIDTH}
      loading={!read.rows && !read.error} error={read.error} onRetry={read.retry} empty={read.rows?.length === 0 ? emptyText(hasFilters) : null}
      note={`Rows with a blank ${fieldLabel(dim)} are not shown.${full ? ` Only the ${SCATTER_LIMIT} values with the largest ${measureLabel(cf, x)} are drawn.` : ''}`}>
      {read.rows && <Scatter points={points} ariaLabel={title} xTitle={measureLabel(cf, x)} yTitle={measureLabel(cf, y)}
        formatX={(n) => tickText(n, xt, xf)} formatY={(n) => tickText(n, yt, yf)} onPick={(k) => onFilter([dimensionFilter(dim, k)])} />}
    </ChartPanel>
  );
}

export const scatter: ChartKindDef<ScatterR> = {
  kind: 'scatter',
  label: 'Scatter',
  eligible: (cf) => cf.dimensions.length > 0 && measuresOf(cf).length > 1,
  create: (_cf, from) => ({ kind: 'scatter', ...carry(from, ['measure', 'measure2', 'dimension']) }),
  resolve(spec, cf) {
    const list = measuresOf(cf);
    const dimension = pickField(cf.dimensions, spec.dimension);
    const x = pickMeasure(list, spec.measure);
    if (!dimension || !x) return null;
    const y = list.find((m) => measureId(m) === spec.measure2 && measureId(m) !== measureId(x)) ?? list.find((m) => measureId(m) !== measureId(x));
    return y ? { dimension, x, y } : null;
  },
  title: (r, cf) => `${measureLabel(cf, r.y)} vs ${measureLabel(cf, r.x)} per ${fieldLabel(r.dimension)}`,
  Panel: ScatterPanel,
};
```

- [ ] **Step 5: Register and run**

Add `scatter` to `KINDS` after `heatmap`.
Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A src/charts
git commit -m "Charts: a scatter of two measures per dimension value

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Spread per group

**Files:**
- Create: `src/charts/svg/SpreadChart.tsx`, `src/charts/kinds/spread.tsx`, `src/charts/kinds/spread.test.ts`
- Modify: `src/charts/kinds/index.ts` (register last and change `KINDS` to a total `Record<ChartKind, AnyKind>`; drop the `!!k &&` guard in `eligibleKinds` and the `def &&` guards in `ChartsBody` / `listMenu` if the compiler shows them redundant), `src/charts/svg/charts.test.tsx`

**Interfaces:**
- Consumes: `spreadQuery`, `spreadFns`, `aggregatedKey`, `metricText`, `metricFormat`, `dimensionFilter`, `tickText`, `BOX_WIDTH`.
- Produces:
  - `SpreadChart({ rows: SpreadRow[]; ariaLabel: string; formatTick: (n: number) => string; onPick?: (key: string) => void })` with `type SpreadRow = { key: string; label: string; p25: number; p50: number; p75: number; min: number | null; max: number | null; text: string }`
  - `spread: ChartKindDef<SpreadR>`, `type SpreadR = { dimension: Field; field: Field }`

- [ ] **Step 1: Write the failing tests**

`src/charts/kinds/spread.test.ts`:

```ts
import type { ChartFields } from '../fields';
import { spread } from './spread';

const s = { name: 'status', category: 'string', type: 'STRING' } as never;
const plain = { name: 'amount', category: 'number', type: 'NUMERIC' } as never;
const net = { name: 'net', category: 'number', type: 'NUMERIC', allowedAggregations: ['SUM', 'P25', 'P50', 'P75'] } as never;
const mk = (metrics: never[]): ChartFields => ({ marts: [{ aliasPath: '', recordsId: 'records:M', title: '', hasPk: true, metrics, dates: [], dimensions: [s] }], dates: [], dimensions: [s], counter: null });

test('spread is offered only for metrics whose governance allows the three percentiles', () => {
  expect(spread.eligible(mk([{ field: plain, fn: 'SUM' }] as never))).toBe(false);
  const cf = mk([{ field: plain, fn: 'SUM' }, { field: net, fn: 'SUM' }] as never);
  expect(spread.eligible(cf)).toBe(true);
  expect(spread.resolve({ id: 's', kind: 'spread', measure: 'amount' }, cf)!.field).toBe(net);
});
```

Append to `src/charts/svg/charts.test.tsx`:

```tsx
import { SpreadChart } from './SpreadChart';

test('SpreadChart draws a box and a median per row, whiskers only with min and max', () => {
  render(<SpreadChart ariaLabel="Sp" formatTick={String} rows={[
    { key: 'a', label: 'A', p25: 2, p50: 3, p75: 5, min: 1, max: 9, text: 'median 3' },
    { key: 'b', label: 'B', p25: 1, p50: 2, p75: 3, min: null, max: null, text: 'median 2' },
  ]} />);
  expect(document.querySelectorAll('rect[data-box]')).toHaveLength(2);
  expect(document.querySelectorAll('line[data-median]')).toHaveLength(2);
  expect(document.querySelectorAll('line[data-whisker]')).toHaveLength(1);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/kinds/spread.test.ts src/charts/svg/charts.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Implement `SpreadChart`** (`src/charts/svg/SpreadChart.tsx`)

```tsx
import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type SpreadRow = { key: string; label: string; p25: number; p50: number; p75: number; min: number | null; max: number | null; text: string };
const ROW_H = 24;
const TOP = 8;
const AXIS_H = 24;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** One horizontal box per row: P25 to P75 with the median, and MIN to MAX whiskers when known. Positions are drawing ratios; the tooltip text is the caller's. */
export function SpreadChart({ rows, ariaLabel, formatTick, onPick }: { rows: SpreadRow[]; ariaLabel: string; formatTick: (n: number) => string; onPick?: (key: string) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const all = rows.flatMap((r) => [r.p25, r.p75, r.min ?? r.p25, r.max ?? r.p75]);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const left = Math.min(160, Math.max(...rows.map((r) => r.label.length), 0) * CHAR_W + 12);
  const plotW = Math.max(20, width - left - 12);
  const px = (v: number) => left + (hi > lo ? (v - lo) / (hi - lo) : 0) * plotW;
  const height = TOP + rows.length * ROW_H + AXIS_H;
  const ticks = [0, 1, 2, 3].map((t) => lo + (t / 3) * (hi - lo));
  return (
    <div ref={ref} className="dm-spread">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line className="dm-chart-grid" x1={px(t)} x2={px(t)} y1={TOP} y2={TOP + rows.length * ROW_H} />
            <text className="dm-chart-text" x={px(t)} y={TOP + rows.length * ROW_H + 14} textAnchor="middle">{formatTick(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const mid = TOP + i * ROW_H + ROW_H / 2;
          const pick = onPick ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${r.label}`, style: { cursor: 'pointer' }, onClick: () => onPick(r.key), onKeyDown: press(() => onPick(r.key)) } : {};
          return (
            <Tooltip key={r.key} content={`${r.label}: ${r.text}`}>
              <g {...pick}>
                <text className="dm-chart-text" x={left - 6} y={mid} textAnchor="end" dominantBaseline="middle">{r.label}</text>
                {r.min !== null && r.max !== null && <line data-whisker={r.key} x1={px(r.min)} x2={px(r.max)} y1={mid} y2={mid} stroke="var(--dm-series-1)" strokeWidth={1.5} />}
                <rect data-box={r.key} x={px(r.p25)} y={mid - 7} width={Math.max(1, px(r.p75) - px(r.p25))} height={14} fill="var(--dm-series-1)" fillOpacity={0.35} stroke="var(--dm-series-1)" />
                <line data-median={r.key} x1={px(r.p50)} x2={px(r.p50)} y1={mid - 8} y2={mid + 8} stroke="var(--foreground)" strokeWidth={2} />
              </g>
            </Tooltip>
          );
        })}
      </svg>
      <table className="sr-only"><tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.label}</th><td>{r.text}</td></tr>)}</tbody></table>
    </div>
  );
}
```

- [ ] **Step 4: Implement the kind** (`src/charts/kinds/spread.tsx`)

```tsx
import { aggregatedKey, AGG_LABELS, type AggFn } from '../../model/aggregation';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import type { ChartFields } from '../fields';
import { spreadFns, spreadQuery } from '../queries';
import { metricFormat, metricText, numberOf } from '../Scorecards';
import { pickField } from '../settings';
import { SpreadChart, type SpreadRow } from '../svg/SpreadChart';
import { useChartQuery } from '../useChartQuery';
import { tickText } from './timeSeries';
import { BOX_WIDTH, carry, type ChartKindDef, type PanelProps } from './types';

export type SpreadR = { dimension: Field; field: Field };
const fieldsOf = (cf: ChartFields): Field[] => cf.marts.flatMap((m) => m.metrics.map((x) => x.field)).filter((f) => spreadFns(f).length > 0);

function SpreadPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<SpreadR>) {
  const { dimension: dim, field } = r;
  const fns = spreadFns(field);
  const read = useChartQuery(martId, idle ? null : spreadQuery(dim, field, filter), version);
  const v = (row: Record<string, unknown>, fn: AggFn) => (fns.includes(fn) ? numberOf(row[aggregatedKey(field.name, fn)]) : null);
  const text = (row: Record<string, unknown>, fn: AggFn) => metricText(field, fn, row[aggregatedKey(field.name, fn)], formatOf);
  const rows: SpreadRow[] = (read.rows ?? []).flatMap((row) => {
    const [p25, p50, p75] = (['P25', 'P50', 'P75'] as const).map((fn) => v(row, fn));
    if (p25 === null || p50 === null || p75 === null) return [];
    const parts = (['MIN', 'P25', 'P50', 'P75', 'MAX'] as const).filter((fn) => fns.includes(fn)).map((fn) => `${AGG_LABELS[fn]} ${text(row, fn)}`);
    const key = String(row[dim.name]);
    return [{ key, label: key, p25, p50, p75, min: v(row, 'MIN'), max: v(row, 'MAX'), text: parts.join(', ') }];
  });
  const [tt, tf] = metricFormat(field, 'P50', formatOf);
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Dimension', value: dim.name, options: cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) })), onPick: (x) => onChange({ dimension: x }) },
    { kind: 'radio', label: 'Metric', value: field.name, options: fieldsOf(cf).map((f) => ({ value: f.name, label: columnTitle(f) })), onPick: (x) => onChange({ measure: x }) },
    ...tail,
  ];
  const title = `${fieldLabel(field)} spread by ${fieldLabel(dim)}`;
  return (
    <ChartPanel title={title} name="Spread" items={ready ? items : null} width={BOX_WIDTH}
      loading={!read.rows && !read.error} error={read.error} onRetry={read.retry} empty={read.rows?.length === 0 ? emptyText(hasFilters) : null}
      note={`The ${fns.length > 3 ? 'line spans the minimum to the maximum, the ' : ''}box spans the 25th to the 75th percentile, the bar is the median. The 8 values with the largest median are shown.`}>
      {read.rows && <SpreadChart rows={rows} ariaLabel={title} formatTick={(n) => tickText(n, tt, tf)} onPick={(k) => onFilter([dimensionFilter(dim, k)])} />}
    </ChartPanel>
  );
}

export const spread: ChartKindDef<SpreadR> = {
  kind: 'spread',
  label: 'Spread',
  eligible: (cf) => cf.dimensions.length > 0 && fieldsOf(cf).length > 0,
  create: (_cf, from) => ({ kind: 'spread', ...carry(from, ['measure', 'dimension']) }),
  resolve(spec, cf) {
    const dimension = pickField(cf.dimensions, spec.dimension);
    const field = pickField(fieldsOf(cf), spec.measure);
    return dimension && field ? { dimension, field } : null;
  },
  title: (r) => `${fieldLabel(r.field)} spread by ${fieldLabel(r.dimension)}`,
  Panel: SpreadPanel,
};
```

- [ ] **Step 5: Register, make `KINDS` total, run everything**

`src/charts/kinds/index.ts`:

```ts
export const KINDS: Record<ChartKind, AnyKind> = { timeSeries, pie, rankedBar, line, heatmap, scatter, spread };
export const eligibleKinds = (cf: ChartFields): AnyKind[] => Object.values(KINDS).filter((k) => k.eligible(cf));
```

Run: `npx tsc -b && npx eslint src && npx vitest run --poolOptions.threads.maxThreads=4`
Expected: no errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add -A src/charts
git commit -m "Charts: a spread chart of a metric's quartiles per dimension value

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Copy to clipboard

**Files:**
- Create: `src/charts/copyImage.ts`, `src/charts/copyImage.test.ts`
- Modify: `src/charts/ChartPanel.tsx`
- Test: `src/charts/charts-body.test.tsx`, `src/charts/ChartPanel.test.tsx` (new)

**Interfaces:**
- Consumes: `ChartPanel` (Task 2), `Toast` (`src/ui/Toast.tsx`), `MenuItem` `action`.
- Produces:
  - `chartPng(section: HTMLElement, title: string): Promise<Blob | null>` (null when the section has no chart SVG)
  - `copyChart(section: HTMLElement, title: string): Promise<'copied' | 'downloaded' | 'empty'>`
  - `copyHtml(html: string, text: string): boolean`
  - `inlineStyles(source: SVGElement, clone: SVGElement): void`
  - `ChartPanel` appends a `Copy to clipboard` action before the `Remove` row (it inserts it before the last `tail` item whose label is `Remove`, else at the end) and shows the result in a `Toast`.

- [ ] **Step 1: Write the failing tests** (`src/charts/copyImage.test.ts`)

```ts
import { vi } from 'vitest';
import { copyChart, copyHtml, inlineStyles } from './copyImage';

function section(withSvg = true) {
  const el = document.createElement('section');
  el.innerHTML = withSvg ? '<svg role="img" width="100" height="50" viewBox="0 0 100 50"><rect class="x" width="10" height="10" style="fill: var(--dm-series-1)"></rect></svg><ul class="dm-chart-legend"><li><span class="dm-chart-swatch" style="background: red"></span>A</li></ul>' : '<div>loading</div>';
  document.body.appendChild(el);
  return el;
}
const png = new Blob(['x'], { type: 'image/png' });

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

test('inlineStyles writes computed fill and stroke onto the clone', () => {
  const s = section();
  const svg = s.querySelector('svg')!;
  vi.spyOn(window, 'getComputedStyle').mockImplementation(() => ({ getPropertyValue: (p: string) => (p === 'fill' ? 'rgb(66, 134, 222)' : '') }) as never);
  const clone = svg.cloneNode(true) as SVGElement;
  inlineStyles(svg, clone);
  expect(clone.querySelector('rect')!.getAttribute('fill')).toBe('rgb(66, 134, 222)');
});

test('copyChart: nothing to copy without a chart SVG', async () => {
  expect(await copyChart(section(false), 'T')).toBe('empty');
});

test('copyChart: the PNG goes through the clipboard API when it is allowed', async () => {
  const write = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('ClipboardItem', class { constructor(public items: object) {} });
  Object.defineProperty(navigator, 'clipboard', { value: { write }, configurable: true });
  const mod = await import('./copyImage');
  vi.spyOn(mod.internals, 'render').mockResolvedValue(png);
  expect(await mod.copyChart(section(), 'T')).toBe('copied');
  expect(write).toHaveBeenCalledOnce();
});

test('copyChart: a blocked clipboard falls back to an HTML image, then to a download', async () => {
  Object.defineProperty(navigator, 'clipboard', { value: { write: vi.fn().mockRejectedValue(new DOMException('blocked', 'NotAllowedError')) }, configurable: true });
  const mod = await import('./copyImage');
  vi.spyOn(mod.internals, 'render').mockResolvedValue(png);
  vi.spyOn(mod.internals, 'dataUrl').mockResolvedValue('data:image/png;base64,eA==');
  const html = vi.spyOn(mod.internals, 'copyHtml').mockReturnValueOnce(true).mockReturnValueOnce(false);
  const download = vi.spyOn(mod.internals, 'download').mockImplementation(() => {});
  expect(await mod.copyChart(section(), 'T')).toBe('copied');
  expect(html.mock.calls[0]![0]).toContain('<img src="data:image/png;base64,eA=="');
  expect(await mod.copyChart(section(), 'Sales / day')).toBe('downloaded');
  expect(download).toHaveBeenCalledWith(png, 'Sales - day.png');
});

test('copyHtml puts text/html and text/plain on the copy event', () => {
  const set = vi.fn();
  document.execCommand = vi.fn(() => { document.dispatchEvent(Object.assign(new Event('copy'), { clipboardData: { setData: set } })); return true; }) as never;
  expect(copyHtml('<img>', 'T')).toBe(true);
  expect(set).toHaveBeenCalledWith('text/html', '<img>');
  expect(set).toHaveBeenCalledWith('text/plain', 'T');
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts/copyImage.test.ts`
Expected: FAIL, module missing.

- [ ] **Step 3: Implement** (`src/charts/copyImage.ts`)

```ts
// A chart as a PNG on the clipboard. The OWOX host grants clipboard-write only to privileged plugins (OWOX/owox-data-marts#1922),
// so a copy event with an HTML image follows, and a download when that fails too. Each route was checked against the host's frame.

const SCALE = 2;
const PAD = 16;
const STYLE_PROPS = ['fill', 'fill-opacity', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'font-size', 'font-family', 'font-weight'] as const;

/** Writes each element's computed paint and font onto the clone, so the image needs no stylesheet or CSS variable. */
export function inlineStyles(source: SVGElement, clone: SVGElement): void {
  const from = [source, ...source.querySelectorAll('*')];
  const to = [clone, ...clone.querySelectorAll('*')];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    for (const p of STYLE_PROPS) {
      const v = cs.getPropertyValue(p);
      if (v) to[i]!.setAttribute(p, v);
    }
    to[i]!.removeAttribute('class');
  });
}

const loadImage = (url: string) => new Promise<HTMLImageElement>((ok, fail) => { const img = new Image(); img.onload = () => ok(img); img.onerror = fail; img.src = url; });
const background = (el: HTMLElement): string => {
  for (let e: HTMLElement | null = el; e; e = e.parentElement) {
    const c = getComputedStyle(e).backgroundColor;
    if (c && c !== 'transparent' && c !== 'rgba(0, 0, 0, 0)') return c;
  }
  return '#ffffff';
};

async function render(section: HTMLElement, title: string): Promise<Blob | null> {
  const svg = section.querySelector<SVGSVGElement>('svg[role]');
  if (!svg) return null;
  const box = svg.getBoundingClientRect();
  const w = Math.max(1, Math.round(box.width || Number(svg.getAttribute('width')) || 600));
  const h = Math.max(1, Math.round(box.height || Number(svg.getAttribute('height')) || 300));
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('width', String(w));
  clone.setAttribute('height', String(h));
  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }));
  try {
    const img = await loadImage(url);
    const legend = [...section.querySelectorAll('.dm-chart-legend li')].map((li) => ({ color: getComputedStyle(li.querySelector('.dm-chart-swatch')!).backgroundColor, text: li.textContent ?? '' }));
    const font = getComputedStyle(section).fontFamily || 'sans-serif';
    const fg = getComputedStyle(section).color || '#000';
    const titleH = 24;
    const legendH = legend.length ? Math.ceil(legend.length / 4) * 18 + 8 : 0;
    const canvas = document.createElement('canvas');
    canvas.width = (w + PAD * 2) * SCALE;
    canvas.height = (titleH + h + legendH + PAD * 2) * SCALE;
    const g = canvas.getContext('2d')!;
    g.scale(SCALE, SCALE);
    g.fillStyle = background(section);
    g.fillRect(0, 0, w + PAD * 2, titleH + h + legendH + PAD * 2);
    g.fillStyle = fg;
    g.font = `600 14px ${font}`;
    g.textBaseline = 'top';
    g.fillText(title, PAD, PAD);
    g.drawImage(img, PAD, PAD + titleH, w, h);
    g.font = `12px ${font}`;
    legend.forEach((l, i) => {
      const x = PAD + (i % 4) * (w / 4);
      const y = PAD + titleH + h + 8 + Math.floor(i / 4) * 18;
      g.fillStyle = l.color;
      g.fillRect(x, y + 1, 10, 10);
      g.fillStyle = fg;
      g.fillText(l.text, x + 16, y);
    });
    return await new Promise<Blob | null>((ok) => canvas.toBlob(ok, 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}

const dataUrl = (blob: Blob) => new Promise<string>((ok, fail) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = fail; r.readAsDataURL(blob); });

/** The copy event route: needs no clipboard permission, carries text formats only. */
export function copyHtml(html: string, text: string): boolean {
  const on = (e: ClipboardEvent) => { e.preventDefault(); e.clipboardData?.setData('text/html', html); e.clipboardData?.setData('text/plain', text); };
  document.addEventListener('copy', on as EventListener, { once: true });
  try {
    return typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    return false;
  } finally {
    document.removeEventListener('copy', on as EventListener);
  }
}

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const escapeAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const fileName = (title: string) => `${title.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s*-\s*/g, ' - ').replace(/\s+/g, ' ').trim() || 'chart'}.png`;

/** Seams for tests: the canvas and file APIs jsdom lacks. */
export const internals = { render, dataUrl, copyHtml, download };

export async function copyChart(section: HTMLElement, title: string): Promise<'copied' | 'downloaded' | 'empty'> {
  const blob = await internals.render(section, title);
  if (!blob) return 'empty';
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return 'copied';
  } catch { /* blocked by the host's permissions policy: next route */ }
  if (internals.copyHtml(`<img src="${await internals.dataUrl(blob)}" alt="${escapeAttr(title)}">`, title)) return 'copied';
  internals.download(blob, fileName(title));
  return 'downloaded';
}
```

(The test expects `fileName('Sales / day')` to be `Sales - day.png`; keep the replace chain that gives exactly that.)

- [ ] **Step 4: Wire it into `ChartPanel`**

```tsx
import { useRef, useState, type ReactNode } from 'react';
import { Toast } from '../ui/Toast';
import { copyChart } from './copyImage';
// …
const ref = useRef<HTMLElement>(null);
const [note, setNote] = useState<{ text: string; tone: 'success' | 'info' | 'error'; at: number } | null>(null);
const copy: MenuItem = { kind: 'action', label: 'Copy to clipboard', onPick: () => {
  const el = ref.current;
  if (!el || loading || error || empty) { setNote({ text: 'Nothing to copy yet', tone: 'info', at: Date.now() }); return; }
  copyChart(el, title).then(
    (how) => setNote(how === 'copied' ? { text: 'Chart copied', tone: 'success', at: Date.now() }
      : how === 'downloaded' ? { text: 'Clipboard is blocked here, the chart was downloaded as PNG', tone: 'info', at: Date.now() }
      : { text: 'Nothing to copy yet', tone: 'info', at: Date.now() }),
    () => setNote({ text: "The chart couldn't be copied", tone: 'error', at: Date.now() }),
  );
} };
const at = items ? items.findIndex((i) => i.kind === 'action' && i.label === 'Remove') : -1;
const withCopy = items ? (at >= 0 ? [...items.slice(0, at), copy, ...items.slice(at)] : [...items, copy]) : null;
// <section ref={ref} …> and <ChartMenu name={name} items={withCopy} />, and after the section's content:
{note && <Toast tone={note.tone} stamp={note.at} onDismiss={() => setNote(null)}>{note.text}</Toast>}
```

- [ ] **Step 5: Body test (Review Focus 4)**

Append to `src/charts/charts-body.test.tsx`:

```tsx
test('a chart menu ends with Chart type, Copy to clipboard and Remove', async () => {
  await charts();
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  const rows = within(screen.getByRole('menu')).getAllByRole('menuitem').map((r) => r.textContent);
  expect(rows.slice(-3)).toEqual(['Chart type', 'Copy to clipboard', 'Remove']);
});
```

Then the loading half as a unit test of `ChartPanel` (spy on `internals.render`: `copyChart` calls it through the `internals` object, so the spy sees every render, which an ES-module export spy would not):

```tsx
// src/charts/ChartPanel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { internals } from './copyImage';
import { ChartPanel } from './ChartPanel';

test('Copy to clipboard on a loading chart says there is nothing to copy and renders no image', async () => {
  const spy = vi.spyOn(internals, 'render');
  render(<ChartPanel title="T" name="Pie" items={[{ kind: 'action', label: 'Remove', onPick: () => {} }]} width="26rem" loading error={null} onRetry={() => {}}>x</ChartPanel>);
  await userEvent.click(screen.getByRole('button', { name: 'Pie options' }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Copy to clipboard' }));
  expect(await screen.findByText('Nothing to copy yet')).toBeTruthy();
  expect(spy).not.toHaveBeenCalled();
});
```

- [ ] **Step 6: Run**

Run: `npx vitest run --poolOptions.threads.maxThreads=4 src/charts`
Expected: PASS.
Run: `npx tsc -b && npx eslint src`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add -A src/charts
git commit -m "Charts: Copy to clipboard puts a chart image on the clipboard, or downloads it where the clipboard is blocked

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: End-to-end specs

**Files:**
- Modify: `e2e/charts.spec.ts`
- Create: `e2e/chart-list.spec.ts`

**Interfaces:**
- Consumes: the mock (`/?mock`), the header `Charts options` menu, the panel menus, `net_revenue` in the Orders fixture (its governance allows P25, P50, P75, so `Spread` is offered once it is shown).

- [ ] **Step 1: Adapt `e2e/charts.spec.ts`**

1. Keep the first two tests; `Time series options` and `Horizontal bars` keep their names.
2. In `the time series and the pie sit side by side…`, keep the side-by-side checks, then replace the 900px stacking step with 640px (narrow panels still fit side by side at 900px):

```ts
await page.setViewportSize({ width: 640, height: 900 });
await expect.poll(async () => { const [c, d] = [(await panels.nth(0).boundingBox())!, (await panels.nth(1).boundingBox())!]; return d.y >= c.y + c.height - 1; }).toBe(true);
```

3. Add a width check after the side-by-side assertions (spec section 6):

```ts
// The pie takes only the width it needs: at most 26rem (416px).
expect(b.width).toBeLessThanOrEqual(417);
```

- [ ] **Step 2: Write `e2e/chart-list.spec.ts`**

```ts
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });
const data = (page: Page) => page.locator('#band-data');

async function openCharts(page: Page, columns: (string | RegExp)[]) {
  await expect(data(page).getByRole('row')).toHaveCount(202);
  for (const name of columns) {
    await data(page).getByRole('button', { name: 'Fields of Orders' }).click();
    await page.getByLabel(name).click();
    await page.keyboard.press('Escape');
  }
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(2);
}

test('add, switch, configure, hide and remove charts from the header menu', async ({ page }) => {
  await openCharts(page, [/created_at/i, /Net Revenue/i]);
  const listButton = data(page).locator('[data-chart-list-slot]').getByRole('button', { name: 'Charts options' });

  // Add every new type; Spread is offered because Net Revenue allows percentiles.
  for (const type of ['Ranked bar', 'Line', 'Heatmap', 'Scatter', 'Spread']) {
    await listButton.click();
    await page.getByRole('menuitem', { name: 'Add chart' }).click();
    await page.getByRole('menuitemradio', { name: type }).click();
  }
  await expect(data(page).locator('section.dm-chart')).toHaveCount(7);
  for (const kind of ['Ranked bar', 'Line', 'Heatmap', 'Scatter', 'Spread']) {
    await expect(data(page).locator(`section[data-chart-kind="${kind}"] svg[role]`)).toBeVisible();
  }
  await page.screenshot({ path: 'tmp/chart-list-all.png', fullPage: true });

  // Line: a second measure draws a right axis.
  await data(page).getByRole('button', { name: 'Line options' }).click();
  await page.getByRole('menuitem', { name: 'Second measure' }).click();
  await page.getByRole('menuitemradio', { name: /Net Revenue/ }).click();
  await expect(data(page).locator('section[data-chart-kind="Line"] [data-axis="right"]').first()).toBeVisible();

  // Switch the ranked bar to a pie.
  await data(page).getByRole('button', { name: 'Ranked bar options' }).click();
  await page.getByRole('menuitem', { name: 'Chart type' }).click();
  await page.getByRole('menuitemradio', { name: 'Pie' }).click();
  await expect(data(page).locator('section[data-chart-kind="Pie"]')).toHaveCount(2);

  // Hide the scatter from the header list, then remove the heatmap.
  await listButton.click();
  await page.getByRole('menuitemcheckbox', { name: /vs .* per / }).click();
  await page.keyboard.press('Escape');
  await expect(data(page).locator('section[data-chart-kind="Scatter"]')).toHaveCount(0);
  await data(page).getByRole('button', { name: 'Heatmap options' }).click();
  await page.getByRole('menuitem', { name: 'Remove' }).click();
  await expect(data(page).locator('section[data-chart-kind="Heatmap"]')).toHaveCount(0);

  // The list survives a reload.
  await page.reload();
  await data(page).getByRole('radio', { name: 'Charts' }).click();
  await expect(data(page).locator('section.dm-chart')).toHaveCount(5);
});

test('Copy to clipboard copies a PNG when the clipboard is allowed', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openCharts(page, [/created_at/i]);
  await data(page).getByRole('button', { name: 'Pie options' }).click();
  await page.getByRole('menuitem', { name: 'Copy to clipboard' }).click();
  await expect(page.getByText('Chart copied')).toBeVisible();
  const types = await page.evaluate(async () => (await navigator.clipboard.read()).flatMap((i) => i.types));
  expect(types).toContain('image/png');
});
```

If the mock's Orders field picker labels Net Revenue differently, use the label shown in the picker (`page.getByLabel(…)` must match the checkbox's accessible name).

- [ ] **Step 3: Run the e2e specs**

Run: `npx playwright test --workers=1 --trace off e2e/charts.spec.ts e2e/chart-list.spec.ts`
Expected: PASS. Read `tmp/chart-list-all.png` and check: each panel is only as wide as its content, the line has its right axis, nothing overlaps.

- [ ] **Step 4: Run the full suites**

Run: `npx tsc -b && npx eslint . && npx vitest run --poolOptions.threads.maxThreads=4 && npx playwright test --workers=1 --trace off`
Expected: all pass. Fix any other e2e spec that opened the old `Scorecards options` menu by switching it to the header `Charts options` button.

- [ ] **Step 5: Commit**

```bash
git add e2e
git commit -m "Tests: e2e for the chart list, new chart types and copying a chart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
