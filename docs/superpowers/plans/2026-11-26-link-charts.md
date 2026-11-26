# Share links carry the charts: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A view link carries the sharer's chart settings for the main data mart; a reader sees them for the session, and editing works as usual.

**Architecture:** The link codec gains an optional top-level `ch` key holding a cleaned `ChartSettings`. Opening a link puts it in `state.charts[martId]` and marks the mart in `state.linkCharts`; the Charts body and the grid's prune path use the store copy for a marked mart instead of loading the saved doc. Copy reads the settings from the store or the saved doc and drops them when the link would be too long.

**Tech Stack:** React 18, TypeScript, Vitest (jsdom), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-26-link-charts-design.md`

## Global Constraints

1. Payload stays `v: 1`; `ch` is optional and top level. A link without `ch` behaves exactly as today.
2. `MAX_ROUTE_LENGTH` is 2048 and includes `/v?s=`.
3. Fixed default chart ids `time-series` and `pie` are kept in the link; every other chart id is left out and regenerated with `newChartId()` on decode.
4. Opening a link writes nothing to the reader's saved charts and adds no Undo step.
5. Notice text when charts are dropped for length: `The link was copied without the charts: they make it too long.`
6. Tests: Vitest with `--poolOptions.threads.maxThreads=4`; Playwright with `--workers=1 --trace off`.
7. Comments and copy follow the repo's existing plain style (full sentences, no marketing words).

## Review Focus

1. A link opened for a mart the reader cannot access: no charts are applied and no mart is marked (Task 2 test).
2. A reader hides a column while Charts is closed on a link mart: the link's charts are pruned, not replaced by the saved ones (Task 2 test).
3. A link from an older build (no `ch`): Charts loads the saved doc as before (Task 2 test).
4. The sharer never opened Charts this session: copy still carries their saved charts (Task 3 test).
5. `ch` with `__proto__` or other junk keys in scorecard picks: cleaned, never reaches a prototype (Task 1 test).

---

### Task 1: Codec

**Files:**
- Modify: `src/api/chart-settings.ts` (export `clean` as `cleanChartSettings`)
- Modify: `src/state/view-link.ts`
- Test: `src/state/view-link.test.ts`

**Interfaces:**
- Produces: `export function cleanChartSettings(doc: unknown): ChartSettings` in `src/api/chart-settings.ts`.
- Produces: `DecodedView.charts?: ChartSettings`. `encodeViewLink` writes `ch` when `view.charts` is set; `decodeViewLink` returns `charts` only when the payload has a usable `ch`.

- [ ] **Step 1: Write the failing tests** (append to `describe('view link codec', …)` in `src/state/view-link.test.ts`)

```ts
  it('round trips the chart settings: generated ids are left out and come back new, the default ids stay', async () => {
    const charts = {
      scorecards: { hidden: ['records'], sparklines: false, metrics: { total: 'orders__total' } },
      charts: [
        { id: 'time-series', kind: 'timeSeries' as const },
        { id: 'c-lx1-0', kind: 'sankey' as const, dimensions: ['status', 'orders__customers__name'], measure: 'records', size: { w: 20, h: 12 } },
      ],
    };
    const link = await encodeViewLink({ ...base, charts });
    const json = new TextDecoder().decode(await raw(Uint8Array.from(atob(link.slice(5).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)), 'd'));
    expect(json).not.toContain('c-lx1-0');
    const out = await decodeViewLink(link);
    if (typeof out === 'string') throw new Error(out);
    expect(out.charts!.scorecards).toEqual(charts.scorecards);
    expect(out.charts!.charts![0]).toEqual({ id: 'time-series', kind: 'timeSeries' });
    const { id, ...rest } = out.charts!.charts![1]!;
    expect(id).toMatch(/^c-/);
    expect(rest).toEqual({ kind: 'sankey', dimensions: ['status', 'orders__customers__name'], measure: 'records', size: { w: 20, h: 12 } });
  });

  it('a link without charts decodes with none', async () => {
    const out = await decodeViewLink(await encodeViewLink(base));
    expect(out).not.toHaveProperty('charts');
  });

  it('a malformed ch is dropped and counted; a bad chart entry is dropped and counted', async () => {
    const bad = await decodeViewLink(await route(valid({ ch: 'nope' })));
    expect(bad).toMatchObject({ dropped: 1 });
    expect(bad).not.toHaveProperty('charts');
    const one = await decodeViewLink(await route(valid({ ch: { charts: [{ kind: 'pie' }, { kind: 'nope' }, 5] } })));
    if (typeof one === 'string') throw new Error(one);
    expect(one.charts!.charts!.map((c) => c.kind)).toEqual(['pie']);
    expect(one.dropped).toBe(2);
  });

  it('junk keys in scorecard picks never reach a prototype', async () => {
    const out = await decodeViewLink(await route(valid({ ch: JSON.parse('{"scorecards":{"metrics":{"__proto__":"x","a":"b"}}}') })));
    if (typeof out === 'string') throw new Error(out);
    expect(Object.getPrototypeOf(out.charts!.scorecards!.metrics)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).x).toBeUndefined();
    expect(out.charts!.scorecards!.metrics!.a).toBe('b');
  });
```

The `size` shape above must match `cleanSize` in `src/charts/resize.ts`; read it and adjust the literal if its fields differ.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/state/view-link.test.ts --poolOptions.threads.maxThreads=4`
Expected: the four new tests FAIL (`charts` missing).

- [ ] **Step 3: Implement**

In `src/api/chart-settings.ts`, rename `function clean(` to `export function cleanChartSettings(` and update its one caller in `load`. Make the picks filter drop unsafe keys:

```ts
      if (picks) out.scorecards[k] = Object.fromEntries(Object.entries(picks).filter((e): e is [string, string] => typeof e[1] === 'string' && !(e[0] in Object.prototype)));
```

In `src/state/view-link.ts`:

```ts
import { cleanChartSettings } from '../api/chart-settings';
import { newChartId, type ChartSettings } from '../charts/settings';

/** Chart ids that edits target by name; every other id is random and left out of a link. */
const FIXED_CHART_IDS = new Set(['time-series', 'pie']);
```

Add `charts?: ChartSettings;` to `DecodedView` with the comment `/** The main mart's chart settings the sharer had; absent for a link made without them. */`, and `ch?: unknown;` to `ViewLinkV1`.

In `encodeViewLink`, after `g: …`:

```ts
    ...(view.charts ? { ch: { ...view.charts, ...(view.charts.charts ? { charts: view.charts.charts.map(({ id, ...rest }) => (FIXED_CHART_IDS.has(id) ? { id, ...rest } : rest)) } : {}) } } : {}),
```

In `shape`, destructure `ch` with the others, and before the `return`:

```ts
  // Chart settings: cleaned as a saved doc is. A chart without an id (the link leaves random ids out) gets a new one first; entries cleaning drops are counted.
  let charts: ChartSettings | undefined;
  if (ch !== undefined) {
    if (!isPlain(ch)) dropped++;
    else {
      const list = Array.isArray(ch.charts) ? ch.charts.map((c) => (isPlain(c) && c.id === undefined ? { ...c, id: newChartId() } : c)) : ch.charts;
      charts = cleanChartSettings({ ...ch, charts: list });
      if (Array.isArray(list)) dropped += list.length - (charts.charts?.length ?? 0);
    }
  }
```

and add `...(charts ? { charts } : {}),` to the returned object.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/state/view-link.test.ts src/api --poolOptions.threads.maxThreads=4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/api/chart-settings.ts src/state/view-link.ts src/state/view-link.test.ts
git commit -m "View links carry the chart settings under ch"
```

---

### Task 2: Opening a link shows its charts

**Files:**
- Modify: `src/state/view-link-resolve.ts` (`AppliedView`, `resolveView`)
- Modify: `src/state/store.tsx` (`State.linkCharts`, `initialState`, `applyView`)
- Modify: `src/ui/useViewLink.ts` (pass `charts` in the `applyView` dispatch)
- Modify: `src/charts/ChartsBody.tsx` (mount effect)
- Modify: `src/ui/explorer/MartGrid.tsx` (prune path, around line 472)
- Test: `src/state/view-link-resolve.test.ts`, `src/state/store.test.ts`, `src/charts/charts-body.test.tsx`, and the MartGrid prune test that already covers `pruneChain` (find it with `git grep -n "dropPicksOf\|prune" src/ui/explorer/*.test.tsx`)

**Interfaces:**
- Consumes: `DecodedView.charts?: ChartSettings` (Task 1).
- Produces: `AppliedView.charts?: ChartSettings`; action `{ type: 'applyView'; …; charts?: ChartSettings }`; `State.linkCharts: Record<string, true>`.

- [ ] **Step 1: Write the failing tests**

`src/state/view-link-resolve.test.ts`: resolving a view with `charts` for an accessible mart returns `apply.charts` equal to them; for a mart the member cannot access (or no `martId`) `apply.charts` is undefined. Follow the existing tests' model and `readGrid` fixtures in that file.

`src/state/store.test.ts`, next to `'applyView sets everything at once, with no history entry'`:

```ts
test('applyView with charts puts them in the store and marks the mart, with no history entry', () => {
  const settings = { charts: [{ id: 'pie', kind: 'pie' as const }] };
  const next = reducer(initialState, { type: 'applyView', selection: sel({ martId: 'b' }), grid: null, search: '', contextIds: [], storageIds: null, charts: settings });
  expect(next.charts.b).toBe(settings);
  expect(next.linkCharts).toEqual({ b: true });
  expect(next.history).toEqual([]);
});

test('applyView without charts leaves the store charts and marks alone', () => {
  const start = { ...initialState, charts: { b: { charts: [] } }, linkCharts: {} };
  const next = reducer(start, { type: 'applyView', selection: sel({ martId: 'b' }), grid: null, search: '', contextIds: [], storageIds: null });
  expect(next.charts).toBe(start.charts);
  expect(next.linkCharts).toEqual({});
});
```

`src/charts/charts-body.test.tsx`: with a store whose `charts[martId]` holds a Sankey and `linkCharts[martId]` is true, mounting the body shows the Sankey panel and `chartSettings.load` is never called; a chart edit then calls `chartSettings.save` with settings that contain the Sankey. Then a mart not in `linkCharts` still calls `load` (as today). Use the file's existing render helper and fake `chartSettings` service.

MartGrid prune test: with Charts closed, a link-marked mart whose store charts pick column `X`, hiding `X` saves settings derived from the store copy (the link's), and `chartSettings.load` is not called.

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/state src/charts/charts-body.test.tsx src/ui/explorer --poolOptions.threads.maxThreads=4`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement**

`view-link-resolve.ts`: add `charts?: ChartSettings` to `AppliedView`; in the final return add `...(selection.martId && selection.martId === view.martId && view.charts ? { charts: view.charts } : {})`.

`store.tsx`:
1. `State` gains `/** Marts whose chart settings came from a link this session: the Charts body shows the store copy instead of loading the saved doc. */ linkCharts: Record<string, true>;` and `initialState` gets `linkCharts: {}`.
2. The `applyView` action type gains `charts?: ChartSettings`.
3. In the `applyView` case:

```ts
      ...(a.charts && a.selection.martId ? { charts: { ...state.charts, [a.selection.martId]: a.charts }, linkCharts: { ...state.linkCharts, [a.selection.martId]: true as const } } : {}),
```

`useViewLink.ts`: add `charts: apply.charts` to the `applyView` dispatch.

`ChartsBody.tsx`, in the mount effect, before `chartSettings.load`:

```ts
    // A link's charts are shown as they came: the saved doc is not read until the member's first edit saves them as theirs.
    const fromLink = linkMarked ? heldOnMount : undefined;
    if (fromLink) { latest.current = fromLink; setSettings(fromLink); return; }
```

where `const linkMarked = !!store.linkCharts[martId];` and `const heldOnMount = store.charts[martId];` are read in the render body, and the effect's dependency list gains `linkMarked` only (not `heldOnMount`: Undo updates flow through the existing `held` effect).

`MartGrid.tsx`: read `const [{ modelVersion, linkCharts, charts: storeCharts }, dispatch] = useStore();` and in the prune branch:

```ts
        const fromLink = linkCharts[martId] ? storeCharts[martId] : undefined;
        const read = () => (fromLink ? Promise.resolve(fromLink) : chartSettings.load(martId));
        pruneChain.current = pruneChain.current.then(read).then((cur) => { … unchanged … }).catch(() => {});
```

- [ ] **Step 4: Run to see them pass, then the full unit suite**

Run: `npx vitest run --poolOptions.threads.maxThreads=4`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/state src/ui/useViewLink.ts src/charts/ChartsBody.tsx src/ui/explorer/MartGrid.tsx src/charts/charts-body.test.tsx src/ui/explorer
git commit -m "Opening a view link shows its charts until the first edit saves them"
```

---

### Task 3: Copy link carries the charts

**Files:**
- Modify: `src/ui/useViewLink.ts` (`copy`)
- Test: `src/ui/view-link.page.test.tsx`

**Interfaces:**
- Consumes: `encodeViewLink` with `charts` (Task 1); `useServices().chartSettings.load(martId): Promise<ChartSettings>`.

- [ ] **Step 1: Write the failing tests** (in `view-link.page.test.tsx`, using its `setup` and `copyLink` spy)

1. Copy with a main mart whose saved charts doc holds a Sankey (put it in the mock ctx's `charts` collection before render) and Charts never opened: the copied path decodes (`decodeViewLink`) with `charts.charts` containing a `sankey`.
2. Copy where the store already holds edited charts for the mart: the link carries the store copy, not the saved doc.
3. Copy where charts push the link past `MAX_ROUTE_LENGTH` (save 40 charts each with long dimension names) but the link without them fits: the copied path decodes with no `charts`, and the notice reads `The link was copied without the charts: they make it too long.`

- [ ] **Step 2: Run to see them fail**

Run: `npx vitest run src/ui/view-link.page.test.tsx --poolOptions.threads.maxThreads=4`

- [ ] **Step 3: Implement** (`useViewLink.ts`)

```ts
const NO_CHARTS = 'The link was copied without the charts: they make it too long.';
```

`copy` becomes:

```ts
  const copy = async () => {
    const { selection, grids } = state;
    try {
      const martId = selection.martId;
      const charts = martId ? state.charts[martId] ?? await chartSettings.load(martId) : undefined;
      const view = { …the current fields unchanged… };
      let path = await encodeViewLink({ ...view, ...(charts && (charts.charts || charts.scorecards) ? { charts } : {}) });
      let note: string | null = null;
      if (path.length > MAX_ROUTE_LENGTH && charts) { path = await encodeViewLink(view); note = NO_CHARTS; }
      if (path.length > MAX_ROUTE_LENGTH) { setNotice(TOO_LARGE); return; }
      await ctx.ui.copyLink(path);
      setNotice(note);
    } catch {
      setNotice(COPY_FAILED);
    }
  };
```

with `chartSettings` taken from `useServices()`.

- [ ] **Step 4: Run to see them pass**

Run: `npx vitest run src/ui --poolOptions.threads.maxThreads=4`

- [ ] **Step 5: Commit**

```bash
git add src/ui/useViewLink.ts src/ui/view-link.page.test.tsx
git commit -m "Copy link puts the main mart's charts in the link, and leaves them out when too long"
```

---

### Task 4: End to end and README

**Files:**
- Test: `e2e/sankey.spec.ts` (or `e2e/charts.spec.ts`; follow how either opens Charts and adds a Sankey)
- Modify: `README.md` (Charts paragraph, line 35)

- [ ] **Step 1: Write the e2e test**

In the mock (`/?mock`): open Charts, add a Sankey, copy the link (capture it the way existing e2e tests capture `copyLink`; find with `git grep -n copyLink e2e src/sdk/mock`). Clear the saved `charts` doc for the mart in the mock, then open the copied route. Expect a Sankey panel. Reload `/?mock` without the route: expect the default charts (time series and pie), no Sankey.

If the mock gives no way to capture the copied link or clear a saved doc from e2e, cover the same flow in `view-link.page.test.tsx` instead and say so in the commit message.

- [ ] **Step 2: Run it**

Run: `npx playwright test e2e/sankey.spec.ts --workers=1 --trace off`
Expected: PASS.

- [ ] **Step 3: README**

After the sentence "The charts, their settings and their sizes are saved per member and per main data mart, as the grid's columns, filters, slices, sorts and aggregations are." add: "A view link carries the sharer's charts and scorecard choices for the main data mart: whoever opens it sees them until they reload, and their first chart edit saves them as their own. When the charts would make the link too long, it is copied without them and a notice says so."

- [ ] **Step 4: Commit**

```bash
git add e2e README.md
git commit -m "View link charts: e2e and README"
```
