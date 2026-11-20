# Review wave implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Apply the Fable review's findings that the user chose (option 2): the one bug, the speed items, every small (S) cleanup, and the medium refactors of ExportMenu, MartGrid state and join-plan. Behaviour stays the same.

**Spec:** The three review reports are the spec. Each task names its findings by report and number:
- `docs/superpowers/reviews/review-core.md` (C)
- `docs/superpowers/reviews/review-ui.md` (U)
- `docs/superpowers/reviews/review-charts-datamart.md` (D)

## Global constraints

1. Behaviour does not change, except for the bug in C1 and the speed gains. The existing tests must pass unchanged, unless a finding removes the code they test. Then delete those tests, and say so in the report.
2. Verify each finding before changing code. If the code does not match the report, or the change is riskier than the report says, skip the finding and give the reason in the report. A skip is a valid outcome.
3. Out of scope:
   - U24 (Radix Popover).
   - Removing the TanStack Table dependency. U2 hoists the renderers but keeps TanStack.
   - The M items the user did not choose: U9, U21, U23, C12, C13, C17, C19, D21, D22.
   - D20 beyond its guards.
4. Every speed change gets a test that pins it. Examples: one formatter per locale, one request where there were N + 1.
5. Run vitest only with `--maxWorkers=4`. Also run `npx tsc -b` and `npm run lint`. Run `npm run e2e` in Tasks 5, 6 and 7.
6. Write comments as full sentences, with no em dashes.
7. End every commit message with these two lines:
   ```
   Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
   Claude-Session: https://claude.ai/code/session_01Njr5V84HbWNJ1R3P2mvLyj
   ```

## Review focus

1. A refactor that changes behaviour silently. Pay special attention to filter, slice and HAVING parking (U3), join-plan refit (C4) and the store actions (C7, C18).
2. Cache invalidation. Every new memo or cache must be cleared on Refresh, or be keyed so that stale data cannot be served (C1, D3, D8).
3. Billed reads. D4 and D18 must return the same numbers the separate reads gave. Only share a read whose options are identical or a true superset.
4. Focus, keyboard and Escape behaviour of the ExportMenu dialogs after the shared `Modal` (U4).
5. Re-render fixes (U1, U7, U8) must not break selection, hover or drag.

---

### Task 1: Core small items and the loader bug

Findings: C1, C2, C3, C5, C6, C7, C8, C9, C10, C14, C15, C16, C18, C20, C21, C22, C23, C24.

- [ ] Write a failing test for C1 first. A read in flight before `clear()` must not be served after it.
- [ ] Implement each finding, or skip it with a reason.
- [ ] Run the focused tests, the full suite once, `tsc` and lint.
- [ ] Commit "Core: loaders drop in-flight reads on clear; dead code, guards and shared helpers".

### Task 2: join-plan refit and export reads

Findings: C4 (one `refit()` helper; `withoutMart` and `withoutPaths` share it) and C11 (one read instead of N + 1 per export, and no redundant pre-run GET).

- [ ] Before refactoring C4, add tests that pin today's refit results for each of the five call sites, so the refactor is proven behaviour-neutral.
- [ ] Add a test that counts requests for C11.
- [ ] Commit "Core: one refit for join-plan, one read per export".

### Task 3: Charts, format and data mart: small items

Findings: D1, D2, D3, D5, D6, D7, D8, D10, D11, D12, D13, D14, D15, D16, D17, D20 (guards only), D23, D24, D25.

- [ ] Pin the formatter caches (D1, D2, D3) and the eviction (D8) with tests.
- [ ] Commit "Charts, formats and SQL: cached formatters and type lookups, shared helpers, dead fields".

### Task 4: Chart reads and parity cases

Findings: D4 and D18 (shared billed reads), D9 (ChartsBody memoisation) and D19 (engine-parity cases written once and used by both the script and the test).

- [ ] For D4 and D18, add tests showing the shared read returns exactly what the separate reads returned, and that the request count drops.
- [ ] For D19, the script and the test import one cases module. The goldens must not change.
- [ ] Commit "Charts: share reads that ask for the same rows; parity cases in one place".

### Task 5: UI small items

Findings: U1, U6, U8, U10, U11, U12, U13, U14, U15, U18, U19, U20.

- [ ] U10 also covers `src/charts/ChartMenu.tsx`.
- [ ] For U11, keep every existing keyboard test passing.
- [ ] Commit "UI: stable card effects, shared hover intent and roving focus, smaller props".

### Task 6: MartGrid

Findings: U2 (hoist header and cell renderers to module-level components, keep TanStack), U3 (one map each for filters and slices, with parked derived), U7 (a selection change re-renders only the cells it touches).

- [ ] Before U3, check that every parking test, slice test and HAVING-orphan test still passes. These are slices-grid.test.tsx, apply-joined.test.tsx and the saved-columns tests.
- [ ] Add a render-count test for U7.
- [ ] Commit "Grid: renderers outside the memo, one map per rule kind, selection re-renders its cells only".

### Task 7: ExportMenu

Findings: U4 (one `Modal`), U5 (one copy state), U16, U17 and U22 (split the 864-line file into its components and the hook).

- [ ] Keep every ExportMenu test, focus test and Escape test passing.
- [ ] Add a test that Tab is trapped in each dialog.
- [ ] Commit "Export menu: one Modal, one copy state, split into files".
