# Config menu, graph plus button and search focus: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One Config menu next to Table / Charts for every field of every data mart (shown, on the path, joinable) and for charts; a (+) on graph cards in place of hover ghosts; search that is focused when it opens.

**Architecture:** The field list inside `ColumnPicker` becomes a plain `MartFields` component. A new recursive `ConfigMenu` shows it as each data mart's submenu. `MartGrid` owns the menu's data and portals it into the Data band header; in Charts mode `ChartsBody` adds the chart rows. The graph keeps `useGhostChain`, driven by a (+) instead of the card.

**Tech stack:** React, TypeScript, Vitest, Playwright, lucide-react. No new dependency.

**Spec:** the member's list, copied below.

1. If AI is unavailable show the search icon before "ad-hoc report" in the search dropdown instead of the AI icon.
2. When the user clicks search, put focus in the input right away.
3. When the plugin opens for the first time with no main data mart known, show the search input with focus in it right away.
4. Graph view: do not show joinable data marts on hover. Show a (+) in the middle of the right edge if joinable data marts are available. Hovering (+) shows them; clicking it keeps them shown.
5. (×) and (+) are the same size, and (×) is 20% bigger than today (16 to 19.2).
6. Next to the Table / Charts switch always show a config button. Its menu:
   1. the data marts: shown ones first, then those on a path with no column;
   2. each one's submenu lists its fields, shown first, then the rest;
   3. under the fields, a separator and "Joinable Data Marts" when there are any, each with the same submenu;
   4. every data mart label follows its icon and has a (?) on hover when it has a description;
   5. with Charts active, "Add chart" with its submenu comes before the data marts;
   6. each chart's three dots menu has "Duplicate";
   7. chart menus say "Hide", not "Remove";
   8. the column icon in the data mart title cell is gone;
   9. filter and slice badges have no ×; their dropdown ends with "Clear", which removes all of them.

## Global constraints

- Work only in `/Users/flakss/Projects/data-explorer/.worktrees/chart-path-marts`, branch `feat/config-menu`. Never `git stash`, never push.
- Vitest: `npx vitest run <files> --maxWorkers=4`. Playwright: `--workers=1 --trace off` with `PW_PORT=4395`. Never run either unbounded.
- TDD: watch each new test fail first. Each task ends with `npx tsc -b --noEmit`, `npx eslint .`, the full Vitest suite green, and a commit. End commit messages with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No model names elsewhere.
- Comments and copy: plain sentences, no em dashes. Match the surrounding comment style and density.
- Keep every existing capability: field search, Select all, Clear, the Count Unique lead row, locked fields, the per-field column menu (a field that is not shown can be filtered or sorted), `ownInSchemaOrder`, one Undo step per edit, removing a data mart from the report.
- Do not weaken a test to make it pass. Migrate it to the new controls and keep what it asserts.

## Review focus

1. Ticking the first field of a joinable or path mart: the row must not jump, and the open panel must not close, although the mart has just entered the tree. Pinned in Task 4.
2. Unticking a joined mart's last field: it leaves only when its panel closes. Pinned in Task 4.
3. Charts early returns (nothing to chart, HAVING gate): the config button is still there and an open menu stays open. Pinned in Task 5.
4. The same data mart on two paths: titles differ. Pinned in Task 5.
5. Pressing (+) does not start a card drag or select the card. Pinned in Task 2.

---

### Task 1: Search icon, focus, first visit (items 1 to 3)

**Files:** modify `src/ui/bands/SearchResults.tsx`, `SearchBox.tsx`, `SmartSearchScope.tsx`, `useSmartSearch.ts`, `src/ui/App.tsx`; test `src/ui/bands/smart-search.test.tsx`, `src/ui/main-mart.page.test.tsx`.

**Interfaces:** `useSmartSearch` also returns `aiReady: boolean`. `HeaderSearch` takes `autoOpen?: boolean`.

- [ ] Tests first:
  - without AI the ad-hoc row has the search icon (`.lucide-search`) and no `.lucide-sparkles`; with AI the reverse. The reason row ("Type at least 2 characters") follows the same rule.
  - a click on the search button leaves `document.activeElement` on the combobox with no `waitFor`; a click on an applied query too; a press on the open box's own icon or padding puts focus in the input.
  - page: nothing remembered and no view link: the combobox is on screen and focused, once. A remembered openable mart: the button, not the box. A remembered mart that is gone or not readable: the box. A view link: the button. Closing the box with Escape does not reopen it.
- [ ] `RowBody` takes `ai: boolean` and draws `ai ? Sparkles : Search`.
- [ ] `SearchBox`: focus in `useLayoutEffect` on `open` (same commit as the click). On the open form, `onMouseDown`: when the target is not inside an `input`, `button` or `.dm-search-results`, prevent the default and focus the input.
- [ ] `App`: `const [firstVisit, setFirstVisit] = useState(false)`, set to true exactly where the first load falls back to the focus mart (`if (!last || !openable)`) and only when the page did not open from a link (`!hasLink`). `<HeaderSearch autoOpen={firstVisit} />` calls `smart.openBox()` once when it turns true, and never again. The focus mart still opens as today.
- [ ] Other page tests that now meet an open box: seed a remembered main mart, or use the combobox. Do not remove assertions. Check e2e specs that click the search button or press Escape on a fresh `/?mock` page and fix those that break.
- [ ] Commit: "Search: focus on open, open on a first visit, search icon without AI".

### Task 2: (+) on graph cards (items 4, 5)

**Files:** modify `src/ui/bands/cards.tsx`, `useGhostChain.ts`, `MartsCanvas.tsx`, `bands.css`; test `marts-canvas.test.tsx`, `useCanvasDrag` tests, `e2e/marts-canvas.spec.ts`.

**Interfaces:**
- `MartCard` gains `join?: { open: boolean; onToggle: () => void }`. When set it draws
  `<button type="button" className="dm-card-join" data-join-plus aria-label={`Show data marts ${name} can join`} aria-expanded={join.open}><CirclePlus size={CARD_CONTROL} /></button>`, click handler stops propagation and calls `onToggle`.
- `const CARD_CONTROL = 19.2;` in `cards.tsx`, used by the × (`CircleX`) and the (+).
- `Over` becomes `{ card: string | null; ghost: string | null; plus: boolean }`; `overOf` sets `plus` from `closest('[data-join-plus]')`.
- `useGhostChain(pinned: string | null, pinnedChain: string[])`.

- [ ] Behaviour to test first:
  - hovering a card shows no ghost; its (+) is in the DOM only when `joinableUnder` gives at least one accessible source for its path; no (+) otherwise.
  - hovering (+) shows that card's ghosts at once; moving from (+) to a ghost keeps them; moving onto another card or the empty canvas hides them after `GHOST_GRACE_MS`; while the pointer is on the anchor card itself they stay.
  - clicking (+) keeps them after the pointer leaves; a second click, Escape or a click on the empty canvas lets them go; after a second click the same hover does not bring them back.
  - a ghost with joinable marts has its own (+). Hovering it adds the next level; hovering the ghost itself does not. Clicking it keeps the whole chain.
  - keyboard: focusing (+) shows the ghosts, as hover does, and Enter keeps them.
  - pressing (+) and moving 20px does not start a drag, and a click on (+) does not run `onSelect`. On a ghost, (+) does not add the mart.
  - a click on the card itself still pins it as today; the card added from a ghost is still pinned.
  - hover dimming of unrelated cards is unchanged.
- [ ] CSS: `.dm-card-join { position: absolute; right: -0.6rem; top: 50%; transform: translateY(-50%); z-index: 3; ... }`, sharing the look and reveal rules of `.dm-card-remove` (opacity 0 at rest, 1 on card hover, focus, and always on touch). `aria-expanded="true"` stays visible. Re-centre `.dm-card-remove` on its corner for 19.2px (`-0.6rem`). Ghost cards need the same reveal. Check the control is not clipped.
- [ ] State: `pinState` gains `chain: string[]` (empty for a card). The pin of a ghost's (+) is the current anchor plus the chain ending in that ghost.
- [ ] Migrate existing tests from hovering the card to hovering its (+). Update the comments that say hover shows ghosts, and the e2e spec.
- [ ] Commit: "Graph: a (+) shows the joinable data marts, in place of hover".

### Task 3: Chart menu: Duplicate and Hide (items 6.6, 6.7)

**Files:** modify `src/charts/listMenu.ts`; test `listMenu.test.ts`, `copies.test.ts`, `charts-body.test.tsx`, `ChartMenu.test.tsx`, `ChartPanel.test.tsx`, `sankey-body.test.tsx`, e2e `charts.spec.ts`, `chart-list.spec.ts`.

- [ ] Tests first: the tail is Chart type, Duplicate, Hide. Duplicate inserts a copy (new id, every other choice equal, not hidden, arrays not shared) right after the original, also when the list is still `DEFAULT_CHARTS`. Hide sets `hidden: true` and the Charts list still names it and shows it again with its setup. No chart menu has "Remove". A Sankey column's own "Remove column" stays, since it removes a column and not the chart.
- [ ] Implementation in `tailItems`:

```ts
{ kind: 'action', label: 'Duplicate', icon: Copy, onPick: () => change((cur) => editCharts(cur, (list) => list.flatMap((c) => (c.id === spec.id ? [c, { ...structuredClone(c), id: newChartId() }] : [c])))) },
{ kind: 'action', label: 'Hide', icon: EyeOff, onPick: () => change((cur) => patchChart(cur, spec.id, { hidden: true })) },
```

- [ ] Commit: "Chart menus: Duplicate, and Hide in place of Remove".

### Task 4: `MartFields` and `ConfigMenu`

**Files:** create `src/ui/explorer/MartFields.tsx`, `src/ui/explorer/ConfigMenu.tsx`, `ConfigMenu.test.tsx`; modify `ColumnPicker.tsx` (its popover uses `MartFields`), `MenuParts.tsx` (`Row` gains `hint?: string`).

**Interfaces (produced for Task 5):**

```ts
/** One data mart of the menu, at one alias path ('' for the main mart). */
export type ConfigMart = {
  path: string; title: string; icon?: string | null; description?: string | null;
  main: boolean;
  fields: Field[];
  locked: (name: string) => boolean;
  unique?: { on: boolean; onToggle: () => void };
  /** Takes the data mart out of the report. Absent when it has no column, or is the only one. */
  remove?: { onRemove: () => void; disabled?: boolean };
};
export function ConfigMenu(p: {
  /** Shown data marts in grid order, then the ones on a path with no column. */
  marts: ConfigMart[];
  /** What can join under a path and is not in the report. */
  joinable: (path: string) => ConfigMart[];
  visible: string[];
  onChange: (cols: string[]) => void;
  /** Charts mode: rows before the data marts (Add chart, then Charts). */
  chartItems?: MenuItem[];
}): ReactNode;
export function MartFields(p: { mart: ConfigMart; visible: string[]; onChange: (cols: string[]) => void }): ReactNode;
```

- [ ] `MartFields` holds what `ColumnPicker` has inside its popover: `apply`, `commit`, `emptied`, `ownInSchemaOrder`, the `SheetsChecklist` with the same `Fields of ${title}` label, lead row, `FieldMenuButton` and `FieldHint`. Field order: shown first in grid order, then the rest in schema order, taken once when it mounts (`useState` initialiser) so a tick never moves the row. Only a mart that had a shown column can be `emptied`; the pending empty commit runs when it unmounts (effect cleanup reading refs) and must not run in StrictMode's double mount.
- [ ] Config button: `aria-label="Configure data"`, lucide `Settings2`, class `dm-menu-dots`, `data-config-button`. It opens a root `Panel` (`mode="below"`, `role="menu"`, label "Configure data").
- [ ] Rows: chart items first (then a separator), each data mart as a `sub` Row with its `PickedIcon` glyph, title and (?) (`hint`, shown on row hover or focus, decorative for assistive tech, with `aria-description` on the row). A separator between the shown marts and the path marts.
- [ ] A mart's submenu: `Panel mode="beside" role="dialog" label={title}` with `MartFields`; then, when `joinable(path)` is not empty, a separator, the heading "Joinable Data Marts" and one `sub` Row each, opening the same submenu recursively; then, when `remove` is set, a separator and a "Remove from report" row that closes the menu.
- [ ] Freeze what is listed: the root takes `marts` paths and each submenu takes its `joinable(path)` when it opens. Later renders look each path up for live data (from `marts`, else from the frozen entry). A path that joined the tree stays where it was listed until the menu closes.
- [ ] Hover switches submenus through `useSubmenu`, with `isEditing` true while a search box in an open panel holds focus. Escape and Left close the deepest panel first. A press outside (not in `[data-column-menu]` and not on the button) and a scroll of what holds the button close it all, as in `ChartMenu`. Tall lists scroll inside their panel.
- [ ] `MenuItem` radio and check rows: reuse `ChartMenu`'s row drawing. Extract it rather than copying. `check` rows keep the menu open.
- [ ] Tests: order shown then path; fields shown first, then schema order; a tick calls `onChange` with the right list for main, joined, path and joinable marts; the row and panel stay after the mart moves into `marts` on rerender; unticking the last joined field commits on close only; nested joinable of a joinable; heading absent when none; icon before every label; (?) only with a description; chart items first and only when passed; Remove from report; Escape order; outside press.
- [ ] Commit: "Config menu: every data mart's fields in one menu".

### Task 5: Wire the config menu, drop the column badge (items 6, 6.8)

**Files:** modify `MartGrid.tsx`, `ChartsBody.tsx`, `charts/listMenu.ts`, `charts/menuSlot.ts`, `DataBand.tsx`, `ColumnPicker.tsx`, `badgeReserve.tsx` comments, `pending-focus.ts` comment, `menu-test-utils.ts`; migrate unit tests that open "Fields of …" or "Remove … from the grid", or use "Charts options".

- [ ] `DataBand`: the slot renders whenever the view switch does, not only in Charts.
- [ ] `MartGrid` builds `marts` from `groups` then `pathMarts`, and `joinable(path)` from `joinableUnder(tree, sources, path)` limited to accessible marts. Titles of path and joinable marts use `pathTitle(source, [...tree.nodes.keys()], sources)`; this also fixes two path marts of one data mart sharing a title. The tree is one memo shared with `pathMarts`. A mart's `fields` come from the sources at its exact path.
- [ ] Table mode: `MartGrid` portals `<ConfigMenu>` into the slot, also when the grid is `blocked`. Charts mode: it passes `renderConfig: (items?: MenuItem[]) => ReactNode` to `ChartsBody`, which renders it at one fixed place in its tree on every return path (fragment beside its `<tbody>`), without `chartItems` until the settings have loaded. The old Charts options button goes.
- [ ] Split `listItems` into `addChartItem` (the "Add chart" radio) and `chartListItem`: one `sub` entry labelled "Charts" whose submenu holds the scorecard, Sparklines and per-chart ticks, so anything hidden can be shown again. Add the `MenuItem` kind this needs: `{ kind: 'group'; label; icon; items: MenuItem[] }`. Order in the menu: Add chart, Charts, separator, data marts.
- [ ] Title cell: remove `ColumnPicker`'s badge and its ×. The mart's `remove` moves to the config menu. Delete `ColumnPicker.tsx` parts that are now unused and keep `MartRuleBadges` (move it to `MartRuleBadges.tsx`). Focus that used to go to a Columns button (after a removal, and `askFocusFor`) goes to `[data-config-button]`.
- [ ] A shared helper in `menu-test-utils.ts`: `openFields(martTitle)` opens the config button, hovers or clicks the mart's row and returns its dialog. Migrate the tests with it and keep every assertion about columns, order, locks, Undo and Count Unique. Update `chartChrome.test.tsx`.
- [ ] New tests: the button shows in Table and in Charts, with "Nothing to chart", and while the HAVING gate loads, where an open menu stays open; a path mart (Customers on the way to Countries) is listed after the shown ones and ticking its field adds the column; a joinable mart's field joins it, in one Undo step; two bare copies of one mart have different titles, in the config menu and in the chart menus.
- [ ] Commit: "Data band: the config menu replaces the column badges and the Charts menu".

### Task 6: Badge dropdowns end with Clear (item 6.9)

**Files:** modify `MartRuleBadges.tsx`, `ColumnMenu.tsx` (`RuleListMenu`), `badgeReserve.tsx`, `bands.css`; tests.

- [ ] Tests first: no × on filter and slice badges; the dropdown's last row, after a separator, is "Clear"; it removes every filter (or slice) of that data mart in one Undo step, closes the menu, and focus lands on the cell's other badge, else the config button. The other kind is untouched. Keyboard reaches Clear.
- [ ] `RuleListMenu` takes `onClear: () => void`. Remove the × width from `unfoldExtra` and the unused `.dm-rule-badge-x` rules when nothing else uses them.
- [ ] Commit: "Filter and slice badges: Clear in the list, no ×".

### Task 7: E2E and README

- [ ] Migrate e2e specs to the config button. Run the whole e2e suite once. `sankey.spec.ts:46` ("joined one-to-one") and `smoke.spec.ts:302` (filter tooltip) already fail on `main`: leave them, and report any other failure.
- [ ] New e2e: open the config menu in Table and in Charts; tick a field of a path mart and of a joinable mart; hover and click the (+) on a graph card.
- [ ] README: the parts that describe Fields buttons, the Charts menu, Remove, hover ghosts and the badge ×.
- [ ] Commit: "E2E and README for the config menu".
