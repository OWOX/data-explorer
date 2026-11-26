# Rudiments cleanup implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete dead code and leftovers of earlier designs from the plugin, merge duplicated code, and fix the four bugs the review found, without changing what a member sees except where a task says so.

**Architecture:** Sixteen tasks, ordered so that each one leaves the test suite, the linter and the build green. Tasks 1 and 2 fix bugs. Tasks 3 to 14 delete and merge. Task 15 moves the last two Radix Popover uses and the Export menu onto the existing `Panel`. Task 16 sweeps needless `export` keywords and the docs, last, because earlier tasks change which exports are needed.

**Tech stack:** React 19, TypeScript 6, Vite 8, Tailwind 4, Vitest 5, Playwright, `@owox/plugin-sdk` 0.45.

**Spec:** None. The plan implements the code review of 2026-11-25. Every finding is restated inside the task that fixes it.

## Global constraints

1. Work on branch `refactor/rudiments`, in the worktree `.claude/worktrees/rudiments`, created from `chore/drop-github-pages` (commit `ecea73f`).
2. Run Vitest with `--maxWorkers=4`. Never run it unbounded. Run Playwright only through `npm run e2e` (one worker).
3. A task is done when all four pass: `npx vitest run --maxWorkers=4`, `npm run lint`, `npm run build`, and the e2e specs the task names.
4. No behaviour change unless the task has a "Behaviour change" line. When a test fails after a deletion, first check whether the test exercised the deleted code. Rewrite or delete that test. Do not restore the code.
5. Add no dependency. Tasks 4 and 15 remove one each.
6. Do not rewrite existing comments to change their style. Delete a comment only when the task names it.
7. New prose (comments, README, commit messages) follows `~/.claude-owox.com-personal/skills/unslop/SKILL.md`. No em dashes.
8. Line numbers are those of commit `ecea73f`. Earlier tasks shift them, so locate code by the identifier named, and use the line number as a hint.
9. One commit per task, message as given.
10. Left out on purpose: replacing the hand-rolled search and model calls with the SDK's `search.query` and `getDataMarts`. The SDK validates a response all or nothing, so one odd item would fail a whole search.

## Review focus

1. A grid cell whose text starts with `=`, `+`, `-` or `@` is copied with Ctrl+C. A person expects it to paste as text, not as a live formula. Test in task 2.
2. A chart settings document saved before this change (it has `version: 2`) is opened after it. A person expects their charts, not the defaults. Test in task 8.
3. A grid-columns document saved before this change (it has an `at` field) is opened after it. A person expects their columns and saved view. Test in task 8.
4. The host cannot tell the plugin its origin, so `ctx.ui.link` returns `undefined`. A person expects the "Open in OWOX" link to still open the data mart. Test in task 9.
5. A drag is ended with Escape, then the mouse button is released over a card. A person expects the card not to toggle, in the Grid and in the Graph. Test in task 12.

---

### Task 1: CSS and hint bugs

**Files:**
- Modify: `src/ui/bands/bands.css` (lines 246, 348, 361-364, 608, 748-756, 824)
- Modify: `src/ui/bands/cards.tsx` (`TONE_CLASS`, about line 316)
- Modify: `src/ui/explorer/badgeReserve.tsx:36`
- Modify: `src/ui/explorer/RecordView.tsx:71`, `src/ui/explorer/MartGrid.tsx:1008`
- Modify: `src/ui/bands/LoadingBands.tsx:11,13`, `src/ui/bands/CardBands.tsx:453`, `src/ui/bands/RowBand.tsx:31`
- Test: `src/ui/bands/look-rules.test.tsx`

**Interfaces:**
- Produces: CSS class `dm-loadbar` (the 2 px loading bar), CSS class `dm-badge-row` (the grid title's badge row), exported constants `MARTS_HINT` from `CardBands.tsx` and `ROW_HINT` from `RowBand.tsx`.

Four defects:
1. `var(--ring)` and `var(--accent-foreground)` are never defined, so the focus outline of `.dm-seg button` and `.dm-make-main` computes to nothing.
2. `.dm-progress` is both a tone colour (line 348) and the absolute loading bar (lines 361-364). A card's "in progress" mark picks up the bar's positioning.
3. `.dm-badges` is declared for the card badge row (line 246) and again for the grid title's `BadgeRow` (line 824). The second rule also lands on cards.
4. `LoadingBands.tsx` retypes the Data Marts and Row band hints, and both have drifted from the real bands.

- [ ] **Step 1: Write the failing tests**

Add to `src/ui/bands/look-rules.test.tsx`, reusing that file's existing `rules()` helper that reads `bands.css`:

```ts
it('uses only custom properties the theme defines', () => {
  const theme = readFileSync(resolve(__dirname, '../../styles.css'), 'utf8');
  const css = readFileSync(resolve(__dirname, 'bands.css'), 'utf8');
  const used = new Set([...css.matchAll(/var\((--[a-z-]+)/g)].map((m) => m[1]!));
  const defined = new Set([...`${theme}\n${css}`.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]!));
  const missing = [...used].filter((v) => !defined.has(v) && !v.startsWith('--radix-') && !v.startsWith('--tw-'));
  expect(missing).toEqual([]);
});

it('keeps the loading bar and the progress tone apart', () => {
  const css = readFileSync(resolve(__dirname, 'bands.css'), 'utf8');
  expect(css.match(/^\.dm-progress\s*\{/gm)).toHaveLength(1);
  expect(css).toMatch(/^\.dm-loadbar\s*\{[^}]*position:\s*absolute/m);
  expect(css.match(/^\.dm-badges\s*\{/gm)).toHaveLength(1);
});
```

If the file has no `readFileSync` and `resolve` imports, add `import { readFileSync } from 'node:fs'; import { resolve } from 'node:path';`.

- [ ] **Step 2: Run the tests and see them fail**

Run: `npx vitest run src/ui/bands/look-rules.test.tsx --maxWorkers=4`
Expected: both new tests fail. The first lists `--ring` and `--accent-foreground`. If it lists any other name, that name is also undefined: replace it with the nearest defined token and say so in the commit body.

- [ ] **Step 3: Fix the CSS**

1. In `bands.css` lines 608, 749 and 756 replace `var(--ring)` with `var(--primary)`.
2. In lines 748 and 755 replace `var(--accent-foreground)` with `var(--foreground)`.
3. In lines 361-364 rename the selector `.dm-progress` to `.dm-loadbar` (the rule, its `::before`, and the reduced-motion rule). Keep the `@keyframes dm-progress` name.
4. In `RecordView.tsx:71` and `MartGrid.tsx:1008` change `className="dm-progress"` to `className="dm-loadbar"`.
5. Rename the second `.dm-badges` rule (line 824) to `.dm-badge-row`, and in `badgeReserve.tsx:36` change the class `BadgeRow` renders from `dm-badges` to `dm-badge-row`. Grep `dm-badges` in `src` and `e2e` and update any test that selects the grid title's badge row.

- [ ] **Step 4: Share the band hints**

In `CardBands.tsx` and `RowBand.tsx`, lift the hint string each band passes to `Band` into an exported constant (`MARTS_HINT`, `ROW_HINT`), and import both in `LoadingBands.tsx` in place of its retyped strings. The real bands' wording wins.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/smoke.spec.ts e2e/marts-grid.spec.ts`
Expected: all pass. Fix any test that selected `.dm-progress` as the loading bar.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Fix undefined CSS tokens and two class names with two meanings"
```

**Behaviour change:** `.dm-seg` buttons and `.dm-make-main` now show a focus outline. A card's in-progress mark is no longer absolutely positioned.

---

### Task 2: One TSV encoder

**Files:**
- Modify: `src/export/tsv.ts:18`
- Modify: `src/ui/explorer/copySelection.ts:20-23`
- Test: `src/ui/explorer/copySelection.test.ts`, `src/export/tsv.test.ts`

**Interfaces:**
- Produces: `export const tsvField: (s: string) => string` from `src/export/tsv.ts`.

`copySelection.ts` has its own `tsvField`, which quotes but has no formula guard. `export/tsv.ts` has `field`, which flattens tabs and line breaks, guards formulas and quotes.

- [ ] **Step 1: Write the failing test**

Add to `src/ui/explorer/copySelection.test.ts`:

```ts
it('guards a cell a spreadsheet would run as a formula', () => {
  const tsv = selectionTsv({ kind: 'cell', row: 0, col: 0, to: { row: 0, col: 1 } }, { rows: 1, cols: 2 }, { cell: (_r, c) => ['=HYPERLINK("x")', '-12.5'][c]!, header: () => '' });
  expect(tsv).toBe(`"'=HYPERLINK(""x"")"\t-12.5`);
});

it('flattens a line break, as Copy as TSV does', () => {
  const tsv = selectionTsv({ kind: 'cell', row: 0, col: 0 }, { rows: 1, cols: 1 }, { cell: () => 'a\nb\tc', header: () => '' });
  expect(tsv).toBe('a b c');
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/ui/explorer/copySelection.test.ts --maxWorkers=4`
Expected: FAIL. The first test gets `"=HYPERLINK(""x"")"` with no apostrophe.

- [ ] **Step 3: Share the encoder**

In `src/export/tsv.ts` replace line 18:

```ts
/** One value as a TSV field: tabs and line breaks become spaces, a formula start gets a leading apostrophe, and a value with a quote is quoted. */
export const tsvField = (s: string) => quote(guard(clean(s)));
```

Rename the three other uses of `field(` in that file to `tsvField(`.

In `src/ui/explorer/copySelection.ts` delete the local `tsvField` and its doc comment, add `import { tsvField } from '../../export/tsv';`, and stop exporting `toTsv`:

```ts
const toTsv = (rows: string[][]): string => rows.map((r) => r.map(tsvField).join('\t')).join('\n');
```

- [ ] **Step 4: Update the old tests**

In `copySelection.test.ts`, tests that import `tsvField` or `toTsv` from `./copySelection` asserted the old quoting. Delete the ones that tested `toTsv` directly, and point the `tsvField` ones at `../../export/tsv` with the new expectations: a tab or line break becomes one space and is not quoted, a quote is doubled and the field quoted, `=1+1` becomes `'=1+1`, `-12.5` stays.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/grid-edit.spec.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Copy grid cells with the same TSV encoder as Copy as TSV"
```

**Behaviour change:** Ctrl+C from the grid now flattens tabs and line breaks to spaces and prefixes a formula start with an apostrophe.

---

### Task 3: Dead CSS and CSS-pinning tests

**Files:**
- Modify: `src/ui/bands/bands.css`, `src/styles.css`, `src/charts/charts.css`
- Modify: `src/ui/Popover.tsx:6-9`, `src/charts/svg/Sankey.tsx:53`
- Delete: `src/ui/bands/wave6-css.test.ts`
- Modify: `src/ui/bands/look-rules.test.tsx`, `src/ui/bands/page.test.tsx:540`

- [ ] **Step 1: Delete the dead rules in `bands.css`**

Before deleting each one, grep its class name in `src` and `e2e` (excluding `*.css`) and confirm no `.ts` or `.tsx` file outside tests builds it.

1. `.dm-gx` (lines 431-432).
2. `.dm-menu-group` (line 510).
3. `.dm-tip-plain` (line 148).
4. `.dm-badge-shrink` (lines 251-253). Also delete the assertion at `page.test.tsx:540` that the class is absent.
5. `.dm-popover-title` (lines 667-669). In `Popover.tsx` delete the second sentence of the doc comment, which mentions it.
6. `a.dm-mark` and `button.dm-mark` with their comment (lines 276-279).
7. The rule at line 518, `.dm-menu-row[role='menuitemradio'], [aria-checked] { padding-left: 16px }`. The base row already has 16 px.
8. The `box-shadow` at line 380 that repeats line 379.
9. The comment at lines 7-8 with no rule under it, and the comment at line 823 that points at `BADGE_REST`.
10. Merge the two `.dm-menu-editor` declarations (lines 464 and 466) into one rule.

- [ ] **Step 2: Clean `styles.css` and `charts.css`**

1. In `styles.css` delete `--color-success`, `--color-warning`, `--color-notice` (lines 17, 18, 20) and `--success`, `--notice` (lines 34, 37, 74, 77). First grep `src` for `text-success`, `bg-success`, `text-warning`, `bg-warning`, `text-notice`, `bg-notice`, `var(--success)`, `var(--notice)` and `var(--warning)`. Keep any token that has a user.
2. Merge the two `.dm-page-header-lead` declarations (lines 121 and 123).
3. In `charts.css` merge the three `.dm-chart` rules (lines 42, 45, 52) into one, and merge `.dm-chart-axis-title` (line 70) into the `.dm-chart-text` rule (line 69) as `.dm-chart-text, .dm-chart-axis-title { ... }`. Keep both class names.
4. Delete `.dm-sankey-link:focus-visible` (`charts.css:89`) and the `onFocus` and `onBlur` handlers in `hoverLink` at `Sankey.tsx:53`. Ribbons have no `tabIndex`, so they never take focus.

- [ ] **Step 3: Fold `wave6-css.test.ts` into `look-rules.test.tsx`**

1. Move into `look-rules.test.tsx` every `wave6-css.test.ts` assertion that a rule exists (`toMatch`). Use the `rules()` helper already in `look-rules.test.tsx`.
2. Drop every assertion that a rule is absent (`not.toMatch`).
3. Delete `wave6-css.test.ts`.

- [ ] **Step 4: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e`
Expected: all pass. The full e2e run is the check that no deleted rule was in use.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Delete unused CSS rules and tokens"
```

---

### Task 4: Drop TanStack Table

**Files:**
- Modify: `src/ui/explorer/MartGrid.tsx` (lines 1, 201-207, 627, 638, 695, 796-838, 997, 1042-1060)
- Modify: `src/ui/explorer/ColumnMenu.tsx:52-63`
- Modify: `package.json`, `package-lock.json`
- Test: existing `src/ui/explorer/*.test.tsx`

**Interfaces:**
- Produces: `ColumnMenuEnv` gains `toggleSort: (key: string) => void` (use the exact type `GridEnv` declares for it today) and its `removeUnique`, `sortable` and `valuesFor` become required.

`MartGrid` uses the library only for `table.getHeaderGroups()` (one group) and `table.getRowModel().rows` (`r.original`, `r.id` is the row index).

- [ ] **Step 1: Replace the table with plain maps**

1. Delete the import on line 1, and `features`, `GridColumn`, the `columns` memo and `const table = useTable(...)`.
2. Header: replace `table.getHeaderGroups().map((hg) => <tr ...>{hg.headers.map(...)}</tr>)` with one `<tr>` that maps `columnViews` in order. Keep each `HeaderCell`'s props and its `key` (the output key).
3. Body: replace `table.getRowModel().rows.map((r, ri) => <GridRow key={r.id} row={r.original} ... />)` with `(rows ?? []).map((row, ri) => <GridRow key={ri} row={row} ri={ri} columns={columnViews} marks={marksOf(ri)} acts={rowActs} clickable={clickable} />)`.
4. Delete `columnByKey` if nothing else reads it after this.
5. Delete the comment at line 201 ("components above").

- [ ] **Step 2: Merge `GridEnv` into `ColumnMenuEnv`**

1. Add `toggleSort` to the `ColumnMenuEnv` type in `ColumnMenu.tsx` and to the `menuEnv` object in `MartGrid.tsx` (lines 796-838).
2. In `HeaderCell` and `SortTitle`, read `sorts`, `toggleSort` and `sortable` from the `ColumnMenuEnv` context. Delete the `GridEnv` context, its provider at line 997 and its value at line 638.
3. In `ColumnMenu.tsx:52-56` make `removeUnique`, `sortable` and `valuesFor` required. Remove the `?.` and `!== false` guards that covered their absence. Give the default context object at lines 60-63 no-op values for them.

- [ ] **Step 3: Remove the dependency**

Run: `npm uninstall @tanstack/react-table`
Expected: `package.json` and `package-lock.json` no longer name it. `grep -rn "tanstack" src` prints nothing.

- [ ] **Step 4: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/grid-edit.spec.ts e2e/grid-drag.spec.ts e2e/menu-apply.spec.ts e2e/smoke.spec.ts`
Expected: all pass. `selection-renders.test.tsx` counts cell renders: if a count rises, `GridRow` or `BodyCell` lost a stable prop. Restore it with `useMemo`. Do not raise the expected count.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "Render the grid with plain maps and drop @tanstack/react-table"
```

---

### Task 5: State and join plan

**Files:**
- Modify: `src/state/join-plan.ts`, `src/state/join-tree.ts`, `src/state/store.tsx`, `src/state/view-link-resolve.ts`, `src/state/view-link.ts:227`
- Modify: `src/model/sort.ts`, `src/model/unique-count.ts:46`
- Modify: `src/ui/explorer/MartGrid.tsx:705`, `src/ui/bands/CardBands.tsx:248`, `src/search/report-load.ts:86-91`
- Test: `src/state/join-plan.test.ts`, `src/state/store.test.ts`, `src/state/view-link-resolve.test.ts`, `src/model/sort.test.ts`

**Interfaces:**
- Produces: `keptSorts(orig: Sort[] | null, kept: Sort[]): Sort[] | null` in `src/model/sort.ts`, where `Sort` is the element type `sortsOnColumns` already uses. `fieldsFor(sources, martId, shown, inUse?)` loses its `remembered` parameter.

- [ ] **Step 1: Write the failing test for `keptSorts`**

Add to `src/model/sort.test.ts`:

```ts
describe('keptSorts', () => {
  const a = { column: 'a', direction: 'asc' } as const;
  it('keeps null as null', () => expect(keptSorts(null, [])).toBeNull());
  it('turns a list that pruning emptied into null', () => expect(keptSorts([a], [])).toBeNull());
  it('keeps what is left', () => expect(keptSorts([a], [a])).toEqual([a]));
  it('keeps an empty list that was empty', () => expect(keptSorts([], [])).toEqual([]));
});
```

Match the object shape to the sort type in `src/model/sort.ts` if its field names differ.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run src/model/sort.test.ts --maxWorkers=4`
Expected: FAIL, `keptSorts` is not exported.

- [ ] **Step 3: Implement `keptSorts` and use it**

```ts
/** The sorts left after pruning: a list that pruning emptied is no sort at all (null), so the default order applies. */
export const keptSorts = <S>(orig: readonly S[] | null, kept: S[]): S[] | null => (orig === null || (orig.length > 0 && kept.length === 0) ? null : kept);
```

Replace the five hand-written copies of this rule with a call: `join-plan.ts:155` (`refitRules`), `:295` (`planClick`), `:409` (`planRejoin`), `model/unique-count.ts:46` (`dropUniqueSorts`), `view-link-resolve.ts:51` (`pruneGrid`). Read each site first. If a site's rule differs from the helper for some input, keep that site as it is and say so in the commit body.

- [ ] **Step 4: Cut `fieldsFor`**

```ts
/** The fields a joined mart comes back with: what it showed when it last left a grid (`shown`, its own field names) that the source still offers, in that order, else its default fields. */
export function fieldsFor(sources: JoinedSource[], martId: string, shown: string[], inUse?: Set<string>): string[] {
  const source = sourceOfMart(sources, martId, inUse);
  if (!source) return [];
  const byOwn = new Map(source.fields.map((f) => [ownNameOf(f), f.name] as const));
  const mapped = shown.flatMap((n) => (byOwn.has(n) ? [byOwn.get(n)!] : []));
  return mapped.length ? mapped : defaultJoinFields(source).map((f) => f.name);
}
```

1. Update the two callers (`planClick` about line 288, `planMakeMain` about line 339) to the new argument list.
2. Delete `nextPicks` in `planClick` if nothing else reads it, and `namesOf` if it has no other caller.
3. In `join-plan.test.ts` delete the tests at lines 30-32 that pass `remembered`, and keep or add one test for each remaining branch: shown fields the source offers, shown fields it does not offer (defaults), unknown mart (empty list).

- [ ] **Step 5: Make the always-set optionals required**

1. `PlanEnv.lastShownOf` and `PlanEnv.ownNames` (`join-plan.ts:222,224`): required. Delete `noShown` (line 227) and the `?? noShown` and `?.() ?? []` guards at lines 252, 270, 334. Give the test envs in `join-plan.test.ts` both members.
2. `Entry.seq` (`store.tsx:28`): required. Simplify `seq !== undefined ? ... : ...` at line 107 and drop `?? -1` at line 189. Give test entries a `seq`.
3. `known` on `undo` and `redo` (`store.tsx:63-64`): required. `!known || known(entry)` at lines 99 and 104 becomes `known(entry)`. Update tests that dispatch without it to pass `() => true`.

- [ ] **Step 6: Remove the small duplicates**

1. `joinedPaths` (`join-plan.ts:25-33`): delete it. At `MartGrid.tsx:705` use `[...inUsePaths(cols, sources)].filter(Boolean)`. Check the two give the same order with the existing `joinedPaths` tests before deleting them, then move those tests to assert the new expression or delete them.
2. `ghostSources` (`join-tree.ts:65-67`): delete it. At `CardBands.tsx:248` write `nodes.has(path) ? joinableUnder(...) : []` with the same arguments. In `ghostLevels` (line 81) call `joinableUnder` directly.
3. `plural` (`view-link-resolve.ts:136`): delete it and use `count` from `src/ui/format.ts` in `skippedMessage` (lines 144-149) and in `search/report-load.ts:86-91`. `count(n, noun)` adds the `s` itself, so pass the singular noun.
4. `view-link-resolve.ts:100`: `view.record && typeof view.record === 'object' && !Array.isArray(view.record)` becomes `view.record`.
5. Delete the inline comment at `view-link.ts:227` that repeats `decodeRule`'s doc, and the filename comment at `join-tree.ts:1`.

- [ ] **Step 7: Delete the custom-connector link shim**

Delete `view-link-resolve.ts:87-94`, the branch that maps a raw connector name in `src=` to the service key, and the test that covers it in `view-link-resolve.test.ts`.

- [ ] **Step 8: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/joined-apply.spec.ts e2e/card-drag.spec.ts e2e/main-mart.spec.ts`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Trim the join plan and the store to what production uses"
```

**Behaviour change:** A view link made between 16 and 19 November 2026 that selected a custom connector opens without that source selected. Counts of 1000 and more in the "skipped" notices gain a thousands separator.

---

### Task 6: Model, format and filter leftovers

**Files:**
- Modify: `src/model/guards.ts:8`, `src/model/field-category.ts:4-8,47`, `src/format/store.ts:18,51`, `src/format/formats.ts:51-53`, `src/format/useColumnFormats.ts:132`, `src/format/ai-pick.ts:72`
- Modify: `src/filters/valueSuggest.ts:7`, `src/api/row-counts.ts:11`, `src/sdk/mock/ctx.ts:174`, `src/export/tsv.ts:32`, `src/datamart/build-sql.ts:266,343,391`
- Modify: `src/ui/format.ts:98` and every importer of its `formatValue`
- Test: the matching `*.test.ts` files

**Interfaces:**
- Produces: `rawText(v: unknown): string` in `src/ui/format.ts`, the new name of that file's `formatValue`. `setProject(ctx, martId, picks)` without an options argument (keep its other parameters as they are today).

- [ ] **Step 1: Delete `own` in `guards.ts` if it is dead**

Run: `grep -rn "import.*\bown\b.*guards" src`
If only `guards.test.ts` imports it, delete the function and its test. `src/ui/bands/relationshipNote.ts:29` calls an `own` too: check where that one comes from. If it imports the one in `guards.ts`, leave both alone and skip this step.

- [ ] **Step 2: Simplify the format store**

1. `setProject` (`format/store.ts:18,51`): drop the `opts.keep` parameter and always keep existing picks (the `keep: true` behaviour). Drop the `{ keep: true }` argument at `ai-pick.ts:72`. Delete the tests of the overwrite branch at `store.test.ts:17-18,38` and `ai-pick.test.ts:70`.
2. `resolveFormat` (`formats.ts:51-53`): delete it and write `member ?? project ?? AUTO` at `useColumnFormats.ts:132`. Delete its test.

- [ ] **Step 3: Rename the raw `formatValue`**

`src/ui/format.ts:98` and `src/format/formats.ts:68` both export a `formatValue`, with different meanings. Rename the one in `src/ui/format.ts` to `rawText` and update every import of it. Find them with `grep -rn "formatValue" src | grep "ui/format'"` and check relative paths such as `'../format'` inside `src/ui`. Leave the one in `src/format/formats.ts` alone.

- [ ] **Step 4: Use the existing constants**

1. `filters/valueSuggest.ts:7`: delete `COUNT_KEY` and use `uniqueKey('')` from `src/model/unique-count.ts`. Do the same for the `'Unique Count'` literal at `api/row-counts.ts:11` and `sdk/mock/ctx.ts:174`.
2. `export/tsv.ts:32`: `agg ?? { aggregations: [], dateTrunc: [] }` becomes `agg ?? NO_AGGREGATION` (import from `src/model/aggregation.ts`).
3. `model/field-category.ts`: declare `INTEGER` first, then a `DECIMAL` set with the remaining entries of today's `NUMBER`, then `const NUMBER = new Set([...INTEGER, ...DECIMAL]);`. The members of both sets must not change: add this test to `field-category.test.ts` before the edit and keep it green.

```ts
it('counts every integer type as a number', () => {
  for (const t of ['INTEGER', 'INT64', 'BIGINT', 'SMALLINT', 'TINYINT']) expect(fieldCategory({ name: 'n', type: t } as never)).toBe('number');
});
```

Use the category function and field shape the file's existing tests use, and type names that are in today's `INTEGER` set.

- [ ] **Step 5: Drop the guards the types rule out**

In `datamart/build-sql.ts`: `parentPath(path) ?? ''` becomes `parentPath(path)` at lines 343 and 391, and `!shownNames.has(r.column)` at line 266 is removed (the list is already filtered by `keepVisible`). The golden test `engine-parity.test.ts` must stay green without regenerating `engine-sql.json`.

- [ ] **Step 6: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Remove unused options and duplicate constants in model, format and filters"
```

---

### Task 7: Search and AI

**Files:**
- Modify: `src/search/ai.ts`, `src/search/decide.ts`, `src/search/intent.ts:67`, `src/search/steps/fields.ts:39`, `src/format/ai-pick.ts:65`
- Modify: `src/search/valueMatch.ts:28-31`, `src/search/endpoint.ts:8-9,56`, `src/search/report-load.ts:15`, `src/search/core.ts:43`, `src/search/steps/main.ts:38`, `src/search/steps/charts.ts`, `src/ui/bands/useSmartSearch.ts:10`
- Delete: `src/search/chartCandidates.ts` (moved into `steps/charts.ts`), `src/search/chartCandidates.test.ts` (moved)
- Modify: `src/sdk/mock/ai.ts:44,59`
- Test: `src/search/ai.test.ts`, `src/search/decide.test.ts`, the moved tests

**Interfaces:**
- Produces, in `src/search/ai.ts`:
  - `raceAi<T>(signal: AbortSignal, ms: number, run: (abortSignal: AbortSignal) => Promise<T>): Promise<T>`
  - `askFast(model: AiModel, system: string, user: string, signal: AbortSignal, ms?: number): Promise<Record<string, unknown>>`
- Produces, in `src/search/core.ts`: `isHit(hits, martId: string): boolean`, with `hits` typed as the object both call sites pass.
- Removes: `createAiRun`, `Role`, `Models` stays.

- [ ] **Step 1: Write the failing tests**

Add to `src/search/ai.test.ts`:

```ts
describe('raceAi', () => {
  it('returns what the run resolves to', async () => {
    await expect(raceAi(new AbortController().signal, 1000, async () => 7)).resolves.toBe(7);
  });
  it('gives up after the time limit and aborts the run', async () => {
    vi.useFakeTimers();
    let aborted = false;
    const p = raceAi(new AbortController().signal, 50, (s) => new Promise<never>(() => { s.addEventListener('abort', () => { aborted = true; }); }));
    const seen = expect(p).rejects.toBeInstanceOf(AiUnavailable);
    await vi.advanceTimersByTimeAsync(60);
    await seen;
    expect(aborted).toBe(true);
    vi.useRealTimers();
  });
  it('gives up when the caller aborts', async () => {
    const ctl = new AbortController();
    const p = raceAi(ctl.signal, 1000, () => new Promise<never>(() => {}));
    ctl.abort();
    await expect(p).rejects.toBeInstanceOf(AiUnavailable);
  });
  it('wraps any other error', async () => {
    await expect(raceAi(new AbortController().signal, 1000, async () => { throw new Error('boom'); })).rejects.toBeInstanceOf(AiUnavailable);
  });
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run src/search/ai.test.ts --maxWorkers=4`
Expected: FAIL, `raceAi` is not exported.

- [ ] **Step 3: Implement `raceAi` and `askFast`**

In `src/search/ai.ts`, replace everything from the `Role` type to the end of the file with:

```ts
/** Runs one model call under a time limit and the caller's signal. Rejects with AiUnavailable on a timeout, an abort or any error, so a model that ignores its signal cannot hold the caller. */
export async function raceAi<T>(signal: AbortSignal, ms: number, run: (abortSignal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController();
  const stop = () => ctl.abort();
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) ctl.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unavailable = new Promise<never>((_, reject) => {
    if (ctl.signal.aborted) { reject(new AiUnavailable('aborted')); return; }
    timer = setTimeout(() => { ctl.abort(); reject(new AiUnavailable('timeout')); }, ms);
    ctl.signal.addEventListener('abort', () => reject(new AiUnavailable('aborted')), { once: true });
  });
  unavailable.catch(() => undefined);
  try {
    const pending = run(ctl.signal);
    pending.catch(() => undefined);
    return await Promise.race([pending, unavailable]);
  } catch (e) {
    throw e instanceof AiUnavailable ? e : new AiUnavailable(errorMessage(e));
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', stop);
  }
}

/** The fast model's JSON answer to one question; AiUnavailable for anything else. */
export function askFast(model: AiModel, system: string, user: string, signal: AbortSignal, ms = AI_TIMEOUT_MS): Promise<Record<string, unknown>> {
  return raceAi(signal, ms, async (abortSignal) => {
    // No output cap: a thinking model's reasoning counts toward it, and a small cap ends the answer before the JSON.
    const result = await model.doGenerate({
      prompt: [{ role: 'system', content: system }, { role: 'user', content: [{ type: 'text', text: user }] }],
      responseFormat: { type: 'json' },
      temperature: 0,
      abortSignal,
    });
    const text = result.content.flatMap((c) => (c.type === 'text' && typeof c.text === 'string' ? [c.text] : [])).join('');
    const json = extractJson(text);
    if (json === undefined) throw new AiUnavailable('no JSON in the answer');
    return json as Record<string, unknown>;
  });
}
```

Reword the `AI_TIMEOUT_MS` doc comment to: `/** A fast-model question waits this long; past it the caller goes on as if no AI were configured. */`

- [ ] **Step 4: Move the three callers to `askFast`**

1. `intent.ts:67` and `steps/fields.ts:39`: each builds `createAiRun(models, signal)` and calls `.ask(role, system, user)`. Replace with `askFast(models.fast, system, user, signal)`. Where `models.fast` may be undefined, throw `new AiUnavailable('no model')` first, as `ask` did.
2. `format/ai-pick.ts:65`: `askFast(models.fast, system, user, signal, AI_TIMEOUT_MS * 0.7)`.
3. If a caller passed a custom `totalMs` to `createAiRun`, pass it as `ms`.
4. Rewrite the `createAiRun` tests in `ai.test.ts` against `askFast`. Keep one test each for: a JSON answer, an answer with no JSON, a model error, a timeout.

- [ ] **Step 5: Use `raceAi` in `decide.ts`**

Inside `createDecide`, replace the body from `const ctl = new AbortController();` through the `finally` block with:

```ts
    return raceAi(signal, timeoutMs, async (abortSignal) => {
      const ask = async (qs: Record<string, Question>): Promise<Record<string, unknown>> => {
        // The SDK loads on the first question, so a member who never searches with AI does not download it.
        const decideFn = opts.decideFn ?? (await sdk()).experimental_decide;
        const result = await decideFn({ model, state: [{ type: 'text', text: JSON.stringify(state) }], questions: qs, abortSignal, maxRetries: 1 });
        return (result as { answers?: Record<string, unknown> }).answers ?? {};
      };
      let answers: Record<string, unknown>;
      let asked = questions;
      try {
        answers = await ask(asked);
      } catch (e) {
        if (!(await sdk()).Experimental_DecisionRefusalError.isInstance(e)) throw e;
        // The provider refused some questions: answer around them, once.
        const refused = new Set((e as { questionIds: string[] }).questionIds);
        asked = Object.fromEntries(ids.filter((id) => !refused.has(id)).map((id) => [id, questions[id]!]));
        answers = Object.keys(asked).length ? await ask(asked) : {};
      }
      return Object.fromEntries(ids.map((id) => [id, id in asked ? checked(questions[id]!, answers[id]) : undefined]));
    });
```

Keep the three early returns above it (`!ids.length`, too many questions, `signal.aborted`). Import `raceAi` from `./ai`. `decide.test.ts` must pass unchanged.

- [ ] **Step 6: Delete the boolean question type**

1. `decide.ts`: remove the `{ type: 'boolean'; probability: number }` variant of `Answer`, the `q.type === 'boolean'` line in `checked`, the `probability?: unknown` member of its cast, and `a.type !== 'boolean' &&` in `sortedProbs`.
2. `sdk/mock/ai.ts`: remove `'boolean'` from `supportedQuestionTypes` (line 44) and the boolean answer (line 59).
3. Delete `MAX_OPTIONS` (`decide.ts:15`). It has no reference.

- [ ] **Step 7: Small deletions**

1. `valueMatch.ts:28-31`: delete `matchValue` and its tests.
2. `endpoint.ts:8-9`: delete `export { MAX_FOUND }` and import `MAX_FOUND` from `../config` in `endpoint.test.ts`.
3. `endpoint.ts:56`: drop the `entityType === undefined ||` half of the condition. Give any test fixture without `entityType` the value `'DATA_MART'`.
4. `report-load.ts:15`: delete `export type { ReportDto }` and import the type from `../../sdk/types` in `useSmartSearch.ts:10`.
5. `core.ts:43` and `steps/main.ts:38` both write `hits.marts.includes(id) || hits.reports.some((r) => r.martId === id)`. Export `isHit(hits, id)` from `core.ts` and call it in both.
6. Move the contents of `chartCandidates.ts` into `steps/charts.ts`, delete the re-export at `steps/charts.ts:9`, and move `chartCandidates.test.ts`'s tests into `steps/charts.test.ts`. If anything outside `steps/charts.ts` imports from `chartCandidates`, point it at `steps/charts`.
7. Delete the filename header comments at line 1 of `core.ts`, `valueMatch.ts`, `steps/main.ts`, `steps/shape.ts`.
8. `ai.ts` `pickModels`: `ai?.fast ?? (ai && typeof ai.doGenerate === 'function' ? ai : undefined)` becomes `ai?.fast`. `pipelineReady`: read `m.decision.supportedQuestionTypes` directly and return `types.includes('choice') && types.includes('score')`. Update `ai.test.ts:29`, which asserts the removed "lists none" case, to expect `false` for a model that lists neither type.

- [ ] **Step 8: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/smoke.spec.ts`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Share one AI time-limit helper and delete the unused boolean question"
```

---

### Task 8: API layer

**Files:**
- Modify: `src/api/exports.ts` (lines 110-121, 161-165, 188-191, 355, 384-445), `src/api/run-sql.ts:2`, `src/model/guards.ts`
- Modify: `src/api/rows.ts:5,24`, `src/api/grid-columns.ts:17,182`, `src/sdk/mock/key-shown.ts:6`
- Modify: `src/api/blendable.ts:26-28,95`, `src/charts/ChartsBody.tsx:56,72`, `src/sdk/types.ts:133`
- Modify: `src/api/chart-settings.ts:49-53`, `src/charts/settings.ts:24,41-42`, `src/ui/explorer/MartGrid.tsx:656`
- Test: `src/api/exports.test.ts`, `src/api/rows.test.ts`, `src/api/grid-columns.test.ts`, `src/api/chart-settings.test.ts`

**Interfaces:**
- Produces: `isNotFound(e: unknown): boolean` exported from `src/model/guards.ts` (moved from `exports.ts`). `ChartSettings` without `version`.

- [ ] **Step 1: Write the tests for old stored documents**

Add to `src/api/chart-settings.test.ts`, using that file's existing way to seed a stored document and read it back:

```ts
const pie = { id: 'a', kind: 'pie' as const, measure: 'amount' };
const loadDoc = (doc: unknown) => createChartSettings(ctxWith(async () => ({ document: doc }), async () => {})).load('M');

test('a document saved with the old version marker keeps its charts and loses the marker', async () => {
  expect(await loadDoc({ version: 2, charts: [pie] })).toEqual({ charts: [pie] });
});

test('a document saved without the marker keeps its charts', async () => {
  expect(await loadDoc({ charts: [pie] })).toEqual({ charts: [pie] });
});
```

The existing test "a v1 document keeps its scorecards and drops its time series and pie" already pins the version 1 case. In the existing test "save does one put under the mart id and load reads it back", remove `version: 2 as const,` from `s` in step 3.

Add to `src/api/grid-columns.test.ts`:

```ts
test('a document saved with the old at field loads the same as one without it', async () => {
  const withAt = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: { columns: ['a', 'b'], at: 'x' } })), put: vi.fn() }));
  const without = createColumnStore(ctxWith({ get: vi.fn(async () => ({ document: { columns: ['a', 'b'] } })), put: vi.fn() }));
  expect(await withAt.load('m')).toEqual(await without.load('m'));
  expect(await without.load('m')).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/api/chart-settings.test.ts src/api/grid-columns.test.ts --maxWorkers=4`
Expected: both new chart-settings tests fail. The first still gets `version: 2` back, and the second gets `{}` because the reader requires `version === 2`. The grid-columns test passes and pins today's behaviour.

- [ ] **Step 3: Drop the chart settings version marker**

1. `chart-settings.ts:49-53`: the condition becomes `if (Array.isArray(d.charts))`, and the `out.version = 2` line and the comment about version 1 go. Replace the comment with: `// A document from before the charts list has no `charts` array: the defaults stand in.`
2. `charts/settings.ts:24`: remove `version?: 2;` from `ChartSettings`. Line 42: remove `version: 2,` from `editCharts` and the "Always version 2." sentence from its doc.
3. Remove `version: 2` from the writers at `ChartsBody.tsx:56` and `MartGrid.tsx:656`.

- [ ] **Step 4: Drop the write-only and test-only members**

1. `grid-columns.ts`: remove `at` from `ColumnsDoc` (line 17) and from the write at line 182. Remove it from the document built in `sdk/mock/key-shown.ts:6`.
2. `rows.ts`: remove `onChunk` from `ReadRowsHooks` (line 5) and its call (line 24). Delete the tests of it in `rows.test.ts`.
3. `exports.ts`: remove `onStage` from the argument type of `run` (line 355) and the `a.onStage?.(s)` call. Inside `execute`, the stage callback is then always present: change `onStage?.(...)` to `onStage(...)`. Rewrite the one test in `exports.test.ts` that passes `onStage` to follow the stage through `flight.subscribe`, as `useExportFlight.ts:47` does.

- [ ] **Step 5: Simplify the error readers**

1. `exports.ts:110-121`: `codeOf` and `isNotFound` read `payload` first and fall back to a top-level `code` or `status`. Remove the fallbacks. Before doing so run `grep -rn "status: 404\|code: '" src --include=*.ts --include=*.tsx` and confirm every thrown error in `src` (the mock included) carries `payload`. If one does not, fix that thrower to use `payload`.
2. Move `isNotFound` to `src/model/guards.ts` next to `errorMessage`, export it there, and import it from there in `exports.ts` and `run-sql.ts:2`.
3. `exports.ts:188-191`: reword the `parseDoc` comment to `// Only a string id and a string usedAt are kept: anything else in a stored entry is ignored.`

- [ ] **Step 6: Make the grain fields required**

1. `blendable.ts:26-28`: `mainGrainCollapse` and `mainGrainMultiplication` lose their `?`. `joinedSources` (line 95) already sets both.
2. `ChartsBody.tsx:72`: remove `?? 'collapses'`.
3. Keep the fallbacks inside `joinedSources` and `collapseOf` that read the backend response (`sdk/types.ts:133` stays optional): an older self-hosted backend may not send the fields.
4. Add the two fields to test fixtures the compiler flags.

- [ ] **Step 7: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/charts.spec.ts e2e/chart-list.spec.ts e2e/smoke.spec.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Remove the chart settings version marker and unused API hooks"
```

**Behaviour change:** For the minutes of a deploy during which an old build is still open, that old build shows default charts for a document saved by the new build.

---

### Task 9: SDK context

**Files:**
- Modify: `src/sdk/types.ts:2,188-196`, `src/sdk/connect.ts`, `src/sdk/mock/ctx.ts`, `src/sdk/mock/key-shown.ts`, `src/api/test-ctx.ts:17`
- Modify: `src/ui/App.tsx:216,235`, `src/ui/useViewLink.ts:31,88`, `src/search/ai.ts` (`pickModels`)
- Modify: `src/config.ts:1,10-12`, `src/ui/explorer/export/CreateMartDialog.tsx:13,80`, `src/datamart/create.ts:102`
- Test: `src/config.test.ts`, `src/sdk/mock/ctx.test.ts`

**Interfaces:**
- Produces, in `src/config.ts`:
  - `martAppPath(projectId: string, martId: string): string`, which returns `/ui/<project>/data-marts/<mart>/overview`
  - `martAppUrl(ctx: Pick<Ctx, 'projectId' | 'ui'>, martId: string): string`
- `Ctx.ui` gains `link(path: string): { href: string } | undefined`. `Ctx.ui.copyLink`, `Ctx.ui.setRoute` and `Ctx.credentials` become required.
- `createMockCtx(fixtures, opts)` gains `opts.keyShown?: boolean`.

- [ ] **Step 1: Read the SDK types**

Read `node_modules/@owox/plugin-sdk/dist/index.d.ts` lines 30-95. Note the exact signature of `PluginUi.link` and its return type. If `link` does not exist or does not return an object with `href`, stop this task after step 4 and report it: steps 5 to 7 depend on it.

- [ ] **Step 2: Make the SDK 0.45 members required**

1. `sdk/types.ts`: in `Ctx`, `copyLink?(` becomes `copyLink(`, `setRoute?(` becomes `setRoute(`, and `credentials?:` becomes `credentials:`. Replace the `credentials` comment with: `/** Declared, installation-bound credentials. `ai` is absent until the project maintainer configures it. */`
2. Remove the guards: `App.tsx:216` (`&& ctx.ui.copyLink`), `useViewLink.ts:31` (`setRoute?.` becomes `setRoute`), `useViewLink.ts:88` (`copyLink!` becomes `copyLink`), and `ctx.credentials?.ai` in `pickModels` becomes `ctx.credentials.ai`.
3. `ctx.route` stays optional: it is the signal that the host has no page links.
4. Add `copyLink: async () => {}`, `setRoute: () => {}` and `credentials: {}` to `stubCtx` in `src/api/test-ctx.ts:17` and to every other test stub the compiler flags. The mock context in `sdk/mock/ctx.ts` gets the same if it lacks them.
5. `sdk/types.ts:2`: the comment points at `tmp/ref/packages_api-client_src_data-marts.ts`, which does not exist. Point it at `node_modules/@owox/api-client/dist/data-marts.d.ts`.

- [ ] **Step 3: Replace `_sdkFitsCtx` with a type-level check**

In `sdk/connect.ts` replace lines 24-26 with:

```ts
// Compile-time check only: fails to compile if the SDK context stops satisfying the members of Ctx the plugin uses.
type Sdk = Awaited<ReturnType<typeof connect>>;
type Used = Pick<Ctx, 'route' | 'credentials'> & { ui: Pick<Ctx['ui'], 'copyLink' | 'setRoute' | 'link'>; owox: Pick<Ctx['owox'], 'models' | 'destinations' | 'putJson' | 'deleteJson'> };
type Assert<T extends true> = T;
export type SdkFitsCtx = Assert<Sdk extends Used ? true : false>;
```

If `npm run build` reports `SdkFitsCtx` as unused, keep the `export`. If the check fails on `link`, the `Ctx.ui.link` type from step 5 does not match the SDK: fix the `Ctx` type, not the check.

- [ ] **Step 4: Parse the mock's URL parameters once**

Rewrite the mock branch of `bootContext`:

```ts
  const params = new URLSearchParams(location.search);
  if (params.has('mock')) {
    const { createMockCtx } = await import('./mock/ctx');
    const { demoFixtures } = await import('./mock/fixtures');
    const sheets = params.get('sheets');
    // ?latency=3000 slows every read, as a real API does (default 250 ms).
    const latency = Number(params.get('latency') ?? 250);
    // ?ai=0 is a project with no AI configured. ?keyshown opens the orders grid with its key column (the e2e specs about that column use it).
    return createMockCtx(demoFixtures({ sheets: sheets === '0' || sheets === '1' ? Number(sheets) as 0 | 1 : 2 }), { latencyMs: Number.isFinite(latency) ? Math.max(0, latency) : 250, ai: params.get('ai') !== '0', keyShown: params.has('keyshown') });
  }
```

In `sdk/mock/ctx.ts` add `keyShown?: boolean` to the options and, when it is set, do what `keyShown(ctx)` in `sdk/mock/key-shown.ts` does, inside `createMockCtx` before it returns. Delete `sdk/mock/key-shown.ts`. Add to `sdk/mock/ctx.test.ts`:

```ts
it('seeds the orders grid with its key column when asked', async () => {
  const ctx = createMockCtx(demoFixtures({ sheets: 2 }), { latencyMs: 0, ai: false, keyShown: true });
  const docs = await ctx.collections('grid-columns').list();
  expect(docs.length).toBe(1);
});
```

Adapt the collection read to the `CollectionLike` method the other tests in that file use, and assert the stored column list contains the key column `key-shown.ts` wrote.

- [ ] **Step 5: Write the failing test for the app link**

Replace the `martAppUrl` tests in `src/config.test.ts` with:

```ts
describe('martAppUrl', () => {
  const ui = (link: (p: string) => { href: string } | undefined) => ({ link }) as never;
  it('uses the host origin when the host knows it', () => {
    expect(martAppUrl({ projectId: 'p 1', ui: ui((p) => ({ href: `https://self.example${p}` })) }, 'm/1')).toBe('https://self.example/ui/p%201/data-marts/m%2F1/overview');
  });
  it('falls back to app.owox.com when the host origin is unknown', () => {
    expect(martAppUrl({ projectId: 'p', ui: ui(() => undefined) }, 'm')).toBe('https://app.owox.com/ui/p/data-marts/m/overview');
  });
});
```

Run: `npx vitest run src/config.test.ts --maxWorkers=4`
Expected: FAIL, `martAppUrl` takes two strings today.

- [ ] **Step 6: Implement it**

`src/config.ts` lines 1 and 10-12 become:

```ts
/** Where OWOX is when the host cannot say: the hosted app. */
const OWOX_APP_URL = 'https://app.owox.com';

export const martAppPath = (projectId: string, martId: string): string => `/ui/${encodeURIComponent(projectId)}/data-marts/${encodeURIComponent(martId)}/overview`;

/** A data mart's page in OWOX: on the host's own origin when the host knows it, else on app.owox.com. */
export function martAppUrl(ctx: Pick<Ctx, 'projectId' | 'ui'>, martId: string): string {
  const path = martAppPath(ctx.projectId, martId);
  return ctx.ui.link(path)?.href ?? `${OWOX_APP_URL}${path}`;
}
```

Add `import type { Ctx } from './sdk/types';`. Add `link(path: string): { href: string } | undefined;` to `Ctx.ui` in `sdk/types.ts` (use the SDK's exact return type if it has more members). Update the four callers (`App.tsx:235`, `CreateMartDialog.tsx:13,80`, `datamart/create.ts:102`) to pass `ctx`. Add `link: () => undefined` to the mock context and the test stubs.

- [ ] **Step 7: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/smoke.spec.ts e2e/grid-edit.spec.ts`
Expected: all pass. The two specs use `?keyshown`.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Require the SDK 0.45 context members and link to the host's own OWOX"
```

**Behaviour change:** On a self-hosted OWOX, "open in OWOX" links point at that installation.

---

### Task 10: Chart kinds and panels

**Files:**
- Modify: `src/charts/ChartPanel.tsx`, `src/charts/ChartsBody.tsx`, `src/charts/listMenu.ts`, `src/charts/menuGroups.ts`, `src/charts/fields.ts`, `src/charts/compact.ts`, `src/charts/useDateSeries.ts:14`, `src/charts/useTopValues.ts:26-27`, `src/charts/Scorecards.tsx:26,30,82`, `src/charts/ChartMenu.tsx:9`
- Modify: every file in `src/charts/kinds/`
- Test: `src/charts/chartChrome.test.tsx`, `src/charts/charts-body.test.tsx`, `src/charts/kinds/*.test.ts`, `src/charts/menuGroups.test.ts`

**Interfaces:**
- `ChartPanel` props change to:

```ts
{
  title: string; name: string; items: MenuItem[]; ready: boolean; width: string;
  loading: boolean; failed?: { error: unknown; retry: () => void } | null;
  /** True shows the standard empty text for `hasFilters`; a string shows that text. */
  empty?: boolean | string; hasFilters: boolean; note?: string; children: ReactNode;
}
```

- `PanelProps<R>` loses `spec` and gains `title: string`.
- Produces in `menuGroups.ts`: `metricItem(cf: ChartFields, measure: string, list: Measure[], onChange: (patch: Partial<ChartSpec>) => void): MenuItem`, `dimensionItem(cf: ChartFields, dimension: string, onChange: (patch: Partial<ChartSpec>) => void): MenuItem`, `BUCKET_OPTIONS`. Use the element types the kinds pass today in place of `Measure`.
- Produces in `compact.ts`: `tickText` (moved from `kinds/timeSeries.tsx`).

- [ ] **Step 1: Move the repeated panel wiring into `ChartPanel`**

All nine panels write `items={ready ? items : null}`, an `onRetry` fallback, and `empty={cond ? emptyText(hasFilters) : null}`. In `ChartPanel`:

```ts
const menu = ready ? items : null;
const error = failed?.error;
const emptyNote = empty === true ? emptyText(hasFilters) : empty || null;
```

Use `menu` where `items` was used, `emptyNote` where `empty` was, and render `<ErrorBox error={error} onRetry={failed!.retry} />` in the error branch. Import `emptyText` from where the kinds import it today. Delete the `extra` prop and `{extra}`. Then update each of the nine panels to pass `items`, `ready`, `failed`, `empty` and `hasFilters` straight through. A panel that today passes a custom string for `empty` keeps passing that string.

- [ ] **Step 2: Pass the title, drop `spec`**

1. `kinds/types.ts`: remove `spec: ChartSpec;` from `PanelProps` and add `title: string;`.
2. `ChartsBody.tsx:152`: stop passing `spec`, and pass the title already computed in `resolved` (lines 91-94).
3. `categoryBar.tsx:38`, `pie.tsx:45`, `heatmap.tsx:67-68`, `scatter.tsx:40`, `spread.tsx:44`, `sankey.tsx:100`: use the `title` prop in place of the rebuilt string. `timeSeries` and `line` keep building their own, because their titles depend on the loaded bucket.

- [ ] **Step 3: Remove the unknown-kind guards**

`KINDS` is `Record<ChartKind, ...>` and the loader drops unknown kinds. Remove `def &&`, `def?.` at `ChartsBody.tsx:81,92,93,151` and `?.label ?? spec.kind`, `?.icon ?? ChartColumn` at `listMenu.ts:54-55`, with the `ChartColumn` import if it becomes unused.

- [ ] **Step 4: One helper for "which mart is this on"**

`fields.ts:37` has `pathOf` and `fields.ts:40` has `measurePath`. Replace the copies with imports: `menuGroups.ts:9-10` (`pathOfField`, `pathOfMeasure`), `Scorecards.tsx:30` (`pathOfMeasure`), `Scorecards.tsx:82` (inline), `pie.tsx:23` (`sharesWhole` becomes `measurePath(m) === pathOf(dim)`). Confirm each copy computes the same thing before replacing it. Keep any that differs.

- [ ] **Step 5: Shared menu rows**

Add to `menuGroups.ts` the three helpers from the Interfaces block. Take the body of each from the first kind that builds the row today (`categoryBar.tsx:34` for Metric, `categoryBar.tsx:35` for Dimension, `timeSeries.tsx:34` for the bucket options) and replace the copies: Metric in `categoryBar`, `heatmap:64`, `pie:39`, `sankey:97`, `timeSeries` `dateMenu:35`. Dimension in `categoryBar`, `pie:40`, `scatter:35`, `spread:40`. Bucket options in `heatmap:63` and `timeSeries:34`. Where a kind's row differs (another label, another patch key), keep that kind's own row.

Add to `menuGroups.test.ts`:

```ts
it('builds the Metric row that patches the measure', () => {
  const picked: unknown[] = [];
  const item = metricItem(cf, measures[0]!.id, measures, (p) => picked.push(p));
  expect(item.label).toBe('Metric');
});
```

Use the `cf` and measure fixtures that file already builds, and assert on the `onChange` patch by invoking the row's first option the way the existing tests in that file invoke a radio row.

- [ ] **Step 6: Pie and category bar share a resolver**

`PieR` (`pie.tsx:20`) and `CategoryBarR` (`categoryBar.tsx:19`) have the same shape, and their `resolve`, `title`, `eligible` and `create` differ only in the measure list (`pieMeasures` or `measuresOf`). In `categoryBar.tsx` export:

```ts
export type MeasureByDimensionR = CategoryBarR;
export const measureByDimension = (listOf: (cf: ChartFields) => ReturnType<typeof measuresOf>) => ({ resolve, title, eligible, create });
```

where the four functions are today's `categoryBar` ones with `measuresOf(cf)` replaced by `listOf(cf)`. Build both kinds from it: `...measureByDimension(measuresOf)` in `categoryBar`, `...measureByDimension(pieMeasures)` in `pie`. Delete `PieR` and use `MeasureByDimensionR`. If the two kinds' functions differ in anything but the list, stop this step, leave both as they are, and note the difference in the commit body. Delete the unreferenced `BarR` (`bar.tsx`) and `RankedR` (`rankedBar.tsx`).

- [ ] **Step 7: Small leftovers**

1. `categoryBar.tsx:21`: delete `OTHER_X` and use `OTHER_KEY` from `blank.ts`.
2. `line.tsx:51`: the pick handler adds a stack filter when a series index arrives, and none ever does. It becomes `(x) => onFilter([bucketFilter(...)])` with today's `bucketFilter` arguments.
3. `timeSeries.tsx:59`: remove the `!shown[i]!.other` check. `BarChart` never passes an index for the Other series.
4. Move `tickText` from `timeSeries.tsx:26` to `compact.ts` and update its importers (`categoryBar`, `scatter`, `spread`, `line`, `timeSeries`, `timeSeries.test.ts`).
5. Delete the re-export of `OTHER_COLOR` and `seriesColor` at `timeSeries.tsx:22`. Delete `seriesColor` in `useDateSeries.ts:14` and use `slotColor` at its call sites.
6. `useTopValues.ts:26-27`: take `counter` in place of `cf`, and pass `cf.counter` at the three call sites (`categoryBar:26`, `pie:28`, `heatmap:29-30`).
7. `sankey.tsx:61`: delete `const off = idle;` and use `idle`. Lines 123 and 133 compute `pieMeasures(cf)` twice: compute it once.
8. Move the stranded doc comments to the declarations they describe: `listMenu.ts:10` belongs on `listItems` (line 41), `ChartMenu.tsx:9` belongs on `MenuGroup`. Delete the first of the two stacked doc blocks at `Scorecards.tsx:26`.

- [ ] **Step 8: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/charts.spec.ts e2e/chart-list.spec.ts e2e/sankey.spec.ts`
Expected: all pass. Update tests that render `ChartPanel` with the old props.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "Move repeated chart panel wiring into ChartPanel and shared menu rows"
```

---

### Task 11: Chart SVG components

**Files:**
- Create: `src/charts/svg/pick.ts`
- Modify: `src/charts/svg/BarChart.tsx`, `Heatmap.tsx`, `LineChart.tsx`, `PieChart.tsx`, `Sankey.tsx`, `Scatter.tsx`, `SpreadChart.tsx`, `BlankPattern.tsx`
- Modify: `src/charts/copyImage.ts:22-23,47,70,83,108`, `src/charts/sankeyLayout.ts:52,70`, `src/charts/sankeyFold.ts:63,70,102`
- Test: `src/charts/svg/charts.test.tsx`, `src/charts/svg/sankey.test.tsx`, `src/charts/copyImage.test.ts`, `src/charts/sankeyLayout.test.ts`

**Interfaces:**
- Produces: `pickProps(label: string, fn: () => void)` in `src/charts/svg/pick.ts`, `useBlankId(): string` in `src/charts/svg/BlankPattern.tsx`.

- [ ] **Step 1: Write the failing test**

Create `src/charts/svg/pick.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { pickProps } from './pick';

describe('pickProps', () => {
  it('makes a mark a labelled button', () => {
    const p = pickProps('Filter to Kyiv', () => {});
    expect(p.role).toBe('button');
    expect(p.tabIndex).toBe(0);
    expect(p['aria-label']).toBe('Filter to Kyiv');
  });
  it('picks on click, Enter and Space, and on no other key', () => {
    const fn = vi.fn();
    const p = pickProps('x', fn);
    p.onClick();
    p.onKeyDown({ key: 'Enter', preventDefault() {} } as never);
    p.onKeyDown({ key: ' ', preventDefault() {} } as never);
    p.onKeyDown({ key: 'a', preventDefault() {} } as never);
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

Run: `npx vitest run src/charts/svg/pick.test.ts --maxWorkers=4`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Implement `pickProps` from the existing `press`**

Read `press` in `BarChart.tsx:14` and the props object it feeds. Create `src/charts/svg/pick.ts`:

```ts
import type { KeyboardEvent } from 'react';

/** What makes an SVG mark a button that filters: role, tab stop, name, pointer cursor, and a pick on click, Enter or Space. */
export const pickProps = (label: string, fn: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  'aria-label': label,
  style: { cursor: 'pointer' },
  onClick: fn,
  onKeyDown: (e: KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } },
});
```

If `press` in `BarChart.tsx` handles keys differently (other keys, no `preventDefault`), copy its behaviour exactly and adjust the test. Replace the local `press` and the hand-built props object in `BarChart:14`, `Heatmap:16`, `LineChart:17`, `Sankey:13`, `Scatter:16`, `SpreadChart:14` and the inlined one in `PieChart:23` with `{...pickProps(label, fn)}`. Where a mark sets extra `style` keys, spread `pickProps` first and merge the style.

- [ ] **Step 3: `useBlankId`**

In `BlankPattern.tsx` add:

```ts
/** A document-unique id for a chart's blank-value pattern. */
export const useBlankId = () => `dm-blank-${useId().replace(/:/g, '')}`;
```

Use it in `BarChart:46`, `Heatmap:24`, `LineChart:29`, `PieChart:14`, `Sankey:29`, `Scatter:25`, `SpreadChart:19`, and remove the `useId` imports that become unused.

- [ ] **Step 4: Remove unused props and options**

1. `LineChart.tsx`: delete the `canPick` prop (lines 20, 22, 66), so `pickable` is `!!onPick`, and delete `seriesIndex?` from the `onPick` type.
2. `Heatmap.tsx`: delete the `canPickX` prop (lines 19, 21, 31).
3. `BarChart.tsx:33`: reword the `canPick` doc to `/** Whether a category can be picked: the Other bucket cannot. */`.
4. `BarChart.tsx:36,68`: make `stacked` required and add it to the tests in `svg/charts.test.tsx` that omit it (pass `series.length > 1`, the old default).
5. `Sankey.tsx`: make `columns` and `fit` required, and add them to tests that omit them.
6. `sankeyLayout.ts:52,70`: keep the `height` option. The layout tests depend on a fixed height.
7. `sankeyFold.ts:63,70,102`: remove `columnRows[i] ?? []`, `pairRows.slice(0, sums.length)` and `columnRows.slice(0, dims.length)` only if `sankey.tsx:83-84` slices both arrays to the same length for every call. If any test calls `foldColumn` or its siblings with unequal lengths, keep the guards.

- [ ] **Step 5: Sankey labels use `fitText`**

`Sankey.tsx` cuts labels by character count (`clip`, `CHAR_W`, `roomChars`, lines 12, 16, 49). Every other chart uses `fitText(text, px)` from `svg/fitText.ts`. Replace `clip(text, roomChars)` with `fitText(text, roomPx)` where `roomPx` is the pixel room `roomChars` was derived from, and delete `clip`, `CHAR_W` and `roomChars`. Update the `sankey.test.tsx` assertions on cut label text to the new cuts.

- [ ] **Step 6: `copyImage` leftovers**

1. Delete `swatchBorder` (lines 22-23), the field it fills (line 47) and the stroke branch (line 70). Legend swatches have no border.
2. Stop exporting `copyHtml` on its own (line 83). It stays reachable through `internals`. Point `copyImage.test.ts:54` at `internals.copyHtml`.

- [ ] **Step 7: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/charts.spec.ts e2e/sankey.spec.ts`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "Share pick props and the blank pattern id across the SVG charts"
```

**Behaviour change:** Sankey labels are cut by measured width, so some cut one or two characters earlier or later than before.

---

### Task 12: One press-drag hook

**Files:**
- Create: `src/ui/bands/usePressDrag.ts`, `src/ui/bands/usePressDrag.test.tsx`
- Delete: `src/ui/bands/useCardDrag.ts`, `src/ui/bands/useCanvasDrag.ts`, `src/ui/bands/useGridDrag.ts`
- Modify: `src/ui/bands/canvas-drag.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx:20,22,122`, `src/ui/bands/canvas-layout.ts:23,48`, `src/ui/outsidePress.ts`, `src/ui/explorer/ColumnDrag.tsx:68`, `src/ui/bands/useGhostChain.ts:33-34`, `src/ui/bands/useCardClick.ts:35,42`
- Test: `src/ui/bands/card-drag.test.tsx`, `src/ui/bands/canvas-drag.test.ts`, `src/ui/bands/canvas-layout.test.ts`, `src/ui/outsidePress.test.ts`

**Interfaces:**
- Produces, in `src/ui/outsidePress.ts`: `swallowNextClick(): void`.
- Produces, in `src/ui/bands/usePressDrag.ts`:

```ts
export type Press = { path: string; martId?: string };
export type PressDragOptions<D> = {
  /** The card a press landed on, or null when the target is not a draggable card. */
  pick: (target: Element) => Press | null;
  canDrag: (path: string) => boolean;
  /** Whether the pointer is where a release counts. */
  over: (e: PointerEvent, root: HTMLElement) => boolean;
  /** The drag state for one pointer move. */
  view: (press: Press, e: PointerEvent, inside: boolean, root: HTMLElement) => D;
  /** A release where it counts. */
  drop: (press: Press, e: PointerEvent, root: HTMLElement) => void;
};
export function usePressDrag<D>(root: RefObject<HTMLElement | null>, options: PressDragOptions<D>, active?: unknown): D | null;
```

- [ ] **Step 1: Write the failing tests**

Create `src/ui/bands/usePressDrag.test.tsx`:

```tsx
import { act, render } from '@testing-library/react';
import { useRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { usePressDrag, type PressDragOptions } from './usePressDrag';

const fire = (target: EventTarget, type: string, init: PointerEventInit) => act(() => { target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, ...init })); });

function Host({ options }: { options: PressDragOptions<{ x: number }> }) {
  const root = useRef<HTMLDivElement>(null);
  const drag = usePressDrag(root, options);
  return <div ref={root}><div data-card="a" onClick={() => clicked()} />{drag && <span data-testid="drag">{drag.x}</span>}</div>;
}
const clicked = vi.fn();
const options = (drop = vi.fn()): PressDragOptions<{ x: number }> => ({
  pick: (t) => (t.closest('[data-card]') ? { path: 'a' } : null),
  canDrag: () => true,
  over: () => true,
  view: (_p, e) => ({ x: e.clientX }),
  drop,
});

describe('usePressDrag', () => {
  it('keeps a press that moves under 5 px a click', () => {
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')!;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 3, clientY: 0 });
    fire(window, 'pointerup', { clientX: 3, clientY: 0 });
    expect(drop).not.toHaveBeenCalled();
  });
  it('drops after a move past 5 px', () => {
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')!;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 20, clientY: 0 });
    fire(window, 'pointerup', { clientX: 20, clientY: 0 });
    expect(drop).toHaveBeenCalledTimes(1);
  });
  it('does not drop or click after Escape ends the drag', () => {
    clicked.mockClear();
    const drop = vi.fn();
    const { container } = render(<Host options={options(drop)} />);
    const card = container.querySelector('[data-card]')! as HTMLElement;
    fire(card, 'pointerdown', { button: 0, clientX: 0, clientY: 0 });
    fire(window, 'pointermove', { buttons: 1, clientX: 20, clientY: 0 });
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    fire(window, 'pointerup', { clientX: 20, clientY: 0 });
    act(() => { card.click(); });
    expect(drop).not.toHaveBeenCalled();
    expect(clicked).not.toHaveBeenCalled();
  });
  it('ignores a press on a button inside a card', () => {
    const drop = vi.fn();
    const opts = options(drop);
    const { container } = render(<Host options={{ ...opts, pick: (t) => (t.closest('button') ? null : opts.pick(t)) }} />);
    expect(container.querySelector('[data-testid="drag"]')).toBeNull();
  });
});
```

If jsdom in this project has no `PointerEvent`, use the polyfill or helper `card-drag.test.tsx` already uses to fire pointer events.

Run: `npx vitest run src/ui/bands/usePressDrag.test.tsx --maxWorkers=4`
Expected: FAIL, the module does not exist.

- [ ] **Step 2: Move `swallowNextClick` to `outsidePress.ts`**

Add to `src/ui/outsidePress.ts`, next to `swallowPress`:

```ts
/** Swallows the click the browser sends after a drag's release, so it does not also act on what is under the pointer. Only the click: mousedown and mouseup pass. */
export function swallowNextClick(): void {
  const swallow = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault(); };
  window.addEventListener('click', swallow, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
}
```

Replace the local copy in `ColumnDrag.tsx:68` with an import. Do not replace it with `swallowPress`, which also swallows mousedown and mouseup.

- [ ] **Step 3: Write `usePressDrag`**

Create `src/ui/bands/usePressDrag.ts` from `useCanvasDrag.ts`, with the five places the two hooks differ replaced by the options:

```ts
import { useEffect, useState, type RefObject } from 'react';
import { swallowNextClick } from '../outsidePress';
import { useLatest } from '../useLatest';

export type Press = { path: string; martId?: string };
export type PressDragOptions<D> = {
  /** The card a press landed on, or null when the target is not a draggable card. */
  pick: (target: Element) => Press | null;
  canDrag: (path: string) => boolean;
  /** Whether the pointer is where a release counts. */
  over: (e: PointerEvent, root: HTMLElement) => boolean;
  /** The drag state for one pointer move. */
  view: (press: Press, e: PointerEvent, inside: boolean, root: HTMLElement) => D;
  /** A release where it counts. */
  drop: (press: Press, e: PointerEvent, root: HTMLElement) => void;
};

/** A press becomes a drag once the pointer has moved this far, so a click stays a click. */
const START_PX = 5;

/**
 * Dragging a card. A press on a card (not on its buttons, links, inputs or a ghost) becomes a drag past 5 px; a release where `over` says it
 * counts calls `drop`. A release elsewhere, Escape or a cancelled pointer end the drag with no change. The click the browser sends after a
 * drag is swallowed. `active` re-attaches the listeners when the root element appears later.
 */
export function usePressDrag<D>(root: RefObject<HTMLElement | null>, options: PressDragOptions<D>, active: unknown = null): D | null {
  const [drag, setDrag] = useState<D | null>(null);
  const latest = useLatest(options);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let press: (Press & { x: number; y: number }) | null = null;
    let dragging = false;
    // Escape ended a drag: the release that follows still gets its click swallowed, and does nothing else.
    let cancelled = false;
    // The move work (measuring, a re-render) runs once per animation frame, with the latest pointer.
    let frame = 0;
    let latestMove: PointerEvent | null = null;
    const end = () => { cancelAnimationFrame(frame); frame = 0; latestMove = null; press = null; dragging = false; setDrag(null); };
    const flush = () => {
      frame = 0;
      const e = latestMove;
      if (e && press) setDrag(latest.current.view(press, e, latest.current.over(e, el), el));
    };
    const down = (e: PointerEvent) => {
      cancelled = false;
      if (e.button !== 0) return;
      const t = e.target instanceof Element ? e.target : null;
      if (!t || t.closest('button, a, input, [data-ghost]')) return;
      const picked = latest.current.pick(t);
      if (!picked || !latest.current.canDrag(picked.path)) return;
      dragging = false;
      press = { ...picked, x: e.clientX, y: e.clientY };
    };
    const move = (e: PointerEvent) => {
      // A move with no button down means the release was lost: forget a pending swallow.
      if (!(e.buttons & 1)) cancelled = false;
      if (!press) return;
      // The release happened out of our sight: let go of the drag.
      if (!(e.buttons & 1)) { end(); return; }
      if (!dragging && Math.hypot(e.clientX - press.x, e.clientY - press.y) < START_PX) return;
      dragging = true;
      e.preventDefault();
      latestMove = e;
      frame ||= requestAnimationFrame(flush);
    };
    const up = (e: PointerEvent) => {
      if (cancelled) { cancelled = false; swallowNextClick(); return; }
      if (!press) return;
      const held = press;
      const wasDrag = dragging;
      const inside = latest.current.over(e, el);
      end();
      if (!wasDrag) return;
      swallowNextClick();
      if (inside) latest.current.drop(held, e, el);
    };
    const cancel = () => { cancelled = false; end(); };
    // Escape in a drag only ends the drag: the capture phase and stopImmediatePropagation keep it from the focus and pin handlers.
    const key = (e: KeyboardEvent) => { if (e.key !== 'Escape' || !press) return; if (dragging) e.stopImmediatePropagation(); cancelled = dragging; end(); };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    document.addEventListener('keydown', key, { capture: true });
    return () => {
      cancelAnimationFrame(frame);
      setDrag(null);
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.removeEventListener('keydown', key, { capture: true });
    };
  }, [root, active, latest]);
  return drag;
}
```

Run: `npx vitest run src/ui/bands/usePressDrag.test.tsx --maxWorkers=4`
Expected: PASS.

- [ ] **Step 4: Move both callers onto it**

1. Where `CardBands.tsx` (or the file it delegates to) calls `useCardDrag(canvas, titleOf, onDrop, canDrag, measure)`, call `usePressDrag` with:

```ts
{
  pick: (t) => { const card = t.closest<HTMLElement>('[data-mart-id][data-path]'); const path = card?.dataset.path; return card && path ? { path, martId: card.dataset.martId! } : null; },
  canDrag,
  // Only the Data Marts band's body counts, as the Graph's scroll box does: a release over the other bands does nothing.
  over: (e, root) => e.target instanceof Element && !!e.target.closest('#band-marts .dm-band-body') && root.contains(e.target),
  view: (p, e, inside) => ({ path: p.path, martId: p.martId!, title: titleOf(p.martId!), x: e.clientX, y: e.clientY, inside, view: measure(p.path, e.clientX, e.clientY, inside) }),
  drop: (p, e) => onDrop(p.path, e.clientX, e.clientY),
}
```

2. Where `MartsCanvas.tsx` calls `useCanvasDrag(root, canDrag, onDrop, active, scale)`, call `usePressDrag(root, {...}, active)` with:

```ts
// The tree is drawn scaled, so the client offset is divided by the scale to get layout pixels.
const local = (e: PointerEvent, el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
{
  pick: (t) => { const path = t.closest<HTMLElement>('[data-tree-path]')?.dataset.treePath; return path ? { path } : null; },
  canDrag,
  // The whole scroll box counts as the canvas, so the margin around the tree is not a dead zone.
  over: (e, el) => e.target instanceof Node && scrollBoxOf(el).contains(e.target),
  view: (p, e, inside, el) => ({ path: p.path, ...local(e, el), clientX: e.clientX, clientY: e.clientY, inside }),
  drop: (p, e, el) => { const at = local(e, el); onDrop(p.path, at.x, at.y); },
}
```

3. Delete `useCardDrag.ts` and `useCanvasDrag.ts`. Move the `CardDrag<V>` type to the file that uses it, unexported.
4. Move everything in `useGridDrag.ts` (`gridTargets`, `closestGridTarget`, `measureGridDrag` and their types) into `canvas-drag.ts`, update the imports, and delete `useGridDrag.ts`. It holds no hook.

- [ ] **Step 5: Leftovers in the same files**

1. `useGhostChain.ts:33-34` (`pin` ref plus an effect) and `useCardClick.ts:35,42` (`latest` plus a layout effect) are hand-rolled copies of `useLatest`. Replace both with `useLatest`. Leave `mirror` in `useSmartSearch.ts:64-66` alone: `send` also writes to it.
2. `MartsCanvas.tsx:20,22`: remove the `= noOwnAliases` default of `own`, and pass `own` in the tests that omit it.
3. `canvas-layout.ts:23,48`: `extra?: GhostColumn | GhostColumn[]` becomes `extra?: GhostColumn[]`. Wrap the single object in an array in `canvas-layout.test.ts`.

- [ ] **Step 6: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/card-drag.spec.ts e2e/grid-drag.spec.ts e2e/marts-canvas.spec.ts e2e/marts-grid.spec.ts`
Expected: all pass, with `card-drag.test.tsx` and the e2e drag specs unchanged.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Merge the Grid and Graph card drags into one hook"
```

---

### Task 13: UI leftovers

**Files:**
- Modify: `src/ui/Popover.tsx`, `src/ui/explorer/MenuParts.tsx:129,141,144`, `src/ui/App.tsx:103`, `src/ui/explorer/ColumnPicker.tsx:47,85-86,130`, `src/ui/explorer/CellValue.tsx:11-25`
- Modify: `src/ui/bands/CardBands.tsx:465-571`
- Modify: `src/ui/explorer/MartGrid.tsx:3,72,728,735,748-750`, delete `src/ui/explorer/pending-focus.ts`
- Modify comments: `src/ui/explorer/ColumnMenu.tsx:281`, `src/ui/explorer/useMartRows.ts:42`, `src/ui/bands/transitions.ts:14-22`, `src/ui/bands/DataBand.tsx:30-31`, `src/ui/bands/cards.tsx:14`, `src/ui/bands/SearchBox.tsx:13`, `src/ui/header/HistoryButtons.tsx:1-2`
- Test: existing tests in `src/ui`

- [ ] **Step 1: Dead props**

1. `Popover.tsx`: delete the `tip`, `onCloseAutoFocus` and `align` props. Render `<P.Trigger asChild data-popover-trigger={id}>{trigger}</P.Trigger>` unconditionally, pass `align="start"` to `P.Content`, and remove the `@radix-ui/react-tooltip` import.
2. `MenuParts.tsx`: delete `Row`'s `tickEnd` prop (line 129) and the two branches that read it (lines 141, 144), keeping the branch that ran when it was absent.
3. `App.tsx:103`: delete `const opened = held;` and use `held`.
4. `ColumnPicker.tsx`: delete `const noun = kind;` (line 47) and use `kind`. Remove the wrapper `div` around a single child (line 130) if it carries no class, ref or handler. Make `columns` required (lines 85-86) and delete the branch and doc sentence for its absence.

- [ ] **Step 2: `CardBands` repeats its card props**

`MartCard` is rendered four times in `CardBands.tsx:475-571`: a tree card, a band card, a focus ghost and a ghost. All four repeat `mart`, `contexts`, `quality`, `lit` and `onOpenApp`. The two real cards also repeat `transition`, `count`, `onRetryCount` and `onNeedCount`. Inside the component, next to where `contextsOf` is in scope, add two functions. Use the type of `model.marts`' values for `Mart`:

```ts
/** What every card of a mart is given, wherever it is drawn. `el` is its element id. */
const anyCard = (mart: Mart, el: string) => ({
  mart,
  contexts: contextsOf(model.contexts, mart.contextIds),
  quality: dq.get(mart.id),
  lit: lit.has(el),
  onOpenApp: () => onOpenApp(mart.id),
});
/** A real card adds its transition and its row count. */
const realCard = (mart: Mart, el: string) => ({
  ...anyCard(mart, el),
  transition: martCards.transitionOf(mart),
  count: counts.get(mart.id) ?? { state: 'idle' as const },
  onRetryCount: () => onRetryCount(mart.id),
  onNeedCount: () => onRequestCount(mart.id),
});
```

Spread `realCard(mart, el)` in the tree card and the band card, and `anyCard(mart, el)` in the two ghosts, and delete the props the spread now supplies. Leave `key`, `selected`, `joined`, `path`, `title`, `focused`, `aside`, `faded`, `offPath`, `ghost`, `onRemove` and `onSelect` at each render: they differ. Leave the IIFE as it is. `card-bands-render.test.tsx` counts renders: keep its counts unchanged. If a count rises because `count` or a handler is no longer referentially stable, that was already the case before (each render built them inline), so look for another cause before touching the test.

- [ ] **Step 3: `CellValue` rebuilds a formatter**

`CellValue.tsx:11-25` chooses between `formatTemporal`, `formatNumber` and the raw text by field type. `formatValue(v, type, f)` in `src/format/formats.ts:68` does the same. Compute `const shown = formatValue(row[field], type ?? '', format ?? AUTO)` once and keep only the branch that adds the raw value as a tooltip on a temporal cell. `CellValue.test.tsx` and `CellValue.format.test.tsx` must pass unchanged. If any case differs (an untyped column, a null), keep the current code for that case.

- [ ] **Step 4: Inline `pending-focus.ts`**

It is a module-level variable with four exports and one consumer. Move its variable and functions to the top of `MartGrid.tsx` as unexported module-level helpers and delete the file. If a test imports from `pending-focus`, keep the file and skip this step.

- [ ] **Step 5: Stale and stranded comments**

1. Where two doc comments are stacked on one declaration, delete the first: `MartGrid.tsx:72`, `ColumnMenu.tsx:281`, `useMartRows.ts:42`, `transitions.ts:14-22`.
2. `DataBand.tsx:30-31` says one sentence twice: keep one.
3. `cards.tsx:14`: remove "Task 3's" so the comment describes the lines without naming a task.
4. `SearchBox.tsx:13`: "in a band's toolbar" becomes "in the page header".
5. `HistoryButtons.tsx:1-2`: rewrite to say where the buttons are now and what they do, without "what Back was".

- [ ] **Step 6: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e -- e2e/smoke.spec.ts e2e/context-badges.spec.ts e2e/marts-grid.spec.ts`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "Remove unused props and repeated card props in the UI"
```

---

### Task 14: Split `MartGrid.tsx` and `CardBands.tsx`

Moves only. No logic changes.

**Files:**
- Create: `src/ui/explorer/SeededGrid.tsx`, `src/ui/explorer/GridParts.tsx`, `src/ui/explorer/useGridSelection.ts`, `src/ui/bands/WireTipLayer.tsx`, `src/ui/bands/bandWires.ts`
- Modify: `src/ui/explorer/MartGrid.tsx`, `src/ui/bands/CardBands.tsx`, every importer of `MartGrid` and `WireTipLayer`

**Interfaces:**
- `src/ui/explorer/MartGrid.tsx` keeps exporting `MartGrid` (a re-export from `SeededGrid.tsx` if the component moves), so importers outside `src/ui/explorer` do not change.
- Produces: `useGridSelection(rows, outputs, scroller, head)` returning what the selection block exposes to the render today (the selection, `marksOf`, the pointer and key handlers). `bandWires(input)` returning what the `wires` memo returns today.

- [ ] **Step 1: `GridParts.tsx`**

Move `SortTitle`, `HeaderCell`, `BodyCell` and `GridRow` (`MartGrid.tsx:209-304`) with the types only they use. Export the ones `MartGrid.tsx` renders.

- [ ] **Step 2: `SeededGrid.tsx`**

Move `useSchema`, the outer `MartGrid` and `SeededGrid` (`MartGrid.tsx:54-199`): the code that waits for the saved columns and view before mounting the grid. The inner grid component stays in `MartGrid.tsx`. Move `SAVED_COLUMNS_WAIT_MS` and `VIEW_HOLD_MAX_MS` with the code that reads them, and update the tests that import them.

- [ ] **Step 3: `useGridSelection.ts`**

Move the selection state, drag-select, arrow keys and copy handling (`MartGrid.tsx:839-994`) into one hook. Its parameters are the values that block reads from the component, and its return value is what the render reads from it. `selection-renders.test.tsx`, `copy-grid.test.tsx` and `grid-focus.test.tsx` must pass unchanged.

- [ ] **Step 4: `WireTipLayer.tsx` and `bandWires.ts`**

1. Move `WireTipLayer` (`CardBands.tsx:49-91`) to its own file and update the test that imports it.
2. Move the body of the `wires` memo (`CardBands.tsx:260-352`) to a pure function `bandWires(input)` in `bandWires.ts`, where `input` is an object of the values the memo closes over. `CardBands` calls it inside the same `useMemo` with the same dependency list.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e`
Expected: all pass, with no test file changed except import paths. `wc -l src/ui/explorer/MartGrid.tsx` prints under 750.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Split the grid's parts, seeding and selection out of MartGrid"
```

---

### Task 15: `Panel` replaces Radix Popover and the `<details>` Export menu

**Files:**
- Modify: `src/ui/explorer/ExportMenu.tsx`, `src/ui/bands/ContextBadges.tsx:55`, `src/ui/explorer/ColumnPicker.tsx:127`, `src/ui/explorer/MenuParts.tsx`, `src/ui/bands/bands.css` (`dm-export-*` rules)
- Delete: `src/ui/Popover.tsx`
- Modify: `package.json`, `package-lock.json`
- Test: `src/ui/explorer/ExportMenu.test.tsx`, `src/ui/bands/ContextBadges.test.tsx`, `src/ui/explorer/ColumnPicker.test.tsx`, `e2e/menu-outside.spec.ts`, `e2e/context-badges.spec.ts`, `e2e/field-actions.spec.ts`

**Interfaces:**
- Consumes: `Panel` and `Row` from `src/ui/explorer/MenuParts.tsx`, `menuPlacement` and `useOutsidePress` as the column menu uses them.

Read `MenuParts.tsx` in full, and how `ColumnMenu.tsx` opens a `Panel` from a trigger, before starting. The column menu is the reference for placement, outside press, Escape and arrow keys.

- [ ] **Step 1: Pin today's Export menu behaviour**

Add to `ExportMenu.test.tsx` any of these that the file does not already cover, written with the render helper and queries the file uses. Run them and see them pass before changing the component:

1. The trigger opens the menu, and a second press on it closes the menu.
2. Arrow Down from the trigger focuses the first item, and Arrow Down from the last item wraps to the first (or stops, whichever happens today).
3. Escape closes the menu and returns focus to the trigger.
4. Picking Copy, Show SQL or Create data mart closes the menu. Picking a Sheets destination follows today's behaviour (open or closed).
5. A press outside closes the menu.

Run: `npx vitest run src/ui/explorer/ExportMenu.test.tsx --maxWorkers=4`
Expected: PASS on the current code.

- [ ] **Step 2: Move the Export menu to `Panel`**

1. Replace the `<details>` and `<summary>` with a `<button aria-haspopup="menu" aria-expanded={open}>` trigger and a `Panel` holding `Row`s, opened and placed as the column menu does.
2. Delete `onSummaryKey` and `onMenuKey` (lines 281-318) and the `data-action !== 'copy' && ...` special case (line 304). `Panel` and `Row` supply the keyboard handling.
3. Render the assistant and destination rows (lines 233-261) with the same row component the other items use.
4. Delete the `dm-export-*` rules in `bands.css` that only positioned and styled the `<details>` menu. Keep any that style content still rendered.
5. Keep the trigger's accessible name and every item's accessible name and `data-action` unchanged: the e2e specs select by them.

Run: `npx vitest run src/ui/explorer/ExportMenu.test.tsx --maxWorkers=4`
Expected: PASS, with only the queries that depended on `<details>` or `<summary>` changed.

- [ ] **Step 3: Move the two Popover uses to `Panel`**

`ContextBadges.tsx:55` and `ColumnPicker.tsx:127` are the only `Popover` users. Each becomes a trigger plus a `Panel` with `role="dialog"` and the `aria-label` it passed as `label`. Keep: a 16 rem wide box, at most 20 rem tall with the body scrolling inside, a press outside closes, Escape closes and returns focus to the trigger, and a column menu opened from a row inside it leaves it open (the `[data-column-menu]` rule in today's `Popover.tsx:17-19`). If `Panel` has no dialog role or scrolling body option, add the smallest prop that provides it.

- [ ] **Step 4: Remove the dependency**

Delete `src/ui/Popover.tsx`.
Run: `grep -rn "react-popover\|data-radix-popper-content-wrapper\|--radix-popover" src e2e`
Expected: no match in `src` outside `Tooltip.tsx` (Radix Tooltip also renders a popper wrapper: leave its selectors). Then run `npm uninstall @radix-ui/react-popover`.

- [ ] **Step 5: Run the checks**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Open the Export menu, context badges and field picker with the shared Panel"
```

**Behaviour change:** The Export menu, the context badges popover and the Fields picker open with the same placement and keyboard handling as the column menu.

---

### Task 16: Export sweep, config and docs

**Files:**
- Modify: many files in `src` (the `export` keyword only)
- Modify: `src/config.ts:8`, `src/ui/explorer/badgeReserve.tsx`, `src/ui/bands/useGhostChain.ts:5`
- Modify: `vite.config.ts:6`, `package.json:15`, `playwright.config.ts:8-9`, `README.md`
- Create: `tmp/unused.py` already exists and is gitignored. Use it.

- [ ] **Step 1: Delete the unreferenced constants**

Delete `IN_LIST_MAX_CHARS` and its comment (`config.ts:7-8`) and `BADGE_REST` (`badgeReserve.tsx`). Confirm each with `grep -rn "<name>" src e2e` printing only the declaration.

- [ ] **Step 2: Remove needless `export` keywords**

Run: `python3 tmp/unused.py | grep '^UNUSED'`
For each line with `own` greater than 1, remove the `export` keyword from that declaration. For each line with `own=1`, delete the declaration (it has no reference at all), unless it is `SdkFitsCtx` from task 9. Leave every `TESTONLY` line alone: tests import those.

Run after every 20 or so edits: `npx tsc -b`
Expected: no error. An error means something imports the name through a path the script missed: restore that `export`.

- [ ] **Step 3: Config leftovers**

1. `vite.config.ts:6`: delete `base: './'`. Run `npm run build` and confirm `dist/index.html` references `/assets/...`. `void.config.ts` serves `/assets/*` with the CORS header, so absolute paths work.
2. `package.json:15`: the `e2e` script becomes `playwright test --workers=1`. `playwright.config.ts` already sets `trace: 'off'`. In `playwright.config.ts` change `workers: 4` to `workers: 1`, so the config and the script agree.

Run: `npm run e2e -- e2e/smoke.spec.ts`
Expected: PASS against the build made without `base`.

- [ ] **Step 4: Rewrite the stale README sections**

Read `README.md` in full, then fix these against the code:

1. Line 23: remove "as before".
2. Line 35 (Charts): describe the saved chart list and the kinds in `src/charts/kinds/index.ts`. The fixed time-series and pie panels are gone.
3. Lines 174-187 (Smart search): the request sends `entityTypes=DATA_MART,REPORT` and `limit=20` (`src/search/endpoint.ts:44`). The pipeline is the steps in `src/search/steps/` (main, path, fields, shape, charts) answered by the `decision` model, with the `fast` model reading the query. `plugin.json` declares `"models": ["fast", "decision"]`. Remove every mention of a `reasoning` model and of "AI discovery".
4. Lines 189-196 (Limitations): limitation 1 and "What it writes" name Create Data Mart. Limitation 3 says sorts and filters are saved with the grid (`gridView` in the `grid-columns` document). Limitation 6 says links open the host's own OWOX, and app.owox.com when the host cannot tell its origin.

Follow the unslop rules. Keep the README's numbered-list style.

- [ ] **Step 5: Run every check**

Run: `npx vitest run --maxWorkers=4 && npm run lint && npm run build && npm run e2e`
Expected: all pass.

Run: `python3 tmp/unused.py | grep -c '^UNUSED'`
Expected: `0`, or only type-level names kept on purpose, each listed in the commit body.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "Unexport file-local names and bring the README in line with the code"
```
