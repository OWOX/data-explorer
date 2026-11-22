# Wave 8: dimmed wires, value suggestions, chart menus, scorecards

Spec: the user's 11-item list of 2026-11-22 plus their answers (quoted in Global Constraints). No separate spec file.

## Global Constraints

1. Users are business people without warehouse access. Never show technical names (storage table names, alias paths such as `visitor_entity.session_entity_new_sql`, SQL identifiers) in cards, titles, menus, tooltips or popups.
2. Charts never hide nulls. `(blank)` is drawn first (see `src/charts/blank.ts`).
3. Tests: `npx vitest run <files> --maxWorkers=4` (never unbounded). E2E: `npm run e2e -- <spec>` (already `--workers=1`). Run `npx tsc -b` before committing.
4. Lint has ~4786 errors on main already; do not try to fix those. Do not add new lint errors in files you touch.
5. Match the code style and comment style already in each file (comments are plain sentences explaining why).
6. User answers:
   1. Value suggestions: "loaded rows first, but when all values loaded - cache it during session, no re-fetch until user clicks reset".
   2. Chart field menus list fields of the marts in the report (main + joined), not marts that are not joined yet.
   3. Scorecard menu: pick any metric of this mart and the date field its sparkline uses, both saved per card.

## Task 1: Relationship lines dim with their target card

Files: `src/ui/bands/wires.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/MartsCanvas.tsx`, `src/ui/bands/bands.css`, tests in `src/ui/bands/wires.test.ts` / `look-rules.test.tsx`.

A wire's target is its `to` end (path has `data-to`). When the card with that id carries `.dm-faded`, the wire must be dimmed the same way: opacity 0.3 (same value as `.dm-node.dm-faded`). This applies in Grid (`#wires`) and Canvas (`#tree-wires`). Today wire classes come from `paintPlan` in `useWires`; card fading is computed separately (`fadedOf` in CardBands, `fadedAt` in MartsCanvas). Pass the set of faded element ids into `useWires` (new option, add it to the effect dependencies) and toggle a `faded` class on the carrier path whose `to` is faded. Add a CSS rule `#wires path.faded, #tree-wires path.faded { opacity: 0.3; }` placed after the `.relationship.joined/.ghost { opacity: 1 }` rule so it wins. A line that is hidden (opacity 0) stays hidden. Unit-test that the class is set and cleared; add a stylesheet assertion.

## Task 2: Value suggestions: input width, loaded rows first, session cache, reset

Files: `src/ui/explorer/ValueInput.tsx`, `src/ui/explorer/MenuParts.tsx` (Panel), `src/ui/explorer/ColumnMenu.tsx`, `src/ui/grid/MartGrid.tsx` (`valuesFor`), `src/filters/valueSuggest.ts`, `src/styles.css`, tests `ValueInput.test.tsx`, `valueSuggest.test.ts`, e2e `value-suggest.spec.ts`.

1. The suggestions popup (`Panel ... className="dm-suggest"`) must be exactly as wide as its input. Let `Panel` accept an option to match the anchor's width (set inline `width` from `anchor.getBoundingClientRect().width`); remove the fixed `19.6rem` width from `.dm-suggest` for this case.
2. Suggestions show at once from the distinct values of the rows already loaded in the grid for that column (no query), deduped, blanks excluded, narrowed by what is typed the same way server values are.
3. The existing server values read (top 50 distinct) still runs once; its values merge after the loaded ones (no duplicates).
4. Cache: once the server values for a column (same mart, field and other filters, i.e. the existing read key) are loaded, keep them for the browser session (module-level cache, not per open column menu), so reopening the menu does not query again.
5. Reset: the popup's last row is a "Reload values" action (a small row styled like `.dm-suggest-note`, with a `RotateCw` icon) shown only when the values came from the cache or the server. Clicking it drops that key from the cache and re-runs the read.

## Task 3: Chart menu look, icons, and shaded (blank)

Files: `src/ui/bands/bands.css`, `src/charts/ChartMenu.tsx`, `src/charts/kinds/*.tsx`, `src/charts/Scorecards.tsx`, `src/charts/blank.ts`, `src/charts/svg/BarChart.tsx`, `src/charts/svg/PieChart.tsx`, `src/charts/svg/Sankey.tsx`, `src/charts/charts.css`, related tests.

1. Chart ⋮ menu: no empty check column before icons. Action/submenu rows in the chart menu (`.dm-menu-root` of ChartMenu) must not reserve the check slot; the icon starts at the row's 16px padding. Radio choices keep their tick column.
2. Group heads in chart submenus (`.dm-menu-head`): no indent before the mart icon/title; left padding 16px, aligned with the row content start.
3. Icons: the grid uses `Sigma` for Aggregation and `Layers` for Slice. In chart menus use `Gauge` for Metric (every Metric item: time series, pie, other kinds, scorecards) and `ChartColumnStacked` for Stack by. Check `src/ui/icons.test.tsx` if it enumerates icons.
4. `(blank)` areas: shaded (a diagonal hatch: thin `--dm-blank`-coloured stripes on a transparent or `--card` background via an SVG `<pattern>`), with no border/stroke. Applies to bar rects, pie slices, Sankey nodes and legend swatches. Remove `blankOutline` stroke and the 1px `--dm-chart-frame` border for blank. Thin marks (lines) keep `BLANK_STROKE`. Keep it working in dark mode (pattern uses CSS vars). Each SVG chart needs the pattern defined once (a shared `<defs>` helper with a unique id per chart instance via `useId`).

## Task 4: Chart field menus: marts first, all fields, auto-add column

Files: `src/charts/ChartMenu.tsx`, `src/charts/menuGroups.ts`, `src/charts/fields.ts`, `src/charts/ChartsBody.tsx`, `src/charts/kinds/*.tsx`, `src/charts/kinds/types.ts`, `src/charts/listMenu.ts`, `src/ui/grid/MartGrid.tsx`, tests.

1. Nested menus: in every chart menu item that lists fields grouped by mart (Metric, Date field, Stack by, pie Dimension, and the equivalents in other kinds), the second level lists the data marts (mart icon + title, chevron), and a third level lists that mart's options. When only one mart has options, skip the mart level and list options directly (as today, without the group head). Ungrouped `options` (e.g. "No stacking") stay at the top of the second level. The mart that holds the current choice shows a tick. Extend `useSubmenu`/`Panel` usage in ChartMenu so a submenu can open its own submenu (keyboard: ArrowRight opens, ArrowLeft/Escape closes one level).
2. All fields: the options list every metric / date / dimension of the marts in the report (main + joined marts in the grid's groups), not only the visible grid columns. Same classification rules as `chartFields` (metrics: number, not id, not calculated; dates: `canBucket`; dimensions: string/boolean, not id).
3. Auto-add: choosing a field whose column is not shown adds it to the grid's shown columns (thread `changeColumns` from MartGrid into ChartsBody as a new prop, e.g. `onShowColumns(names)`), then the chart saves the choice as today. The chart must draw with the new field once the column is shown.

## Task 5: No technical names in titles

Files: `src/model/blendable.ts` (joined label), anywhere an alias path is shown: card titles/tooltips (`src/ui/bands/cards.tsx`), grid group headers (`MartGrid.tsx`), wire title tooltips (`CardBands.tsx`, `MartsCanvas.tsx`), chart menu group heads (`menuGroups.ts`), `SearchResults.tsx`. Tests next to each.

Where two joins reach the same mart, the label today appends `(<aliasPath>)`, e.g. `Country (organization_…)`. Replace it with the human path of mart titles, e.g. `Country (Organization)` (the parent mart's title; for deeper paths, titles joined with ` › `). Grep the code for any other place an alias path, storage table name or raw technical identifier reaches a visible string or a `title`/tooltip, and replace it with mart titles. Field labels keep `fieldLabel` (alias or name).

## Task 6: Scorecard menu: metric and sparkline date per card

Files: `src/charts/Scorecards.tsx`, `src/charts/settings.ts`, `src/api/chart-settings.ts` (`clean`), `src/charts/listMenu.ts`, `src/charts/ChartsBody.tsx`, tests (`Scorecards.test.ts`, `chart-settings.test.ts`).

1. Each scorecard's ⋮ menu has Metric (Gauge icon) listing every metric of that card's mart (all fields, not only visible; Records too when the mart has a primary key) and Date field (Calendar icon) listing that mart's date fields. Show Metric when there are 2+ choices, Date field when there are 2+ dates.
2. Persist the date per card: `scorecards.dates?: Record<cardId, fieldName>` in `ChartSettings`; extend `clean()`. The sparkline of that card uses its own date (fallback: current `sparkDate`). Since the sparkline query is per mart today, group cards by date when querying, or query per distinct date.
3. Choosing a metric or date that is not a shown column adds the column, through the same `onShowColumns` prop Task 4 adds.
