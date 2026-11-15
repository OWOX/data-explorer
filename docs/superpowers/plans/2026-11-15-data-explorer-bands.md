# Data Explorer band layout: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Replace the node canvas and tabs with Data Flow's stacked bands: Data Sources → Data Marts → Data → Row.

**Architecture:** Port Data Flow's band, card and wire code into `src/ui/bands/`, keep the data layer and the grid/record components, and swap the tab store for a single selection with history.

**Tech stack:** Vite 8, React 19, TS 6, Tailwind 4, lucide-react, @tanstack/react-table, Vitest 5, Playwright. `@xyflow/react` and `@dagrejs/dagre` are removed.

**Spec:** `docs/superpowers/specs/2026-11-15-data-explorer-bands-design.md` (binding). The original `docs/superpowers/specs/2026-11-14-data-explorer-design.md` still governs data loading, filters, relationship columns and the record view.

**Reference code (read-only, never modify):** `/Users/flakss/Projects/data-flow` at HEAD `844f13b`. Files: `src/controls.tsx` (`Band`), `src/cards.tsx` (`NodeCard`, `MartCard`, `Contexts`, `MoreCard`), `src/icons/picked.tsx`, `src/icons/catalog.ts`, `src/format.ts`, `src/wires.ts`, `src/styles.css`, `AGENTS.md` (wire-layer invariants).

## Global constraints

1. Never modify `/Users/flakss/Projects/data-flow` or `/Users/flakss/Projects/owox-data-marts`.
2. Vitest runs with at most 4 workers (`vitest.config.ts` already sets `maxWorkers: 4`). Never run Playwright or Vitest with more.
3. Read-only plugin: no create/update/delete API calls. Every `traverseData` is a billed run; do not add any.
4. New UI copy is plain, sentence case, no em dashes.
5. Keep `src/sdk/types.ts`'s `Ctx` narrow: add only fields this plan names.
6. Scratch files go in `tmp/`, never system `/tmp`.
7. Each task ends with `npx vitest run`, `npx tsc -b` and `npx eslint .` green, and one commit (Conventional Commits, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`).

## Rulings carried into this plan

1. **Contexts on mart cards.** The 2026-11-14 instruction was "contexts in the header, not on the card". On 2026-11-15 the user asked to reuse Data Flow's recent card changes, which add context chips to the card footer (folding into one counted chip). The newer instruction wins: cards show Data Flow's `Contexts` footer; the header context filter stays.
2. **Picked icon.** As in Data Flow, a mart card shows its icon only when one was picked (`mart.icon` non-null). Data Flow's `PickedIcon` replaces `src/ui/icons.tsx`'s mart icon map; keep `icons.tsx` only for what the grid, quality and freshness still use.

## Review focus

1. A hub mart with 30+ connected marts: the band must stay responsive and lines must not stack into thousands of paths (Data Flow invariant 1).
2. Following a related title into a mart the member cannot access: Data shows "You do not have access to this data mart", nothing crashes.
3. Back after following three links returns to each previous mart with its filters and record, in order.
4. Refresh failing after a good load: previous counts and data quality stay, no endless spinner.
5. Window resize and band folding: lines follow the cards.

---

### Task 1: Sources in the data layer

**Files:** `src/sdk/types.ts`, `src/model/types.ts`, `src/api/model.ts`, `src/api/model.test.ts`, new `src/model/sources.ts` + `src/model/sources.test.ts`, `src/sdk/mock/fixtures.ts`, `src/sdk/mock/ctx.ts`.

**Produces:**
- `DataMartListItemDto` gains `definitionType?: string | null; connectorSourceName?: string | null`.
- `ConnectorDto = { name: string; title?: string | null; logo?: unknown }`.
- `Mart` gains `sourceKey: string | null` (the `connectorSourceName` when `definitionType === 'CONNECTOR'`, else null).
- `Source = { key: string; name: string; logo: string | null; martIds: string[] }`.
- `Model` gains `sources: Source[]`.
- `groupSources(marts: Iterable<Mart>, connectors: ConnectorDto[]): Source[]`: one source per distinct `sourceKey` among **accessible** marts; `name` = connector `title` or the key; `logo` = connector `logo` when it is a string, else null; ordered by `martIds.length` descending, then name.

**Steps:**
1. Tests first in `sources.test.ts`: groups by key; skips marts with `sourceKey: null` and inaccessible marts; title and logo fallback when the connector is missing or `logo` is not a string; order.
2. `loadModel` fetches `GET /api/connectors` in the first `Promise.all`, wrapped so a failure yields `[]` (no error surfaced). Add a `model.test.ts` case for that failure.
3. Fixtures: give `orders`, `customers`, `payments`, `shipments`, `returns` `connectorSourceName: 'Shopify'`; `sessions`, `campaigns` `'GoogleAnalytics4'`; `ad_spend`, `reviews` `'FacebookAds'`, all with `definitionType: 'CONNECTOR'`; the rest `definitionType: 'SQL'`. The mock list returns both fields. Mock `getJson('/api/connectors')` returns `[{name:'Shopify',title:'Shopify'},{name:'GoogleAnalytics4',title:'Google Analytics 4'},{name:'FacebookAds',title:'Facebook Ads'}]` with no logos.
4. Commit `feat: read data sources from mart connectors`.

### Task 2: Port Data Flow's band and card UI

**Files:** new `src/ui/bands/Band.tsx`, `src/ui/bands/cards.tsx`, `src/ui/bands/picked.tsx`, `src/ui/bands/catalog.ts`, `src/ui/bands/bands.css` (imported from `src/styles.css`), `src/ui/bands/cards.test.tsx`. Delete `src/ui/canvas/MartCard.tsx` and its test only in Task 4, not here.

**Produces:**
- `Band({ id, icon, title, total?, hint, folded, onFold, loading?, toolbar?, children })`: Data Flow's `Band` markup and classes. Grid bands render children inside `.dm-band-grid`; pass `grid={false}` to render children directly (Data and Row bands).
- `SourceCard({ source, selected, lit, onSelect })`: `NodeCard` with the connector logo (an `<img class="dm-logo">`, `Plug` fallback), name, badge "N data marts".
- `MartCard({ mart, contexts, count, quality, freshness, fieldHit, selected, lit, onSelect, onOpenApp, onRetryCount })`: Data Flow's `NodeCard` layout and `.dm-node` styling, carrying this app's content: picked icon (only when set), title, OWOX link (`ExternalLink`, calls `onOpenApp`, does not select), (i) description hint when a description exists, row-count badge (spinner, value, `—` with error tooltip and retry), data quality glyph with the tone border (`data-tone`), freshness glyph, `fieldHit` as a badge when search matched a field, Data Flow's `Contexts` footer, muted "No access" variant for inaccessible marts. Click and Enter select.
- `PickedIcon` and the lazy lucide catalog copied from Data Flow `src/icons/picked.tsx` and `src/icons/catalog.ts`, adapted to this repo's icon keys.
- CSS: copy from Data Flow `src/styles.css` the rules for `.dm-canvas`, `.dm-band*`, `.dm-node*`, `.dm-badge*`, `.dm-logo`, `.dm-contexts*`, `.dm-hint*`, `.dm-mark*`, `.dm-muted`, tone variables, the dark variants, and the card enter/leave animations. Replace this repo's existing `.dm-node` rules with them. Map Data Flow's colour variables onto this repo's Tailwind theme tokens.

**Steps:**
1. Tests first (`cards.test.tsx`, jsdom): SourceCard shows name and "3 data marts" and calls `onSelect`; MartCard shows the picked icon only when set, the count states, `—` with retry, the context chips, and the OWOX link does not call `onSelect`; Band fold toggles `aria-expanded` and hides children.
2. Port the code. Keep Data Flow's comments that explain behaviour; drop ones about drag, people, sharing, storages, destinations, reports.
3. Commit `feat(ui): Data Flow bands and cards`.

### Task 3: Port the wire layer

**Files:** new `src/ui/bands/wires.ts`, `src/ui/bands/wires.test.ts`.

**Produces:** `useWires(canvasRef, wires: Wire[], selection: { pinned: string | null; hovered: string | null }, revision: number)` where `Wire = { id: string; from: string; to: string; kind: 'source' | 'relationship'; title: string }` and `from`/`to` are card element ids (`src-<key>`, `dm-<martId>`). It draws one SVG layer (`#wires`) inside the canvas, as Data Flow's `src/wires.ts` does, keeping all four invariants in Data Flow's `AGENTS.md` ("The wire layer, and what keeps breaking in it"): one path per pair of boxes, every follower mapped, light after measuring, lit state in a ref. Kinds: `source` is the blue cross-band line; `relationship` is the grey in-band line, 2px leaving the pinned card and 1px arriving. A wire whose end is not on the page is skipped (there is no block fallback here: both bands show every card they hold).

**Steps:**
1. Tests first: pure helpers (pairing, which wires light for a pinned id, arriving vs leaving weight) unit-tested without layout.
2. Port. Redraw on `ResizeObserver` of the canvas and both grids, on `revision`, and on band fold.
3. Commit `feat(ui): wire layer for sources and relationships`.

### Task 4: Selection store and the four-band page

**Files:** `src/state/store.tsx` (+ test), `src/graph/visible.ts` (+ test), `src/ui/App.tsx`, new `src/ui/bands/DataBand.tsx`, `src/ui/bands/RowBand.tsx`, `src/ui/explorer/MartTab.tsx` → renamed `MartGrid.tsx`, `src/ui/explorer/RecordTab.tsx` → renamed `RecordView.tsx`, `src/ui/explorer/Explorer.test.tsx` (rewrite as `src/ui/bands/page.test.tsx`), `src/ui/useModelData.ts`, `package.json`. Delete `src/ui/canvas/*`, `src/graph/layout.ts` (+ test), `src/ui/explorer/TabBar.tsx`, `src/ui/explorer/Explorer.tsx`.

**Produces:**
- Store, per the spec's "Selection state":
  - `Selection = { sourceKey: string | null; martId: string | null; record: { martId: string; pk: Record<string, unknown> } | null; filters?: ColumnFilter[] }`.
  - `State = { selection: Selection; history: Selection[]; search: string; contextIds: string[]; grids: Record<string, GridState>; modelVersion: number }`, `GridState = { columns: string[]; filters: Record<string, ColumnFilter>; limit: number }`.
  - Actions: `selectSource(key | null)` (toggle; clears martId and record), `selectMart(id)` (keeps sourceKey only if that source feeds the mart, needs `sourceOf: (martId) => string | null` passed in the action; clears record), `openRecord(martId, pk)` (sets martId too), `follow(target: ClickTarget)` (record target → selectMart + openRecord; filtered-mart target → selectMart with `filters`, record cleared), `back`, `search`, `toggleContext`, `saveGrid(martId, GridState)`, `refreshModel`, `init(focusId)` (only when `selection.martId` is null). Every action that changes `selection` pushes the previous selection onto `history` (max 20, oldest dropped). `back` pops it. `search` and `toggleContext` do not clear the selection.
- `computeVisible({ model, selection, search, contextIds, schemas })` → `{ ids: string[]; fieldHits: Map<string, string>; focusId: string | null }` implementing the spec's four rules and its order (selected first, then inbound count descending, then title). Drop `expandLevels`, `hiddenMatches`, `mode`, `VISIBLE_BUDGET`.
- `App`: header, then a `.dm-canvas` holding the Sources band (`SourceCard`s), Data Marts band (`MartCard`s for `computeVisible().ids`), Data band (`DataBand`), Row band (`RowBand`), and the `useWires` layer over the first two bands. Wires: `source` for each visible mart with a `sourceKey` whose source card is shown; `relationship` for each edge with both ends visible, titled with its join (`customer_id → id`).
- `DataBand`: title and icon of the selected mart; body `MartGrid` keyed by martId, seeded from `state.grids[martId]` and from `selection.filters` when present, saving its state back with `saveGrid` on change. Row click → `openRecord`. Related-title click → `follow`. Inaccessible mart → "You do not have access to this data mart". No mart → "Select a data mart."
- `RowBand`: title `<mart> · <pk values>`, Back button (`ArrowLeft`, disabled when history is empty; `Alt+ArrowLeft` on the document does the same), body `RecordView`. Related-title and "Referenced by" clicks → `follow`. No record → "Select a row."
- Remove `@xyflow/react` and `@dagrejs/dagre` from `package.json` and the lockfile (`npm uninstall`).

**Steps:**
1. Tests first: reducer (every action above, history order and the 20 cap, selectMart dropping a non-feeding source), `computeVisible` (each rule; inaccessible neighbour included; search keeps the selection), page test in jsdom with the mock ctx at latency 0 (first load selects Orders and shows its rows; source click narrows marts; row click fills Row; related title moves selection; Back restores; filter + Reset; column picker).
2. Implement. Reuse `MartTab`/`RecordTab` internals; only their inputs change from a `Tab` to props.
3. Commit `feat(ui): four-band page replaces the canvas and tabs`.

### Task 5: Counts, refresh, smoke tests, docs

**Files:** `src/ui/useModelData.ts` (+ test), `src/ui/bands/cards.tsx`, `e2e/smoke.spec.ts`, `README.md`, `tmp/states/` harness (scratch, not committed).

**Produces:**
- Lazy counts: a mart card requests its count only once it intersects the viewport (`IntersectionObserver`, one shared observer), through the existing pool of 4 and cache. jsdom has no `IntersectionObserver`; tests stub it.
- Refresh failure: when a model reload fails after a good load, the previous model, counts and data quality stay; counts are never set back to `loading` unless a recount actually starts. Test it.
- `e2e/smoke.spec.ts` rewritten for bands (same coverage as Task 4's page test, in the browser).
- README: replace the canvas/tabs description with the band layout; keep "Limitations (v1)".

**Steps:**
1. Tests first for the refresh rule and lazy counting.
2. Implement; run Playwright (`npx playwright test --workers=1`).
3. Commit `feat: lazy row counts, refresh keeps the last good model`.
