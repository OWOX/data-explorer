# Main mart slot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The main data mart stays first and only changes on purpose (drag onto it, or deselect it); the band lists what can join it; hover shows hidden neighbours; a mart joins by the path closest to the main one; the Export menu copies the SQL the grid ran.

**Architecture:** `computeVisible` (pure) learns the main mart's joinable set and puts the main mart first under every rule. `join-plan.ts` (pure) gets a path rule (`sourceOfMart` with paths in use), a no-op for unjoinable clicks, and `planMakeMain`. `useCardClick` gains a `makeMain` mode that the new drag hook and a card button call. Copy SQL keeps the grid query's run id (`x-owox-run-id`, already read by the SDK) and reads `additionalParams.httpData.executionSqlQuery` from `GET /api/data-marts/:id/runs/:runId`.

**Tech Stack:** React 19, TypeScript, Vitest + Testing Library (jsdom), Playwright, `@owox/plugin-sdk` 0.43.

**Spec:** `docs/superpowers/specs/2026-11-17-main-mart-slot-design.md`

## Global Constraints

1. No new dependency. Drag uses pointer events.
2. Vitest: run with the repo config, which caps `maxWorkers: 4`. Run a single file as `npx vitest run <path>`. Never pass a higher worker count.
3. Playwright: `npm run e2e -- <spec>` (already `--workers=1 --trace off`).
4. Copy SQL runs no query, bills nothing and writes nothing.
5. Unjoinable hint text, exact: `Can't join <Main>. Drag it onto <Main> to make it the main data mart.`
6. The make-main button's accessible name, exact: `Make main data mart`.
7. Copy SQL menu label, exact: `Copy SQL`. Enabled hint: `The SQL the grid ran, with its page LIMIT`. Copied note: `SQL copied. It is the query the grid ran, with its page LIMIT.`
8. Copy SQL disabled reasons, exact: `The grid has not run a query yet`, `The grid's query is still running`, `The grid's query failed`, `OWOX did not report a run for this query`, `Reading the SQL from OWOX…`, `OWOX did not record the SQL of this query`, `The SQL could not be read from OWOX`.
9. Code comments and commit messages follow the repo's style: plain sentences, no em dashes in new text. Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
10. Run `npm run lint` and `npx tsc -b` before each commit; both must pass.

## Review Focus

1. A drag that ends off the main card, or with Escape, changes nothing, and the click that ends any drag does not also toggle the card it started on.
2. The main mart's storage is unticked: no rule puts a missing main mart first, and the joinable band does not crash.
3. Hover moves from a card across the gap to a ghost card: the ghosts stay long enough to be clicked (400 ms grace).
4. The member opens the Export menu while the grid query is still running and keeps it open: Copy SQL becomes enabled when the run ends, without reopening.
5. The joinable set is still loading when the page opens: the band shows today's one-hop set, not an empty band.

Tests for these are in Tasks 1, 4, 5, 6 and 8.

---

### Task 1: The band's rules know the joinable set and put the main mart first

**Files:**
- Modify: `src/graph/visible.ts`
- Test: `src/graph/visible.test.ts`

**Interfaces:**
- Produces: `VisibleInput.joinable?: string[] | null` (the mart ids the main mart can join, any depth; null while unknown). `VisibleResult.joinable: Set<string> | null` (null with no main mart or while unknown).

- [ ] **Step 1: Write the failing tests** (append to `src/graph/visible.test.ts`; add `type VisibleInput` to the import from `./visible`)

```ts
const runWith = (model: Model, selection: Selection, o: Partial<VisibleInput> = {}) =>
  computeVisible({ model, selection, search: '', contextIds: [], ...o });

describe('joinable', () => {
  test('rule 2 with the joinable set known: the main mart and every mart it can join, at any depth', () => {
    const m = modelOf(['a', 'b', 'c', 'd', 'z'], [e('a', 'b'), e('b', 'c'), e('z', 'a')]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: ['b', 'c'] });
    expect(r.ids[0]).toBe('a');
    expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'c']));
    expect(r.joinable).toEqual(new Set(['b', 'c']));
  });

  test('rule 2 falls back to one hop while the joinable set is loading', () => {
    const m = modelOf(['a', 'b', 'c', 'z'], [e('a', 'b'), e('b', 'c'), e('z', 'a')]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: null });
    expect(new Set(r.ids)).toEqual(new Set(['a', 'b', 'z']));
    expect(r.joinable).toBeNull();
  });

  test('rule 2 leaves out joinable marts the member cannot open', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{}, { accessible: false }]);
    expect(runWith(m, sel({ martId: 'a' }), { joinable: ['b'] }).ids).toEqual(['a']);
  });

  test('rule 0: the main mart and its joined marts come before the smart search hits', () => {
    const m = modelOf(['a', 'b', 'c', 'd'], [e('a', 'b')]);
    const r = runWith(m, sel({ martId: 'a' }), { found: ['c', 'd'], joined: ['b'], search: 'zzz' });
    expect(r.ids).toEqual(['a', 'b', 'c', 'd']);
  });

  test('rule 1 lists every match and reports the joinable set for dimming', () => {
    const m = modelOf(['a', 'b', 'c'], [e('a', 'b')]);
    const r = runWith(m, sel({ martId: 'a' }), { search: 'c', joinable: ['b'] });
    expect(r.ids).toEqual(['a', 'c']);
    expect(r.joinable).toEqual(new Set(['b']));
  });

  test('with no main mart the joinable set is null', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{ sourceKey: 's1' }, { sourceKey: 's1' }], [{ key: 's1', name: 'S', logo: null, martIds: ['a', 'b'] }]);
    expect(runWith(m, sel({ sourceKey: 's1' }), { joinable: ['b'] }).joinable).toBeNull();
  });

  test('a main mart in an unticked storage is not put first, and the joinable band still renders', () => {
    const m = modelOf(['a', 'b'], [e('a', 'b')], [{ storageId: 's2' }, {}]);
    const r = runWith(m, sel({ martId: 'a' }), { joinable: ['b'], storageIds: ['s'] });
    expect(r.ids).toEqual(['b']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/graph/visible.test.ts`
Expected: FAIL (`joinable` is undefined on the result; rule 0 order differs).

- [ ] **Step 3: Implement** in `src/graph/visible.ts`

Add to `VisibleInput`:

```ts
  /** The marts the main mart can join, at any depth (its blendable sources); null while they load. */
  joinable?: string[] | null;
```

Add to `VisibleResult`:

```ts
  /** With a main mart set and its joins read: the marts it can join. The band dims the rest. Null otherwise. */
  joinable: Set<string> | null;
```

In `computeVisible`, destructure `joinable = null`, and right after `selectedId` is computed add:

```ts
  const joinableSet = selectedId && joinable ? new Set(joinable) : null;
```

Every `return { ids, focusId }` becomes `return { ids, focusId, joinable: joinableSet }`.

Replace the rule 0 return with:

```ts
    // The main mart first, then its joined marts, then the hits.
    const head = always.filter((id) => id === selectedId || joined.includes(id));
    return { ids: [...new Set([...head, ...hits, ...titled, ...always])], focusId, joinable: joinableSet };
```

Replace rule 2 with:

```ts
  // 2. A mart is selected: it and every mart it can join, at any depth. While those are read, its neighbours and the
  // joined marts' neighbours stand in, so the band is not empty.
  if (selectedId) {
    const selected = [selectedId, ...joined.filter((id) => model.marts.has(id))];
    const reach = joinableSet
      ? [...joinableSet].filter((id) => model.marts.get(id)?.accessible)
      : selected.flatMap((id) => neighbours(id, model.edges));
    return { ids: arrange(withJoined([...new Set([...selected, ...reach])].filter(inStorage)), selectedId), focusId, joinable: joinableSet };
  }
```

Update the rule 2 line in the comment above `computeVisible` if it describes one hop.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/graph/visible.test.ts`
Expected: PASS. If an older test compares the whole result with `toEqual({ ids, focusId })`, add `joinable: null` to its expectation.

- [ ] **Step 5: Commit**

```bash
git add src/graph/visible.ts src/graph/visible.test.ts
git commit -m "Data Marts band: the main mart is first under every rule; with its joins read, rule 2 lists every mart it can join

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: A mart joins by the path closest to the main mart

**Files:**
- Modify: `src/state/join-plan.ts`
- Test: `src/state/join-plan.test.ts`

**Interfaces:**
- Produces: `parentPath(aliasPath: string): string`; `inUsePaths(columns: string[], sources: JoinedSource[]): Set<string>`; `sourceOfMart(sources, martId, inUse?: Set<string>)`; `fieldsFor(sources, martId, remembered, shown = null, inUse?: Set<string>)`.

- [ ] **Step 1: Write the failing tests** (append; add `inUsePaths, sourceOfMart` to the import)

```ts
describe('the path a mart joins by', () => {
  const direct = src('stores', 'stores', [f('stores__city', 'string', 'stores')], 1);
  const viaCustomers = src('customers.stores', 'stores', [f('customers__stores__city', 'string', 'stores')], 2);
  const viaProducts = src('products.stores', 'stores', [f('products__stores__city', 'string', 'stores')], 2);
  const customers = src('customers', 'customers', [f('customers__city', 'string', 'customers')], 1);
  const products = src('products', 'products', [f('products__sku', 'string', 'products')], 1);

  test('a direct join to the main mart wins', () => {
    expect(sourceOfMart([customers, direct, viaCustomers], 'stores', new Set(['', 'customers']))?.aliasPath).toBe('stores');
  });

  test('with no direct join, the path through a mart in use wins over one listed first', () => {
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores', new Set(['', 'customers']))?.aliasPath).toBe('customers.stores');
  });

  test('with no path through a mart in use, the first (shallowest) path', () => {
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores', new Set(['']))?.aliasPath).toBe('products.stores');
    expect(sourceOfMart([customers, products, viaProducts, viaCustomers], 'stores')?.aliasPath).toBe('products.stores');
  });

  test('the paths in use are the main mart\'s and those of the joined columns', () => {
    expect(inUsePaths(['id', 'customers__city'], [customers, products])).toEqual(new Set(['', 'customers']));
  });

  test('clicking a mart joins it through the joined mart closest to the main one', () => {
    const sources = [customers, products, viaProducts, viaCustomers];
    const e = { ...env({ orders: g(['id', 'customers__city']) }, 'orders'), sourcesOf: (id: string) => (id === 'orders' ? sources : []) };
    expect(planClick(e, 'stores').grids.orders!.columns).toContain('customers__stores__city');
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/state/join-plan.test.ts`
Expected: FAIL (`inUsePaths` is not exported; `planClick` picks `products__stores__city`).

- [ ] **Step 3: Implement** in `src/state/join-plan.ts`

Replace `sourceOfMart` with:

```ts
/** The alias path a path hangs from: '' for a mart the main one joins directly. */
export const parentPath = (aliasPath: string): string => {
  const i = aliasPath.lastIndexOf('.');
  return i < 0 ? '' : aliasPath.slice(0, i);
};

/** The alias paths a grid uses: '' for the main mart, and the path of each joined field among the columns. */
export function inUsePaths(columns: string[], sources: JoinedSource[]): Set<string> {
  const pathOf = new Map<string, string>();
  for (const s of sources) for (const f of s.fields) if (!pathOf.has(f.name)) pathOf.set(f.name, s.aliasPath);
  return new Set(['', ...columns.flatMap((c) => (pathOf.has(c) ? [pathOf.get(c)!] : []))]);
}

/**
 * The source a mart joins by. Given the paths in use, a path that hangs from one of them, the closest to the main mart
 * (the list is sorted by depth, so the first such path); else, or without them, the shallowest path.
 */
export const sourceOfMart = (sources: JoinedSource[], martId: string, inUse?: Set<string>): JoinedSource | undefined => {
  const paths = sources.filter((s) => s.martId === martId);
  return (inUse && paths.find((s) => inUse.has(parentPath(s.aliasPath)))) || paths[0];
};
```

Change `fieldsFor` to take `inUse` and pass it on:

```ts
export function fieldsFor(sources: JoinedSource[], martId: string, remembered: string[] | undefined, shown: string[] | null = null, inUse?: Set<string>): string[] {
  const source = sourceOfMart(sources, martId, inUse);
```

(The rest of `fieldsFor` is unchanged.) Update its doc comment: "The path is the one `sourceOfMart` picks for the paths in use."

In `planClick`'s joinable branch, pass the paths in use:

```ts
  if (isJoinable(sources, id)) {
    const columns = orderColumns([...grid.columns, ...fieldsFor(sources, id, env.picksOf(main)[id], shownOf(id), inUsePaths(grid.columns, sources)).filter((n) => !grid.columns.includes(n))], sources, env.ownColumns(main));
```

Also pass `inUsePaths(columns, nextSources)` as the fifth argument in the promote loop of `planClick` (`fieldsFor(nextSources, r, nextPicks[r], ownNamesIn(...))`).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/state/join-plan.test.ts`
Expected: PASS, the older tests included.

- [ ] **Step 5: Commit**

```bash
git add src/state/join-plan.ts src/state/join-plan.test.ts
git commit -m "A mart reachable by several paths joins through the in-use mart closest to the main one, else the shallowest path

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Unjoinable clicks do nothing; planMakeMain

**Files:**
- Modify: `src/state/join-plan.ts`
- Test: `src/state/join-plan.test.ts`

**Interfaces:**
- Consumes: `inUsePaths`, `fieldsFor(..., inUse)` from Task 2.
- Produces: `Plan.noop?: true`; `planMakeMain(env: PlanEnv, id: string): Plan`.

- [ ] **Step 1: Write the failing tests**

Replace the test `'clicking a mart the main cannot join makes it the only selected mart'` with:

```ts
test('clicking a mart the main cannot join changes nothing', () => {
  const plan = planClick(env({ orders: g(['id', 'customers__city']) }, 'orders'), 'products2');
  expect(plan).toEqual({ selection: sel('orders'), grids: {}, saves: [], remember: [], noop: true });
});
```

Replace the test `'a mart the main one cannot join becomes the only selected mart: the joined columns it was left with go, and are remembered'` with:

```ts
test('a mart made main: its own columns, the old main joined with what it showed, marts it cannot reach remembered', () => {
  const grids = { customers: g(['id', 'countries__name']), orders: g(['id', 'customers__city', 'products__sku'], { filters: { customers__city: { field: 'customers__city', op: 'eq', value: 'x' } } }) };
  const plan = planMakeMain(env(grids, 'customers'), 'orders');
  expect(plan.selection).toEqual(sel('orders'));
  expect(plan.grids.orders).toEqual(g(['id', 'customers__id']));
  expect(plan.saves).toEqual([{ martId: 'orders', columns: ['id', 'customers__id'] }]);
  expect(plan.remember).toEqual([{ martId: 'countries', fields: ['name'] }]);
});
```

Add (add `planMakeMain` to the import):

```ts
describe('planMakeMain', () => {
  const customersBack = [src('orders', 'orders', [f('orders__status', 'string', 'orders'), f('orders__total', 'number', 'orders')]), ...customersSources];
  const envM = (grids: Record<string, GridState>, main: string | null): PlanEnv => ({
    ...env(grids, main),
    sourcesOf: (id) => ({ orders: ordersSources, customers: customersBack } as Record<string, JoinedSource[]>)[id] ?? [],
  });

  test('its own columns first, then the old main with the columns it showed, then the joined marts it can reach', () => {
    const plan = planMakeMain(envM({ orders: g(['id', 'status', 'customers__city', 'stores__city']), customers: g(['id', 'city']) }, 'orders'), 'customers');
    expect(plan.selection.martId).toBe('customers');
    expect(plan.grids.customers!.columns).toEqual(['city', 'orders__status', 'stores__city']);
    expect(plan.remember).toEqual([]);
  });

  test('a joined mart made main shows the fields it had as joined, as its own columns', () => {
    const e = { ...envM({ orders: g(['id', 'customers__city', 'customers__email']), customers: g(['id']) }, 'orders'), ownNames: () => ['id', 'city', 'email'] };
    expect(planMakeMain(e, 'customers').grids.customers!.columns.slice(0, 2)).toEqual(['city', 'email']);
  });

  test('a mart not on the grid brings what it showed when it last left one', () => {
    const e = { ...envM({ orders: g(['id']), customers: g(['id']) }, 'orders'), ownNames: () => ['id', 'name'], lastShownOf: (id: string) => (id === 'customers' ? ['name'] : null) };
    expect(planMakeMain(e, 'customers').grids.customers!.columns[0]).toBe('name');
  });

  test('the new main keeps its own filters and sorts on the new columns, and none of the old main\'s', () => {
    const grids = {
      orders: g(['id', 'status'], { filters: { status: { field: 'status', op: 'eq', value: 'paid' } } }),
      customers: g(['id', 'city'], { filters: { city: { field: 'city', op: 'eq', value: 'Kyiv' }, gone: { field: 'gone', op: 'eq', value: 'x' } }, sorts: [{ field: 'city', direction: 'asc' }] }),
    };
    const next = planMakeMain(envM(grids, 'orders'), 'customers').grids.customers!;
    expect(Object.keys(next.filters)).toEqual(['city']);
    expect(next.sorts).toEqual([{ field: 'city', direction: 'asc' }]);
  });

  test('making the main mart main, or with no main mart, falls back sensibly', () => {
    expect(planMakeMain(envM({}, 'orders'), 'orders').noop).toBe(true);
    expect(planMakeMain(envM({}, null), 'orders').selection.martId).toBe('orders');
  });
});
```

In the `describe` that uses `withShown`, the tests that call `planClick` with a main mart set on a mart the main cannot join (`'a mart shown as joined and later clicked as main…'`, `'a main replaced by another mart, and its joined marts, remember what they showed'`, `'joined marts stripped from the new main\'s stale saved grid…'`, `'a mart made main keeps what it remembered…'`): change `planClick` to `planMakeMain`. Keep each test's assertion about `remember`. Where a column expectation changes only because the old main now joins the new one (`customersSources` has `stores`), assert `columns.slice(0, n)` on the new main's own part instead. Where a test asserted the old main in `remember` and the new main can now join it, drop that one entry from the expectation and say why in a comment.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/state/join-plan.test.ts`
Expected: FAIL (`planMakeMain` is not exported; the unjoinable click still replaces the main).

- [ ] **Step 3: Implement** in `src/state/join-plan.ts`

Add to `Plan`:

```ts
  /** Nothing to do: the caller dispatches nothing. */
  noop?: true;
```

Replace the last line of `planClick` (`return becomeMain(env, id, leaveAll(main, sources, grid));`) with:

```ts
  // A mart the main one cannot join does not replace it. The member drags it onto the main card for that (planMakeMain).
  return { selection: env.selection, grids: {}, saves: [], remember: [], noop: true };
```

Add after `planClick`:

```ts
/**
 * A mart dropped onto the main card becomes the main mart. Its own columns come first: what it shows as joined now, else
 * what it showed when it last left a grid, else its grid's own columns, else its defaults. The old main follows as a joined
 * mart with the columns it showed, if the new main can join it, then every joined mart the new main can reach. A mart it
 * cannot reach is dropped and remembered. The new main keeps its own grid's filters and sorts on the new columns; the old
 * main's do not carry over, because each main names the same field differently.
 */
export function planMakeMain(env: PlanEnv, id: string): Plan {
  const main = env.selection.martId;
  if (!main) return becomeMain(env, id);
  if (id === main) return { selection: env.selection, grids: {}, saves: [], remember: [], noop: true };
  const sources = env.sourcesOf(main);
  const grid = env.gridOf(main);
  const nextSources = env.sourcesOf(id);
  const nextGrid = env.gridOf(id);
  const offered = new Set(env.ownNames?.(id) ?? []);
  const shownNow = ownNamesIn(grid.columns, sources, id).filter((n) => offered.has(n));
  const last = (env.lastShownOf ?? noShown)(id)?.filter((n) => offered.has(n)) ?? [];
  const own = ownColumnsIn(nextGrid.columns, nextSources);
  let columns = shownNow.length ? shownNow : last.length ? last : own.length ? own : env.ownColumns(id);
  const remember: Plan['remember'] = [];
  const add = (martId: string, shown: string[]) => {
    const names = fieldsFor(nextSources, martId, undefined, shown, inUsePaths(columns, nextSources));
    columns = [...columns, ...names.filter((n) => !columns.includes(n))];
  };
  const mainShown = ownColumnsIn(grid.columns, sources);
  if (isJoinable(nextSources, main)) add(main, mainShown);
  else remember.push({ martId: main, fields: mainShown });
  for (const r of joinedMartIds(grid.columns, sources)) {
    if (r === id) continue;
    const shown = ownNamesIn(grid.columns, sources, r);
    if (isJoinable(nextSources, r)) add(r, shown);
    else remember.push({ martId: r, fields: shown });
  }
  columns = orderColumns(columns, nextSources, env.ownColumns(id));
  const filters = Object.fromEntries(Object.entries(nextGrid.filters).filter(([k]) => columns.includes(k)));
  const kept = nextGrid.sorts && sortsOnColumns(nextGrid.sorts, columns);
  const agg = keepVisible({ aggregations: nextGrid.aggregations ?? [], dateTrunc: nextGrid.dateTrunc ?? [] }, columns);
  const next: GridState = {
    ...nextGrid,
    columns,
    filters,
    sorts: nextGrid.sorts && nextGrid.sorts.length > 0 && kept!.length === 0 ? null : kept,
    aggregations: agg.aggregations.length ? agg.aggregations : undefined,
    dateTrunc: agg.dateTrunc.length ? agg.dateTrunc : undefined,
  };
  return { selection: { sourceKey: env.sourceKeyFor(id), martId: id, record: null }, grids: { [id]: next }, saves: [{ martId: id, columns }], remember };
}
```

If `leaveAll` is now unused, delete it. Run `npx tsc -b` to check.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/state/join-plan.test.ts`
Expected: PASS. If the first `planMakeMain` test's expected column order differs only because `orderColumns` groups the joined marts in first-appearance order, keep the order `orderColumns` gives. Own columns must come first, and the old main's group must come before `stores`.

- [ ] **Step 5: Commit**

```bash
git add src/state/join-plan.ts src/state/join-plan.test.ts
git commit -m "A click on a mart the main one cannot join changes nothing; planMakeMain makes a dropped mart the main one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Wire it in: make-main mode, joinable band, dimmed cards, hint and button

**Files:**
- Modify: `src/ui/bands/useCardClick.ts`, `src/ui/App.tsx`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/cards.tsx`, `src/ui/bands/bands.css`
- Test: `src/ui/bands/joined-marts.test.tsx`, `src/ui/bands/page.test.tsx`

**Interfaces:**
- Consumes: `planMakeMain`, `Plan.noop` (Task 3); `VisibleInput.joinable`, `VisibleResult.joinable` (Task 1).
- Produces: `ClickOptions.mode?: 'makeMain'` (call `click(id, { mode: 'makeMain' })`); `MartCard` props `unjoinable?: boolean`, `mainTitle?: string`, `ghost?: boolean`, `dropTarget?: boolean`, `dropHot?: boolean`, `onMakeMain?: () => void`; `data-mart-id` on every mart card `<article>`.

- [ ] **Step 1: Write the failing tests**

In `src/ui/bands/joined-marts.test.tsx`, replace `'clicking a data mart the main one cannot join makes it the main one, alone'` with:

```ts
test('the make-main button makes a joined mart the main one, and Undo takes it back in one step', async () => {
  setup();
  await ready();
  await click('Customers');
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
  await userEvent.click(within(card('Customers')).getByRole('button', { name: 'Make main data mart' }));
  await waitFor(() => expect(groupTitles()[0]).toBe('Customers'));
  expect(marts().querySelector('article')).toBe(card('Customers'));
  await undo();
  await waitFor(() => expect(title()).toBe('Orders + Customers'));
});

test('with Orders main, the band lists the marts it can join at any depth, and not Order Items', async () => {
  setup();
  await ready();
  await within(marts()).findByText('Countries');
  await within(marts()).findByText('Categories');
  expect(within(marts()).queryByText('Order Items')).toBeNull();
  expect(marts().querySelector('article')).toBe(card('Orders'));
});
```

In `src/ui/bands/page.test.tsx`, add (inside the file's top level, next to the other search tests; use `mountWith` and `search`):

```ts
test('a mart the main one cannot join is dimmed in a search, and a click explains instead of switching', async () => {
  await mountWith();
  await search('Order Items');
  const marts = document.getElementById('band-marts')!;
  const items = (await within(marts).findByText('Order Items')).closest('article')!;
  expect(items).toHaveClass('dm-unjoinable');
  fireEvent.click(items);
  expect(await within(items).findByRole('status')).toHaveTextContent("Can't join Orders. Drag it onto Orders to make it the main data mart.");
  expect(marts.querySelector('article')).toHaveTextContent('Orders');
  expect(within(document.getElementById('band-data')!).queryAllByRole('columnheader').some((h) => h.textContent === 'Order Items')).toBe(false);
});
```

Import `fireEvent` and `within` in `page.test.tsx` if they are not imported yet.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/bands/joined-marts.test.tsx src/ui/bands/page.test.tsx`
Expected: FAIL (no "Make main data mart" button; Order Items is not dimmed).

- [ ] **Step 3: Implement**

`src/ui/bands/useCardClick.ts`:

```ts
export type ClickOptions = {
  /** The click only takes a mart out: it does nothing when the mart is no longer the main or a joined one when it runs (a double click on a remove button). */
  only?: 'deselect';
  /** The mart becomes the main one (a drop on the main card, or its make-main button). */
  mode?: 'makeMain';
};
```

In `run`, add `const makeMain = options?.mode === 'makeMain';` at the top. Replace the line that loads the clicked mart:

```ts
    // The plan reads the clicked mart's grid only when it may become the main mart.
    if (id !== main && (makeMain || !main)) await load(id);
```

Change the plan line and the dispatch:

```ts
    const plan = (makeMain ? planMakeMain : planClick)({ /* the same env object as now */ }, id);
    if (plan.noop) { await rendered(); return; }
```

Import `planMakeMain` from `../../state/join-plan`.

`src/ui/App.tsx`: pass the joinable set to `computeVisible` and add it to the memo deps:

```ts
  const joinable = useMemo(() => (joinSources ? [...new Set(joinSources.map((s) => s.martId))] : null), [joinSources]);
  const visible = useMemo(
    () => (model ? computeVisible({ model, selection: state.selection, search: state.search, contextIds: state.contextIds, storageIds, joined, filtered, found: state.found, joinable }) : null),
    [model, state.selection, state.search, state.found, state.contextIds, storageIds, joined, filtered, joinable],
  );
```

`src/ui/bands/cards.tsx`, `MartCard`:

1. Add the props listed under Interfaces, with JSDoc on each.
2. Add `import { Crown } from 'lucide-react'` to the existing lucide import.
3. Count request: `if (!mart.accessible || ghost || !el.current) return;` and add `ghost` to that effect's deps.
4. Hint state:

```ts
  const [hint, setHint] = useState(false);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(false), 3000);
    return () => clearTimeout(t);
  }, [hint]);
  const choose = unjoinable ? () => setHint(true) : onSelect;
```

5. On `<article>`: `data-mart-id={mart.id}`, `{...(ghost ? { 'data-ghost': '' } : {})}`, `{...selectable(choose)}`, and extra classes `dm-unjoinable` when `unjoinable`, `dm-ghost` when `ghost`, `dm-drop-target` when `dropTarget`, `dm-drop-hot` when `dropHot`.
6. Before the "Open in OWOX" button, inside `.dm-node-head`:

```tsx
        {onMakeMain && (
          <span className="dm-card-reveal"><Tooltip content="Make main data mart">
            <button type="button" aria-label="Make main data mart" className="dm-link" onClick={(e) => { e.stopPropagation(); onMakeMain(); }}>
              <Crown size={14} />
            </button>
          </Tooltip></span>
        )}
```

7. After `.dm-node-foot`:

```tsx
      {hint && mainTitle && <span role="status" className="dm-card-hint">Can't join {mainTitle}. Drag it onto {mainTitle} to make it the main data mart.</span>}
```

`src/ui/bands/CardBands.tsx`, in the mart card map:

```tsx
          const mainId = selection.martId;
          const unjoinable = !!mainId && visible.joinable !== null && id !== mainId && !joined.includes(id) && !visible.joinable.has(id);
          // ...
              unjoinable={unjoinable}
              mainTitle={mainId ? model.marts.get(mainId)?.title : undefined}
              onMakeMain={mainId && id !== mainId && mart.accessible ? () => void click(id, { mode: 'makeMain' }) : undefined}
```

`src/ui/bands/bands.css` (use the file's existing color variables; check the top of the file for their names):

```css
.dm-node.dm-unjoinable { opacity: 0.45; }
.dm-node.dm-unjoinable:hover, .dm-node.dm-unjoinable:focus-visible { opacity: 0.7; }
.dm-node.dm-ghost { border-style: dashed; opacity: 0.6; }
.dm-node.dm-drop-target { outline: 2px dashed var(--primary); outline-offset: 2px; }
.dm-node.dm-drop-hot { outline-style: solid; }
.dm-card-hint { position: absolute; left: 8px; right: 8px; bottom: calc(100% + 4px); z-index: 5; padding: 6px 8px; border-radius: 6px; font-size: 12px; background: var(--popover); color: var(--popover-foreground); box-shadow: 0 2px 8px rgb(0 0 0 / 0.15); }
```

If `.dm-node` is not the card's base class, use the class `cardClass` returns. The card needs `position: relative` for the hint. Add it if missing.

Update the Data Marts band `hint` text in `CardBands.tsx` to: `"The main data mart first, and every mart it can join; or what the search and the filters match. Drag a card onto the main one to make it main."`

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/bands`
Expected: PASS. Older page tests that expected a one-hop band with Orders main (for example, `'the Data Marts band shows the marts connected to a joined mart, not only the main one\'s'`) may now see more cards. Keep each test's claim, and change only counts or lists that grew because rule 2 now goes past one hop.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b
git add src/ui src/state
git commit -m "Main data mart changes only on purpose: the make-main button, unjoinable cards dimmed with a hint, the band lists every joinable mart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Drag a card onto the main card

**Files:**
- Create: `src/ui/bands/useCardDrag.ts`
- Modify: `src/ui/bands/CardBands.tsx`, `src/ui/bands/bands.css`
- Test: `src/ui/bands/joined-marts.test.tsx`

**Interfaces:**
- Consumes: `click(id, { mode: 'makeMain' })`, `MartCard` `dropTarget`, `dropHot`, `data-mart-id`, `data-ghost` (Task 4).
- Produces: `useCardDrag(canvas: RefObject<HTMLElement | null>, mainId: string | null, titleOf: (id: string) => string, onDrop: (id: string) => void): CardDrag | null`, where `CardDrag = { id: string; title: string; x: number; y: number; overMain: boolean }`.

- [ ] **Step 1: Write the failing tests** (append to `joined-marts.test.tsx`)

```ts
describe('dragging a card onto the main card', () => {
  const pointer = (type: string, target: EventTarget, x: number, y: number) =>
    fireEvent(target, new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }));
  let hit: Element | null = null;
  beforeEach(() => { (document as { elementFromPoint?: unknown }).elementFromPoint = () => hit; });
  afterEach(() => { delete (document as { elementFromPoint?: unknown }).elementFromPoint; hit = null; });

  test('a drop on the main card makes the dragged mart main; the click that ends the drag does not also join it', async () => {
    setup();
    await ready();
    await within(marts()).findByText('Customers');
    hit = card('Orders');
    pointer('pointerdown', card('Customers'), 0, 0);
    pointer('pointermove', window, 30, 0);
    expect(card('Orders')).toHaveClass('dm-drop-target');
    pointer('pointerup', window, 30, 0);
    fireEvent.click(card('Customers'));
    await waitFor(() => expect(groupTitles()[0] ?? title()).toBe('Customers'));
    expect(marts().querySelector('article')).toBe(card('Customers'));
  });

  test('a drop anywhere else, or Escape, changes nothing', async () => {
    setup();
    await ready();
    await within(marts()).findByText('Customers');
    hit = marts();
    pointer('pointerdown', card('Customers'), 0, 0);
    pointer('pointermove', window, 30, 0);
    pointer('pointerup', window, 30, 0);
    pointer('pointerdown', card('Customers'), 0, 0);
    pointer('pointermove', window, 30, 0);
    fireEvent.keyDown(document, { key: 'Escape' });
    hit = card('Orders');
    pointer('pointerup', window, 30, 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(title()).toBe('Orders');
    expect(card('Orders')).not.toHaveClass('dm-drop-target');
  });

  test('a press that moves less than 5 px is a click', async () => {
    setup();
    await ready();
    await within(marts()).findByText('Customers');
    hit = card('Orders');
    pointer('pointerdown', card('Customers'), 0, 0);
    pointer('pointermove', window, 3, 0);
    pointer('pointerup', window, 3, 0);
    fireEvent.click(card('Customers'));
    await waitFor(() => expect(title()).toBe('Orders + Customers'));
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/bands/joined-marts.test.tsx`
Expected: FAIL (no drop target class; the main mart does not change).

- [ ] **Step 3: Implement** `src/ui/bands/useCardDrag.ts`

```ts
import { useEffect, useRef, useState, type RefObject } from 'react';
import { martElementId } from './cards';

export type CardDrag = { id: string; title: string; x: number; y: number; overMain: boolean };

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a data mart card onto the main card. A press on any card but the main one (not on its buttons, not on a ghost)
 * becomes a drag past 5 px; a release over the main card calls `onDrop`. A release elsewhere, Escape or a cancelled pointer
 * end the drag with no change. The click the browser sends after a drag is swallowed, so it does not also toggle the card.
 */
export function useCardDrag(canvas: RefObject<HTMLElement | null>, mainId: string | null, titleOf: (id: string) => string, onDrop: (id: string) => void): CardDrag | null {
  const [drag, setDrag] = useState<CardDrag | null>(null);
  const latest = useRef({ mainId, titleOf, onDrop });
  useEffect(() => { latest.current = { mainId, titleOf, onDrop }; });
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    let press: { id: string; x: number; y: number } | null = null;
    let dragging = false;
    const overMain = (x: number, y: number) => {
      const main = latest.current.mainId;
      const hit = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
      return !!main && !!hit?.closest(`#${CSS.escape(martElementId(main))}`);
    };
    const end = () => { press = null; dragging = false; setDrag(null); };
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || !latest.current.mainId) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const id = t.closest<HTMLElement>('[data-mart-id]')?.dataset.martId;
      if (!id || id === latest.current.mainId) return;
      press = { id, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      if (!press) return;
      if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
      dragging = true;
      e.preventDefault();
      setDrag({ id: press.id, title: latest.current.titleOf(press.id), x: e.clientX, y: e.clientY, overMain: overMain(e.clientX, e.clientY) });
    };
    const up = (e: PointerEvent) => {
      if (!press) return;
      const { id } = press;
      const wasDrag = dragging;
      const dropped = wasDrag && overMain(e.clientX, e.clientY);
      end();
      if (wasDrag) {
        const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
      }
      if (dropped) latest.current.onDrop(id);
    };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && press) end(); };
    root.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', end);
    document.addEventListener('keydown', key);
    return () => {
      root.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', end);
      document.removeEventListener('keydown', key);
    };
  }, [canvas]);
  return drag;
}
```

Escape needs the following release to do nothing: `end()` clears `press`, so `up` returns early. The swallow timer runs after the synthetic click in the test, because `fireEvent.click` is synchronous within the same task. If the "a drop on the main card" test still sees the click join Customers, change the swallow removal to `setTimeout(..., 50)`.

`src/ui/bands/CardBands.tsx`:

```ts
  const drag = useCardDrag(canvas, selection.martId, (id) => model.marts.get(id)?.title ?? id, (id) => void click(id, { mode: 'makeMain' }));
```

Pass `dropTarget={drag !== null && selection.martId === id}` and `dropHot={drag !== null && drag.overMain && selection.martId === id}` to `MartCard`. Before the closing `</div>` of the canvas, render the dragged copy:

```tsx
      {drag && <div className="dm-drag-ghost" style={{ left: drag.x + 8, top: drag.y + 8 }} aria-hidden>{drag.title}</div>}
```

`bands.css`:

```css
.dm-drag-ghost { position: fixed; z-index: 60; pointer-events: none; padding: 6px 10px; border-radius: 8px; font-size: 13px; background: var(--card); border: 1px solid var(--border); box-shadow: 0 4px 12px rgb(0 0 0 / 0.18); }
.dm-canvas [data-mart-id] { user-select: none; }
```

Touch is out of scope for drag. Touch users have the make-main button.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/bands`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b
git add src/ui/bands
git commit -m "Drag a data mart card onto the main card to make it the main data mart

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Hover shows the neighbours that are not in the band, as ghost cards

**Files:**
- Modify: `src/ui/bands/CardBands.tsx`
- Test: `src/ui/bands/page.test.tsx`

**Interfaces:**
- Consumes: `MartCard` `ghost`, `unjoinable` (Task 4); `neighbours` from `src/graph/visible.ts`; `VisibleResult.joinable` (Task 1).

- [ ] **Step 1: Write the failing tests** (in `page.test.tsx`)

```ts
describe('ghost cards on hover', () => {
  const marts = () => document.getElementById('band-marts')!;
  const cardOf = (t: string) => within(marts()).getByText(t).closest('article')!;

  test('hovering a card shows its neighbours that are not in the band, dashed, after the last card', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    expect(within(marts()).queryByText('Sessions')).toBeNull();
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    expect(ghost).toHaveClass('dm-ghost');
    expect(ghost).toHaveAttribute('data-ghost');
    const all = [...marts().querySelectorAll('article')];
    expect(all.indexOf(ghost)).toBeGreaterThan(all.indexOf(cardOf('Customers')));
  });

  test('the ghosts stay while the pointer crosses to them, and go once it leaves', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    fireEvent.pointerOver(marts());
    fireEvent.pointerOver(ghost);
    await new Promise((r) => setTimeout(r, 500));
    expect(within(marts()).getByText('Sessions')).toBeInTheDocument();
    fireEvent.pointerLeave(document.querySelector('.dm-canvas')!);
    await waitFor(() => expect(within(marts()).queryByText('Sessions')).toBeNull());
  });

  test('keyboard focus on a card shows the same ghosts', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.focus(cardOf('Customers'));
    expect(await within(marts()).findByText('Sessions')).toBeInTheDocument();
  });

  test('a ghost of a mart the main one cannot join is dimmed and explains on click', async () => {
    await mountWith();
    await within(marts()).findByText('Customers');
    fireEvent.pointerOver(cardOf('Customers'));
    const ghost = (await within(marts()).findByText('Sessions')).closest('article')!;
    expect(ghost).toHaveClass('dm-unjoinable');
    fireEvent.click(ghost);
    expect(await within(ghost).findByRole('status')).toHaveTextContent("Can't join Orders.");
  });
});
```

`Sessions` links to Customers (`sessions → customers`), but Orders cannot reach it, because the blendable walk follows outgoing edges only. So Sessions is not in the band with Orders as main.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/bands/page.test.tsx`
Expected: FAIL (no Sessions card on hover).

- [ ] **Step 3: Implement** in `CardBands.tsx`

After `const [hovered, setHovered] = ...`:

```ts
  // The mart whose hidden neighbours show as ghosts. It follows the hovered card; a ghost being hovered keeps it, and leaving
  // waits 400 ms, so the pointer can cross the gap to a ghost.
  const [ghostOf, setGhostOf] = useState<string | null>(null);
  const shownIds = useMemo(() => new Set(visible.ids), [visible.ids]);
  const ghostIds = useMemo(() => {
    if (!ghostOf) return [];
    const ticked = (id: string) => storageIds === null || storageIds.includes(model.marts.get(id)?.storageId ?? '');
    return neighbours(ghostOf, model.edges).filter((id) => !shownIds.has(id) && model.marts.get(id)?.accessible && ticked(id));
  }, [ghostOf, model, shownIds, storageIds]);
  const ghostKey = ghostIds.join('|');
  useEffect(() => {
    const martOf = (el: string | null) => (el?.startsWith('dm-') ? el.slice(3) : null);
    const id = martOf(hovered);
    if (id && ghostKey.split('|').includes(id)) return;
    if (id && shownIds.has(id)) { setGhostOf(id); return; }
    const t = setTimeout(() => setGhostOf(null), 400);
    return () => clearTimeout(t);
  }, [hovered, shownIds, ghostKey]);
```

Use `martElementId` instead of the literal `'dm-'` if `cards.tsx` exports a reverse helper; otherwise keep the prefix and add a comment that `martElementId` is `dm-<id>`.

Make the wires include the ghosts: change `const idsKey = visible.ids.join('|');` to `const idsKey = [...visible.ids, ...ghostIds].join('|');`. The `pinned` memo checks `idsKey.split('|').includes(selection.martId)` and still works.

After `{martCards.items.map(...)}`, render the ghosts:

```tsx
        {ghostIds.flatMap((id) => {
          const mart = model.marts.get(id);
          if (!mart) return [];
          const el = martElementId(id);
          const mainId = selection.martId;
          return [
            <MartCard
              key={`ghost-${id}`}
              mart={mart}
              ghost
              contexts={contextsOf(mart.contextIds)}
              count={{ state: 'idle' }}
              quality={dq.get(id)}
              freshness={mart.dataLastUpdatedAt}
              selected={false}
              joined={false}
              lit={lit.has(el)}
              aside={aside.has(el)}
              unjoinable={!!mainId && visible.joinable !== null && !visible.joinable.has(id)}
              mainTitle={mainId ? model.marts.get(mainId)?.title : undefined}
              onSelect={() => void click(id)}
              onOpenApp={() => onOpenApp(id)}
              onRetryCount={() => undefined}
              onNeedCount={() => undefined}
            />,
          ];
        })}
```

Import `neighbours` from `../../graph/visible`. The band's `total` stays `visible.ids.length`, so ghosts do not count. Also make the wires' `useMemo` include ghost cards: it already reads `idsKey`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/bands`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b
git add src/ui/bands
git commit -m "Hovering a data mart card shows its neighbours that are not in the band as ghost cards, with their lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The grid query's run and its SQL

**Files:**
- Create: `src/api/run-sql.ts`, `src/api/run-sql.test.ts`
- Modify: `src/sdk/types.ts`, `src/api/rows.ts`, `src/ui/explorer/useMartRows.ts`, `src/sdk/mock/ctx.ts`
- Test: `src/api/run-sql.test.ts`, `src/ui/explorer/useMartRows.test.tsx`

**Interfaces:**
- Produces: `Traversal.runId?: string`; `ReadRowsHooks.onRunId?: (runId: string | undefined) => void`; `type GridRun = { state: 'none' } | { state: 'running' } | { state: 'failed' } | { state: 'done'; runId: string | null }` exported from `useMartRows.ts`; `useMartRows(...)` also returns `run: GridRun`; `type RunSql = { sql: string } | { reason: string }`; `readRunSql(ctx: Ctx, martId: string, runId: string, o?: { retries?: number; waitMs?: number }): Promise<RunSql>`. The mock `traverseData` returns `runId` `mock-run-<n>`, and the mock answers `GET /api/data-marts/<id>/runs/<runId>`.

- [ ] **Step 1: Write the failing tests**

`src/api/run-sql.test.ts`:

```ts
import { readRunSql } from './run-sql';
import { stubCtx } from './test-ctx';

const notFound = () => Object.assign(new Error('nf'), { payload: { status: 404 } });

test('reads executionSqlQuery from the run', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } } })) as never;
  expect(await readRunSql(ctx, 'orders', 'r1')).toEqual({ sql: 'SELECT 1' });
  expect(ctx.owox.getJson).toHaveBeenCalledWith('/api/data-marts/orders/runs/r1');
});

test('a run not saved yet is asked again, then read', async () => {
  const ctx = stubCtx();
  const get = vi.fn().mockRejectedValueOnce(notFound()).mockResolvedValueOnce({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 2' } } });
  ctx.owox.getJson = get as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0 })).toEqual({ sql: 'SELECT 2' });
  expect(get).toHaveBeenCalledTimes(2);
});

test('still not found after the retries, or another error: the SQL could not be read', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn().mockRejectedValue(notFound()) as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0, retries: 2 })).toEqual({ reason: 'The SQL could not be read from OWOX' });
  expect(ctx.owox.getJson).toHaveBeenCalledTimes(3);
  ctx.owox.getJson = vi.fn().mockRejectedValue(new Error('boom')) as never;
  expect(await readRunSql(ctx, 'orders', 'r1', { waitMs: 0 })).toEqual({ reason: 'The SQL could not be read from OWOX' });
  expect(ctx.owox.getJson).toHaveBeenCalledTimes(1);
});

test('a run without SQL says so', async () => {
  const ctx = stubCtx();
  ctx.owox.getJson = vi.fn(async () => ({ additionalParams: { httpData: {} } })) as never;
  expect(await readRunSql(ctx, 'orders', 'r1')).toEqual({ reason: 'OWOX did not record the SQL of this query' });
});
```

In `src/ui/explorer/useMartRows.test.tsx`, add a test in the file's existing style (read the top of the file for its render helper):

```ts
test('the run of the last query: none, running, done with its run id, failed', async () => {
  let open!: () => void;
  const gate = new Promise<void>((r) => { open = r; });
  const traverseData = vi.fn(async () => { await gate; return { ...traversalOf([{ id: 1 }]), runId: 'r-7' }; });
  const ctx = stubCtx({ dataMarts: { list: vi.fn(), traverseData } });
  const wrapper = ({ children }: { children: ReactNode }) => <AppServices ctx={ctx}><StoreProvider>{children}</StoreProvider></AppServices>;
  const options: TraverseOptions = { column: ['id'], limit: 3 };

  const none = renderHook(() => useMartRows('orders', null, 0), { wrapper });
  expect(none.result.current.run).toEqual({ state: 'none' });

  const { result } = renderHook(() => useMartRows('orders', options, 0), { wrapper });
  expect(result.current.run).toEqual({ state: 'running' });
  open();
  await waitFor(() => expect(result.current.run).toEqual({ state: 'done', runId: 'r-7' }));

  const failing = stubCtx({ dataMarts: { list: vi.fn(), traverseData: vi.fn(async () => { throw new Error('boom'); }) } });
  const failWrap = ({ children }: { children: ReactNode }) => <AppServices ctx={failing}><StoreProvider>{children}</StoreProvider></AppServices>;
  const failed = renderHook(() => useMartRows('orders', options, 0), { wrapper: failWrap });
  await waitFor(() => expect(failed.result.current.run).toEqual({ state: 'failed' }));
});

test('a host that sends no run id gives done with a null run id', async () => {
  const { wrapper } = hookCtx();
  const { result } = renderHook(() => useMartRows('orders', { column: ['id'], limit: 3 }, 0), { wrapper });
  await waitFor(() => expect(result.current.run).toEqual({ state: 'done', runId: null }));
});
```

Place these after `hookCtx` is defined.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/api/run-sql.test.ts src/ui/explorer/useMartRows.test.tsx`
Expected: FAIL (`./run-sql` does not exist; `run` is undefined).

- [ ] **Step 3: Implement**

`src/sdk/types.ts`, in `Traversal`:

```ts
  /** The run OWOX recorded for this read (`x-owox-run-id`); absent on a host that does not send it. */
  readonly runId?: string;
```

`src/api/rows.ts`: add `onRunId?: (runId: string | undefined) => void;` to `ReadRowsHooks`, and call `hooks.onRunId?.(traversal.runId);` right after `const traversal = await ...`.

`src/api/run-sql.ts`:

```ts
import type { Ctx } from '../sdk/types';

/** The SQL a grid query ran, or why it is not available. */
export type RunSql = { sql: string } | { reason: string };
type RunDto = { additionalParams?: { httpData?: { executionSqlQuery?: unknown } } | null } | null;

/** The SDK transport puts the HTTP status on `payload`; a plain `status` is kept as a fallback. */
const isNotFound = (e: unknown) => { const x = e as { payload?: { status?: number }; status?: number } | null; return (x?.payload?.status ?? x?.status) === 404; };
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The compiled SQL of a grid query, from its run. OWOX saves the run when the query ends, so a 404 is asked again,
 * `retries` times (default 3), `waitMs` apart (default 1000). It only reads: no query runs and nothing is written.
 */
export async function readRunSql(ctx: Ctx, martId: string, runId: string, o: { retries?: number; waitMs?: number } = {}): Promise<RunSql> {
  const retries = o.retries ?? 3;
  const waitMs = o.waitMs ?? 1000;
  for (let attempt = 0; ; attempt++) {
    try {
      const run = await ctx.owox.getJson<RunDto>(`/api/data-marts/${encodeURIComponent(martId)}/runs/${encodeURIComponent(runId)}`);
      const sql = run?.additionalParams?.httpData?.executionSqlQuery;
      return typeof sql === 'string' && sql.trim() ? { sql } : { reason: 'OWOX did not record the SQL of this query' };
    } catch (e) {
      if (isNotFound(e) && attempt < retries) { await pause(waitMs); continue; }
      return { reason: 'The SQL could not be read from OWOX' };
    }
  }
}
```

`src/ui/explorer/useMartRows.ts`:

```ts
/** The query behind the rows on the grid, for Copy SQL. */
export type GridRun = { state: 'none' } | { state: 'running' } | { state: 'failed' } | { state: 'done'; runId: string | null };
```

Add `runId: string | null` to `RowsState` (initial `null`). In the effect, keep `let runId: string | null = null;` and pass `{ signal: ac.signal, onRunId: (id) => { runId = id ?? null; } }` to `readRows`. Set `runId` in both `setState` calls (the error branch sets `runId: null`). Return:

```ts
  const run: GridRun = !options ? { state: 'none' } : loading ? { state: 'running' } : state.error ? { state: 'failed' } : { state: 'done', runId: state.runId };
  return { rows: ..., loading, error: ..., hasMore: ..., run };
```

`src/sdk/mock/ctx.ts`: next to `reports`, add `const runs = new Map<string, string>(); let runSeq = 0;` and a SQL builder:

```ts
  const mockSql = (id: string, o: TraverseOptions) =>
    `SELECT ${(o.column ?? ['*']).map((c) => (c === '*' ? c : `\`${c}\``)).join(', ')}\nFROM \`mock.${id}\`${o.limit ? `\nLIMIT ${o.limit}` : ''}`;
```

In `traverseData`, before `return`: `const runId = \`mock-run-${++runSeq}\`; runs.set(runId, mockSql(id, o));` and add `runId` to the returned object. In `getJson`, before the reports routes:

```ts
        const run = /^\/api\/data-marts\/([^/]+)\/runs\/([^/]+)$/.exec(path);
        if (run) {
          const sql = runs.get(decodeURIComponent(run[2]!));
          if (sql === undefined) throw notFound('Run');
          return { id: decodeURIComponent(run[2]!), additionalParams: { httpData: { executionSqlQuery: sql } } } as T;
        }
```

Import `TraverseOptions` in `ctx.ts` if it is not imported.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/api src/ui/explorer/useMartRows.test.tsx`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b
git add src/api src/sdk src/ui/explorer/useMartRows.ts src/ui/explorer/useMartRows.test.tsx
git commit -m "The grid keeps the run id of its query, and readRunSql reads that run's compiled SQL from OWOX

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Copy SQL in the Export menu

**Files:**
- Modify: `src/ui/explorer/ExportMenu.tsx`, `src/ui/explorer/MartGrid.tsx`
- Test: `src/ui/explorer/ExportMenu.test.tsx`

**Interfaces:**
- Consumes: `GridRun` (Task 7); `readRunSql`, `RunSql` (Task 7).
- Produces: `ExportMenu` prop `run?: GridRun` (default `{ state: 'none' }`).

- [ ] **Step 1: Write the failing tests** (in `ExportMenu.test.tsx`)

Update the two existing assertions that list every menu item (around lines 54 and 379) to end with `'Copy SQL'`.

Add:

```ts
describe('Copy SQL', () => {
  const setClipboard = (writeText: unknown) => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: writeText ? { writeText } : undefined });
  afterEach(() => { delete (navigator as { clipboard?: unknown }).clipboard; });
  const ORDERS: Schema = [{ name: 'id', type: 'INTEGER', category: 'number' }] as Schema;
  const lone = (run: GridRun | undefined, getJson?: (path: string) => Promise<unknown>) => {
    const ctx = createMockCtx(demoFixtures({ sheets: 0 }), { latencyMs: 0 });
    const real = ctx.owox.getJson.bind(ctx.owox);
    const c = getJson ? { ...ctx, owox: { ...ctx.owox, getJson: ((p: string, q?: Record<string, string>) => (p.includes('/runs/') ? getJson(p) : real(p, q))) as typeof ctx.owox.getJson } } : ctx;
    const tree = (r: GridRun | undefined) => <AppServices ctx={c}><TooltipProvider><StoreProvider><ExportMenu martId="orders" martTitle="Orders" schema={ORDERS} visible={['id']} filters={[]} sorts={[]} rows={[{ id: 1 }]} hasMore={false} run={r} /></StoreProvider></TooltipProvider></AppServices>;
    const view = render(tree(run));
    return { view, rerun: (r: GridRun) => view.rerender(tree(r)) };
  };
  const sqlItem = () => screen.findByRole('menuitem', { name: 'Copy SQL' });

  test('it is the last item, after a separator', async () => {
    lone(undefined);
    await userEvent.click(await screen.findByText('Export'));
    const items = screen.getAllByRole('menuitem').filter((r) => !r.hasAttribute('data-link'));
    expect(items.at(-1)).toHaveTextContent('Copy SQL');
    expect((await sqlItem()).closest('[role="group"]')!.previousElementSibling).toHaveAttribute('role', 'separator');
  });

  test.each([
    [undefined, 'The grid has not run a query yet'],
    [{ state: 'running' } as GridRun, "The grid's query is still running"],
    [{ state: 'failed' } as GridRun, "The grid's query failed"],
    [{ state: 'done', runId: null } as GridRun, 'OWOX did not report a run for this query'],
  ])('disabled with the reason: %j', async (run, reason) => {
    lone(run);
    await userEvent.click(await screen.findByText('Export'));
    const item = await sqlItem();
    expect(item).toBeDisabled();
    expect(item).toHaveAttribute('data-reason', reason);
  });

  test('reads the run when the menu opens, then copies the SQL and says so', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setClipboard(writeText);
    const get = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 1' } } }));
    lone({ state: 'done', runId: 'r1' }, get);
    await userEvent.click(await screen.findByText('Export'));
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    expect(get).toHaveBeenCalledWith('/api/data-marts/orders/runs/r1');
    await userEvent.click(await sqlItem());
    expect(writeText).toHaveBeenCalledWith('SELECT 1');
    expect(await screen.findByText('SQL copied. It is the query the grid ran, with its page LIMIT.')).toBeInTheDocument();
  });

  test('a run with no SQL leaves it disabled with the reason', async () => {
    lone({ state: 'done', runId: 'r1' }, async () => ({ additionalParams: { httpData: {} } }));
    await userEvent.click(await screen.findByText('Export'));
    await waitFor(async () => expect(await sqlItem()).toHaveAttribute('data-reason', 'OWOX did not record the SQL of this query'));
  });

  test('a query that ends while the menu is open enables it without reopening', async () => {
    const get = vi.fn(async () => ({ additionalParams: { httpData: { executionSqlQuery: 'SELECT 3' } } }));
    const { rerun } = lone({ state: 'running' }, get);
    await userEvent.click(await screen.findByText('Export'));
    expect(await sqlItem()).toHaveAttribute('data-reason', "The grid's query is still running");
    rerun({ state: 'done', runId: 'r1' });
    await waitFor(async () => expect(await sqlItem()).toBeEnabled());
    expect(document.querySelector('details.dm-export')).toHaveAttribute('open');
  });
});
```

Import `type GridRun` from `./useMartRows`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run src/ui/explorer/ExportMenu.test.tsx`
Expected: FAIL (no Copy SQL item).

- [ ] **Step 3: Implement** in `ExportMenu.tsx`

1. Imports: add `Code` to the lucide import, `readRunSql, type RunSql` from `../../api/run-sql`, `type GridRun` from `./useMartRows`.
2. `Props`: add `/** The query behind the grid's rows, for Copy SQL. */ run?: GridRun;`.
3. State:

```ts
  const run = p.run ?? { state: 'none' as const };
  const runId = run.state === 'done' ? run.runId : null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [sqlOf, setSqlOf] = useState<{ runId: string; result: RunSql | null } | null>(null);
  const [sqlText, setSqlText] = useState<string | null>(null);
  // The SQL is read once the menu is open and the grid's query has a run; a failed read is tried again on the next open.
  useEffect(() => {
    if (!menuOpen || !runId) return;
    if (sqlOf?.runId === runId && (sqlOf.result === null || 'sql' in sqlOf.result)) return;
    setSqlOf({ runId, result: null });
    readRunSql(ctx, p.martId, runId).then((result) => setSqlOf((cur) => (cur?.runId === runId ? { runId, result } : cur)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, runId]);
  const sqlReady = runId && sqlOf?.runId === runId && sqlOf.result && 'sql' in sqlOf.result ? sqlOf.result.sql : null;
  const sqlOff = sqlReady ? null
    : run.state === 'none' ? 'The grid has not run a query yet'
    : run.state === 'running' ? "The grid's query is still running"
    : run.state === 'failed' ? "The grid's query failed"
    : !runId ? 'OWOX did not report a run for this query'
    : sqlOf?.runId === runId && sqlOf.result && 'reason' in sqlOf.result ? sqlOf.result.reason
    : 'Reading the SQL from OWOX…';
```

4. In `openMenu`, call `setMenuOpen(open)` first.
5. In the `copiedFor` reset line, also `setSqlText(null)`.
6. Add:

```ts
  /** Copies the SQL the grid ran. Nothing is queried and nothing is written. */
  async function copySql(sql: string) {
    closeMenu();
    const home = gen.current;
    const ok = await copyText(sql);
    if (gen.current !== home) return;
    setCopied(null);
    setData(null);
    if (ok) setResult({ kind: 'ok', text: 'SQL copied. It is the query the grid ran, with its page LIMIT.' });
    else { setResult(null); setSqlText(sql); }
  }
```

7. After the Assistants group, inside the level-1 menu:

```tsx
            <div role="separator" className="dm-menu-sep" />
            <div role="group" aria-label="SQL" className="dm-export-sql">
              {sqlOff ? (
                <Tooltip content={sqlOff}>
                  <span className="block" onMouseEnter={() => setOpenDest(null)}>
                    <button type="button" role="menuitem" data-lvl="1" data-action="sql" data-reason={sqlOff} disabled className="dm-export-item w-full"><Code size={16} /><span className="dm-filter-label">Copy SQL</span></button>
                  </span>
                </Tooltip>
              ) : (
                <Tooltip content="The SQL the grid ran, with its page LIMIT">
                  <button type="button" role="menuitem" data-lvl="1" data-action="sql" className="dm-export-item" onMouseEnter={() => setOpenDest(null)} onClick={() => void copySql(sqlReady!)}>
                    <Code size={16} />
                    <span className="dm-filter-label">Copy SQL</span>
                  </button>
                </Tooltip>
              )}
            </div>
```

8. Next to the other `TextDialog`s:

```tsx
      {sqlText && <TextDialog name="SQL" note="Select the SQL and copy it. Copying writes nothing to OWOX." areaLabel="SQL text" text={sqlText} onClose={() => { setSqlText(null); menu.current?.querySelector<HTMLElement>('summary')?.focus(); }} />}
```

9. Update the `ExportMenu` doc comment to name Copy SQL as the last item.

If `.dm-menu-sep` has no style inside `.dm-export` menus, copy the rule `ColumnMenu` uses.

`MartGrid.tsx`: take `run` from `useMartRows` (line ~277: `const { rows: read, loading: reading, error, hasMore, run } = useMartRows(...)`) and pass `run={run}` to `<ExportMenu …/>`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/ui/explorer`
Expected: PASS.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run lint && npx tsc -b
git add src/ui/explorer
git commit -m "Export menu: Copy SQL copies the SQL the grid ran, disabled with its reason until OWOX has it

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end drag, full suite, README

**Files:**
- Create: `e2e/main-mart.spec.ts`
- Modify: `README.md`

- [ ] **Step 1: Write the e2e test**

```ts
import { expect, test, type Page } from '@playwright/test';

const band = (page: Page, id: 'marts' | 'data') => page.locator(`#band-${id}`);
const martCard = (page: Page, title: string) => band(page, 'marts').locator('article', { hasText: title }).first();

test.beforeEach(async ({ page }) => { await page.goto('/?mock'); });

test('dragging Customers onto Orders makes Customers the main data mart, first in the band and in the grid', async ({ page }) => {
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Orders');
  await martCard(page, 'Customers').dragTo(martCard(page, 'Orders'));
  await expect(band(page, 'data').locator('thead tr[data-group-row] th[data-group]').first()).toHaveText('Customers');
  await expect(band(page, 'marts').locator('article').first()).toContainText('Customers');
});

test('Copy SQL is enabled once the grid has loaded', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await expect(band(page, 'data').getByRole('row')).toHaveCount(202);
  await band(page, 'data').getByText('Export').click();
  await expect(page.getByRole('menuitem', { name: 'Copy SQL' })).toBeEnabled();
  await page.getByRole('menuitem', { name: 'Copy SQL' }).click();
  await expect(page.getByText('SQL copied.', { exact: false })).toBeVisible();
});
```

If `dragTo` does not cross 5 px of movement in steps, replace it with `hover()` on the source, `page.mouse.down()`, `page.mouse.move(x, y, { steps: 10 })` to the target's centre, then `page.mouse.up()`.

- [ ] **Step 2: Run e2e**

Run: `npm run e2e -- e2e/main-mart.spec.ts`
Expected: PASS. Then run all e2e: `npm run e2e`. Expected: PASS. Fix any older e2e spec that relied on a click replacing the main mart by switching it to the make-main button.

- [ ] **Step 3: Full unit suite**

Run: `npm test`
Expected: PASS (the config caps workers at 4).

- [ ] **Step 4: README**

In `README.md`:

1. Replace the "Several data marts, one main" paragraph's sentence "click one it cannot join and it becomes the selected data mart on its own" with: "A data mart it cannot join shows dimmed in a search, and a click on it explains instead of switching. To make another data mart the main one, drag its card onto the main card, or use its Make main data mart button. Its own columns come first, and the old main stays as a joined mart when the new one can join it."
2. In "See what it joins to", add: "With a main data mart selected, the band lists every data mart it can join, at any depth, with the main one first. Hover a card to see the data marts it relates to that are not in the band, drawn dashed."
3. In "Fields from joined data marts", add: "A data mart reachable by several paths joins through the data mart in use that is closest to the main one."
4. In "Take it to a sheet, or to an AI", add: "Copy SQL, the last item, copies the SQL of the grid's last query (with its page LIMIT), read from that query's run in OWOX. It is disabled, with the reason, until OWOX has the SQL."

- [ ] **Step 5: Commit**

```bash
git add e2e/main-mart.spec.ts README.md
git commit -m "E2E for dragging a card onto the main one and for Copy SQL; README covers the main mart, ghosts, join paths and Copy SQL

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
