# Data Explorer: band layout

Date: 2026-11-15
Status: design approved in chat, awaiting spec review
Supersedes: the Canvas and Explore mode sections of `2026-11-14-data-explorer-design.md`. Everything else in that spec (platform facts, data loading, column filters, relationship columns, record loading, errors, mock mode, delivery) still holds unless this file says otherwise.

## Goal

Replace the node canvas and its tabs with the stacked-band layout of the Data Flow plugin (`/Users/flakss/Projects/data-flow`). One page, four bands top to bottom, one selection flowing down:

1. Data Sources
2. Data Marts (the data mart cards)
3. Data (always titled "Data"; the data marts are named on the grid's tabs)
4. Row

There is no Storages, Destinations or Reports band.

## Decisions taken in chat

1. No tabs. One mart and one record are shown at a time. Undo and Redo in the page header step through the history.
2. Sources are connectors only. A mart built from SQL, a table or a view has no source card.
3. The Data Marts band shows the selected mart plus every mart connected to it. There is no 12-mart cap and no relationship-level budget.
4. `@xyflow/react` and `@dagrejs/dagre` are removed.

## Page

1. **Page header**, as Data Flow's (`.dm-page-header`, `.dm-page-header-title`, paddings `1.5rem 3rem`, `1rem 1.25rem` below 640px; `.dm-page-content` `0 3rem 3rem`): the title "Data Explorer", then Undo and Redo icon buttons (lucide `Undo2`, `Redo2`, standard tooltip). There is no Refresh button. A failed storage or a failed model reload shows here, with Retry. There is no search box or context chip in the header.
2. **Bands.** Each band copies Data Flow's `Band` (`src/controls.tsx`) and its `.dm-band*` styles. It has an icon tile, a title, a count badge, an (i) hint and a fold chevron, and its body is a `.dm-band-grid` (`grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr))`, gap `0.85rem`). Folding is per band. Data Sources starts folded and the others open; the member's choice is saved on each click in the member-scope collection `preferences`, document `bands`, value `{ folded: { [bandId]: boolean } }` (`band-sources`, `band-marts`, `band-data`, `band-row`), and read once at start. A failed read or write logs a warning and keeps the defaults or the current state.
3. **Lines.** One absolutely positioned SVG over the Sources and Data bands draws a bezier per pair of card boxes. It redraws from the live element boxes on resize and whenever the grid reflows (a `ResizeObserver` on both grids). The approach copies Data Flow's `src/wires.ts`; only the two line kinds below are drawn.
   1. Source to mart: solid, from a source card to each visible mart it feeds.
   2. Relationship: dashed, between two visible mart cards. The tooltip names the join (`customer_id → id`).
   3. Hovering a card raises its own lines and fades the rest. The selected mart's lines stay raised.

## 1. Data Sources band

1. **Data.** `ctx.owox.dataMarts.list()` items carry `definitionType` and `connectorSourceName`. `GET /api/connectors` returns `{ name, title, logo }[]`. A source is one distinct `connectorSourceName` among accessible marts. Its card shows the connector's `logo` (a URL) or a `Plug` icon fallback, its `title` (or the raw name), and a badge "N data marts".
2. Marts whose `definitionType` is not `CONNECTOR`, or that have no `connectorSourceName`, belong to no source.
3. If `/api/connectors` fails, cards fall back to the raw name and the `Plug` icon. The band shows no error for this.
4. Order: by data mart count, descending, then by name.
5. **Click.** Clicking a source selects it; clicking the selected source clears it. The selected card gets the Data Flow selected border.
6. With no source selected, every source card shows. Search and context chips do not filter this band.
7. Empty state: "No connector-based data marts." The band stays, folded by default.

## 2. Data Marts band

### Which marts show

Rules apply in order; the first that matches decides.

1. **Search or context filter active.** Marts whose title contains the search text (case-insensitive; context names and field names are not searched) and that have any selected context badge (none selected is no context filter). With a source selected, only that source's marts. Cards show no field-match line.
2. **Mart selected.** The selected mart plus every mart with an edge to or from it, plus every selected joined mart and every mart with an edge to or from any selected joined mart (see "Several data marts selected"). Lines are drawn between all shown connected cards; the neighbours of a selected joined mart are lit like the main one's, not dimmed.
3. **Source selected, no mart selected.** Every mart the source feeds.
4. **Nothing selected.** Cannot happen after load: on first load the selected mart is the focus mart (most inbound edges, ties to the alphabetically first title) and the band follows rule 2.

Selecting a source clears the selected mart. Selecting a mart keeps the selected source only when the source feeds that mart; otherwise the source is cleared.

Inaccessible marts appear only as connected marts of a selection and use today's muted "No access" card. Clicking one does nothing in the Data band (it shows "You do not have access to this data mart").

### Order

Selected (main) mart first, then the selected joined marts in the order they were added, then the rest breadth first over the edges starting from them (a mart's unplaced neighbours follow it, so linked marts sit near each other), ties by inbound edge count descending, then title; marts no edge reaches follow by the same rank. Cards keep their transitions.

### Several data marts selected, one main

1. **State.** The selection is a main mart plus zero or more joined marts. The joined ones are derived: a mart is selected-joined exactly when at least one of its joined fields is a visible column of the main grid, in the order of first appearance (the order added). The Fields picker and the cards are two views of this state. A search, a context or a storage narrowing never deselects one, and a selected joined mart is always shown.
2. **Joinability** comes from the main mart's blendable schema (`joinedSources`), read when a mart becomes main (not only when the picker opens), once per mart per session, cached, not billed. A mart reachable by several alias paths uses the shallowest source, then the first.
3. **Card click, not selected and joinable to main:** its fields are added after the visible columns: the list last chosen for this (main, mart) pair, else the first STRING field that is not an ID plus the first number field that is not an ID (no such text: the first text field; no metric: the text alone; no text: the first two non-ID fields; an ID is a primary key, a name equal to `id` or ending in `_id`/`Id`, or an alias ending in " ID", any case), else its first field. **Selected joined mart:** its columns, filters and sorts leave the grid and its field list is remembered for the pair in `grid-columns` as `picks` (`{ <martId>: string[] }`, saved with the grid's columns); an empty list means the first text field next time. **Main mart:** it is deselected; the next selected joined mart becomes main with its own saved or default grid plus, for each other previously selected joined mart it can join, that mart's remembered or first field (ones it cannot join are deselected); with none, nothing is selected, the Data band says "Select a data mart." and the Row band clears (the first load's pick does not come back: `selection.cleared`). **Not joinable to main, or no main:** it becomes the main mart and the only selected one. Unticking a joined mart's last field in the picker deselects it (and remembers an empty list); ticking a field of an unselected source selects it. New picker columns of a joined mart are appended in the order added; the mart's own fields keep the schema order.
4. **Display.** The main card keeps the selected style. A selected joined card has a dashed, tinted border and a small "+" mark, `aria-pressed` true, and its join lines are raised like the selected card's. The Data band title is `<main> + <joined> + ...` on one line with an ellipsis.
5. **Undo and Redo** cover these changes: a history entry may carry the grids a step changed (`setMarts`), which Undo and Redo put back. The whole grid snapshot of each touched mart is restored: filters, sorts or columns the member set after the step are discarded by its Undo. Columns adopted this way are saved to `grid-columns` like any other change. Card clicks run one at a time, each planned on the grid the one before left; a click on a mart the main one cannot join also takes the joined columns it was left with out of its grid (remembering them per pair). Following "Referenced by" and the other navigation work as before.
6. **Column order.** One pure function, `orderColumns(columns, sources)` (`src/state/column-order.ts`), puts a mart's columns together: the main mart's own columns first in their current order, then each joined mart's columns in the order the marts first appear (the order added), each group keeping its fields' order. It is applied wherever columns change: a card click (`planClick`), a Fields picker tick, a restore of saved columns and Undo or Redo. The grid, Export (Sheets, AI prompt) and Copy to clipboard all use the ordered list. The first data mart in the grid is always the main one: the picker keeps the last own column of the main mart ticked while a joined mart is shown.
7. **Tabs (group row).** The table head always has a first row with one `th` (`scope="colgroup"`, `colSpan` = the mart's visible columns) per data mart: its icon and title, main first. With only the main mart it is one tab spanning every column, with no x. Both head rows sit in the same sticky `thead`; only the column-title row carries the header line (the bottom shadow). A group after the first has a left divider. Inside a group the column title drops the `<mart> · ` prefix (the sort button's accessible name and the filter name keep it); Export and Copy headers keep `<mart> · <field>`.
8. **Remove button.** Hovering or focusing a group title shows a small x after it (tooltip "Remove <title> from the grid", `aria-label` the same). It runs the card click for that mart, through the same serialised queue: on a joined group its columns, filters and sorts go and its picks are remembered; on the main group the main mart is deselected and the next selected mart is promoted, so its group becomes the first. Undo and Redo cover it like any card click. On touch devices the x stays visible.
9. **Fields on the tab.** There is no Columns button in the Data band toolbar. Each tab has a Fields icon after its title (before the x), labelled `Fields of <mart>` and with the tooltip `Fields`, opening a picker titled `Fields · 5/23` scoped to that mart's fields (the main tab: its own; a joined tab: its blended fields, over every alias path). The picker has no joined groups; marts are added from the Data Marts band. Unticking a joined mart's last field deselects it; the main tab's picker keeps its last own column while a joined mart is shown.
10. **Always shown.** The Data Marts band shows every mart with a column on the grid or a filter (live or parked) on one of its fields, whatever the search, context or storage filters, after the selected joined ones. The main mart is shown whatever the search or context (a storage it is not in still takes it out).
11. **Filter mark.** A column with a filter shows only the filled funnel (Material Symbols `filter_alt`, Apache-2.0, inlined) in the primary colour; its tooltip says "Filter: <description>". The unfiltered hover icon is the outline funnel.
12. **Remembered fields.** Whenever a mart leaves the grid (a card deselect, a group x, its last field unticked, a promote that drops it, a mart made main alone shedding it, a new main replacing the old one, a source picked or a followed link that leaves the main) its shown fields are stored as its OWN field names (a joined column maps back through `originalFieldName`), in order, as `lastShown` in its own `grid-columns` document (`ColumnStore.saveLastShown`). As a joined mart it returns with those names mapped to the blended names of the source the main joins it through (fields the source lacks are skipped; none left means the two-column default). As the main mart its columns are exactly those names (those its schema still has), and the memory is kept (making a mart main erases nothing, so Undo has nothing to restore; the memory is rewritten when the mart next leaves). A joined mart promoted to main takes the fields it showed as joined, as its own columns; joined marts in its own older saved grid are dropped from it, and are not remembered from that stale grid (only marts that were on screen are remembered, and what the screen showed is never overridden). Most recent wins. A grid-columns document that could not be read is never written over. Per-pair `picks` remain the fallback when no `lastShown` exists. Undo and Redo are unchanged.
13. A folded Data band reads nothing: a change made while it is folded (a joined mart added) is read once, when it opens.

### Card

Today's `MartCard` content in Data Flow's `.dm-node` style: icon tile, title, OWOX link, (i) description, row-count badge, data quality icon with the tone border, freshness icon. Click selects the mart.

### Row counts

Counts run for visible accessible cards through the existing pool (4 at a time) and cache (`row-counts`). With no cap on the band, a hub mart can show dozens of cards, so counts stay lazy: a card asks for its count only once it is in the viewport (`IntersectionObserver`).

## 3. Data band

1. Title: "Data", with the selected mart's icon. Count badge: the loaded row count (`200+ records`, `1 record`). The Data Marts band uses the lucide `Box` icon; its cards say `11.1K records`.
2. Body: the mart's grid: column picker (first 5 fields by default, fields hidden for reporting never offered), per-type filter popovers, Reset, Refresh, Load more, preview-only banner for marts without a primary key, error with Retry. Values show as stored: no title lookup, no link. A cell is one clipped line (`overflow: hidden; text-overflow: ellipsis; white-space: nowrap`, at most 24rem for text, 12rem for numbers and booleans, 16rem for dates), with the full value in the standard tooltip when it is cut; the line under the header always spans the card. A filter popover is at most 20rem tall and never taller than the room left, scrolls inside, and keeps its title row at the top.
3. **First load.** The page shell draws at once: every band header, and in place of each body a progress bar (`.dm-loadbar`, `role="progressbar"`, `aria-valuenow` 0 to 100) that fills one step per finished read (storages, data marts, contexts, connectors, then a canvas read and an edge read per storage, then the saved band folds), turns pale green when full, and is replaced by the bodies after a short hold. Nothing in the Data and Row bands reads until then.
4. **Joined columns.** `GET /api/data-marts/:id/blendable-schema` is read once per mart per session, when the mart becomes the main one; a failure shows only the own fields and a muted note, and a saved joined column is then left out of that visit without being erased. The picker lists the own fields, then one group per joined source with `isIncluded && isAccessibleForReporting` (hidden and calculated fields skipped), folded by default, labelled with the joined mart's icon and its display prefix (the alias path is added when two sources reach the same mart), with `ticked/total` on its header; shallow sources first, then by title. A field hidden for reporting is offered nowhere (a mart whose key is hidden is preview only, and a Referenced by link on a hidden join field is not listed). A joined field never repeats the main mart's rows: the backend aggregates a one-to-many joined field into one cell, shown as its values joined with ", " (an array value) or as it comes (a string). A ticked joined field is a column named by its blended name (`customers__email`), headed `<joined mart> · <field>` with the joined mart's icon; it filters (by its `type`), sorts, is saved in `grid-columns`, goes into `column`, `filter` and `sort` of the rows query, and into `columnConfig`, `filterConfig`, `sortConfig` and `autoAggregationOptOut` of an export. A saved blended name the schema no longer offers is dropped and the cleaned list saved. The Row band shows the mart's own fields only.
5. The grid's state (columns, filters, sorts, limit) is kept per mart for the session, so going back to a mart restores it.

   1. **Default sort.** With no sorts set (none saved in the session and none set by the member), rows load newest first by the first DATE, DATETIME or TIMESTAMP field, preferring one among the visible columns, else the first in schema order. It shows with the arrow like a member sort when its column is visible, Export sends it like any sort, and Reset returns to it. A member's first click starts from the default only if its column is on screen.
   2. **Loading.** While rows load (first load, Refresh, filter or sort change, Load more) an indeterminate bar as wide as the card sits on the card's top border. The skeleton shows for the very first load only.
   3. **Values.** DATE shows as a calendar day in the viewer's locale (`dateStyle: medium`, no time-zone shift). TIMESTAMP and DATETIME show in the viewer's locale and time zone (`dateStyle: medium, timeStyle: short`). The stored value is in the tooltip, and an unreadable value shows raw. The same applies in the Row band.
   4. **Labels.** A field shows its alias only (its name when it has none). A field with a description shows a (?) after the label with the description in the shared tooltip, in the column picker and in the Row band.
4. Clicking a row of a mart with a primary key opens it in the Row band.
5. With no mart selected (an empty project), the band shows "Select a data mart."

### Copy to clipboard

The first group of the Export menu is one item, "Copy to clipboard" (lucide `ClipboardCopy`), above the destinations and the AI group, with the same arrow-key behaviour as the other first-level items (the destination flyout keys apply to destination rows only, found by `data-dest`).

1. Source: the rows the grid has loaded (`useMartRows`), in grid order, so the grid's filters and sorts apply. No query is made and nothing is billed or written.
2. Columns: the visible columns in grid order, joined ones included. The header row is `columnTitle` of each field (alias, or `<joined mart> · <field>`).
3. Format: `buildTsv` in `src/export/tsv.ts` (pure): tab-separated, `\n` between lines, no trailing newline. A cell's text is `displayText(value, type)` from `src/ui/format.ts`, the function the grid's cells render with: DATE, DATETIME and TIMESTAMP in the viewer's locale and time zone, other values as stored, null as empty, arrays joined with ", ", objects as JSON; never clipped. Each run of tab, CR and LF inside a value becomes one space.
4. Clipboard: `copyText` (async API, then the hidden textarea and `execCommand`, restoring focus). If both fail, a "Copy the data" dialog (the prompt dialog's component) shows the text read-only, selected on focus, with a Copy button.
5. Status: "Copied N rows"; with `hasMore` "Copied the first N rows. Load more to copy more." No rows: the item is disabled with the tooltip "No rows to copy".

### Export to Google Sheets

The plugin's only writes: creating a spreadsheet, creating or updating the member's export report, and running it. Each follows the member's own click; that is the plugin's own discipline, as the SDK README asks, not something the SDK enforces. Rows are never written.

1. The header toolbar of the Data band has an Export control next to Columns. Destinations come from `ctx.owox.destinations.list()` (`GET /api/data-destinations`), kept where `type === 'GOOGLE_SHEETS'` and `availableForUse` is not false. They are read once per session and again when the model reloads (Retry). With none, or when the list fails (a warning is logged), the menu lists no destination.
2. Export's icon is lucide `ArchiveRestore` (the OWOX web app's destination icon); the Google Sheets icon stays on the destination rows in the menu. The control is always a cascading menu, because the AI group is always there: the first level lists the destinations (icon and title; one destination still shows), then an "AI" group; hovering, clicking, ArrowRight or Enter on a destination opens a flyout to the right (left when there is no room) with `Update "<title>"` rows and `New report…`; Escape closes a level. "New report…" asks for a title and a target; a new spreadsheet is made by `POST /api/data-destinations/:id/google-sheets/documents`, the report by `POST /api/reports`, run by `POST /api/reports/:id/run`, and `https://docs.google.com/spreadsheets/d/<id>/edit#gid=<sheetId>` opens. If the spreadsheet cannot be created, the dialog stays open with the message and the pasted-link option. If the report step fails after a spreadsheet was made, the dialog stays and a retry reuses that spreadsheet; if it fails with the SDK `TIMEOUT` or `NETWORK_ERROR` code or an HTTP 502/504 the report may exist, so the dialog closes and the header says "The report may have been created; check OWOX before trying again."
3. Otherwise a menu in the style of the Data band's filters. With two or more destinations the first level lists them; each opens its submenu (one destination shows it directly). A submenu has "Update '<title>'" for each remembered report on that destination (`PUT /api/reports/:id`, then run) and "New report…", a dialog with the title (prefilled) and a target: a new spreadsheet or a pasted link (`/spreadsheets/d/<id>/`, `#gid=<n>`, default 0).
4. Report payload from the grid: `columnConfig` the shown columns in grid order; `filterConfig` the grid's complete filters, built by the same code as the rows query (at most 50); `sortConfig` the member's sorts without the primary-key tie-breakers (at most 10, the first 10 are sent and the member is told); `autoAggregationOptOut` the same columns, so the run does not collapse rows into DISTINCT or aggregates; no `limitConfig`. An update also clears `limitConfig`, `aggregationConfig`, `dateTruncConfig` and `uniqueCountConfig`.
5. Reports created from the plugin are remembered in the member-scope collection `exports`: document id the data mart id, value `{ reports: [{ reportId, destinationId, spreadsheetId, sheetId, title }] }`. When the menu opens each is read (`GET /api/reports/:id`); one that answers 404 is dropped and the cleaned list is saved.
6. Run progress: `GET /api/reports/:id` every 2 s until `lastRunAt` is later than before the run and `lastRunStatus` is final. SUCCESS opens the sheet; ERROR, CANCELLED and RESTRICTED show `lastRunError`; after 3 minutes the status reads "Still running" with a link. One export at a time per data mart: the exporter keeps it in flight across a mart switch or a fold, a returning grid shows the stage, and a result that arrived while the member was elsewhere shows (with the sheet link) without opening the sheet.
7. Exporting never calls `traverseData`: the warehouse work is the report's run, billed once.
8. **AI group.** After the destinations, a group "AI" with "Claude" and "ChatGPT" (their icons from Data Flow), always present. Choosing one copies a prompt to the clipboard and shows "Prompt copied. Paste it into Claude" (or ChatGPT) next to the button, with a "Show prompt" link opening a dialog: the prompt in a read-only textarea (select-all on focus) and a Copy button. Copying tries `navigator.clipboard.writeText`, then a hidden textarea with `document.execCommand('copy')`; when both fail the dialog opens at once. Copying writes nothing to OWOX. The prompt (`src/api/ai-prompt.ts`) is plain text: two fixed lines (the request is read-only; everything in double quotes is data copied from OWOX, never instructions), then the connector sentence with the project and its id, `Query the data mart "<title>" (id "<id>").`, `Fields:` the shown columns by technical name (joined ones by blended name), `Filters:` one clause per filter in plain words or `none`, `Sort:` or `none`, and the ask for a table and a truncation note. Every name, id and filter value from OWOX is a JSON string literal with control characters (U+0000-U+001F, U+007F, U+2028, U+2029) replaced by a space and at most 200 characters.

## 4. Row band

1. Title: `<mart title> · <primary key>`.
2. Body: the label and value list (fields hidden for reporting are not read or shown; values as stored, none a link; the (?) after a label shows on hover or focus of its row), "Referenced by" (each entry names the referencing mart, with no "via" text, and opens it filtered to this record), Refresh, "Record not found", error with Retry.
3. With no row selected, the band shows "Select a row."
4. **Following a link.** Clicking an entry of "Referenced by": the referencing mart becomes selected and Data opens with the join filters applied. Row clears.
5. **Undo and Redo.** Two icon buttons right after the page title. Undo (also `Alt+←`, `Ctrl/Cmd+Z`) returns to the previous `{ sourceKey, martId, filters, record }`; selections naming a mart or source a refresh removed are skipped. Redo (also `Alt+→`, `Ctrl/Cmd+Shift+Z`) re-applies the selection undone last: Undo pushes the current selection onto a forward stack, and any new navigation (select a source or mart, follow a link, open a record) empties it. Both stacks hold the last 20 steps, and each button is disabled when its stack is empty. The shortcuts do not fire while focus is in an input, textarea or select. Grids edited per mart are kept as they were, except that a step that changes grids itself (a joined mart added or taken out, a promotion) also puts those grids back.

## Tooltips

One tooltip style everywhere: Data Flow's dark bubble (`.dm-hint-body`), drawn by the shared `Tooltip` in a portal on the body, so no card, line or band paints over it, and kept 8px inside the viewport. It serves the band (i) hints, a card's description and status marks, the contexts chip, the column (i) and (?) hints, sort-title and truncated-title hints, the Open in OWOX link and Undo and Redo. The lines between cards say what they join in the same bubble, at the pointer. Native `title` attributes are not used for hints.

## Date filters

For DATE, DATETIME and TIMESTAMP columns the filter popover opens on a preset list: Today, Yesterday, Last 7, 14, 30 and 90 days, This week, Last week, This month, Last month, This quarter, Last quarter, This year, Last 12 months. A preset applies at once and closes the popover; the active one is highlighted on reopening and the column's filter control shows its name. They map to the `relative_date` filter (`today`, `yesterday`, `last_n_days` with n 7, 14, 30 or 90, `this_week`, `last_week`, `this_month`, `last_month`, `this_quarter`, `last_quarter`, `this_year`, `last_n_months` with n 12); weeks are ISO weeks (Monday first), as the API defines them. "Last N days" takes any N up to 3650. Below that, "Custom range…" (from and to, `between`), a divider, and On (DATE only), Before, After, Is blank and Is not blank. Export sends the same relative rule, so the report stays relative. Columns holding a time of day have no presets.

## Selection state

The store drops `tabs`, `activeTabId` and `explore`. It holds:

```ts
type Selection = { sourceKey: string | null; martId: string | null; record: { martId: string; key: Record<string, unknown> } | null; filters?: ColumnFilter[]; cleared?: boolean };
type Entry = Selection & { grids?: Record<string, GridState | null> };
type State = { selection: Selection; history: Entry[]; future: Entry[]; search: string; contextIds: string[]; storageIds: string[] | null; grids: Record<string, GridState>; modelVersion: number };
```

`GridState` is `{ columns, filters, sorts, limit }`; `sorts` is null until the member sets one (the default sort applies).

## Refresh

The page header has no Refresh. The model (marts, edges, contexts, connectors, data quality) loads when the plugin opens; reopening the plugin reloads it. The Data band's Refresh re-runs the grid and the Row band's Refresh re-reads the record. Retry in the header (after a storage failed to load) reloads marts, edges, contexts, connectors, data quality and the visible row counts, and re-runs the Data grid and the Row record. If a reload fails, the previous model, counts and data quality stay on screen, and the error shows in the header with Retry. A count already shown is never replaced by a spinner that cannot finish.

## Removed

1. `src/ui/canvas/Canvas.tsx`, `src/graph/layout.ts` (dagre, side arcs), `src/graph/visible.ts` level BFS and `hiddenMatches`, the "+N more" pill.
2. `src/ui/explorer/TabBar.tsx` and tab reducer actions.
3. Dependencies `@xyflow/react`, `@dagrejs/dagre`.

## Errors

Each band shows its own error where its content would be, with Retry. A connectors failure degrades silently (see Data Sources 3). One failure never blanks the page.

## Mock mode

Fixtures gain `definitionType` and `connectorSourceName` per mart (about half the marts on 3 connectors: Facebook Ads, Shopify, Google Analytics 4), and `GET /api/connectors` returns those three with no logo, so the fallback icon shows.

`GET /api/data-marts/:id/blendable-schema` is built from the fixture edges: a mart's outgoing links and theirs, two hops deep (Orders reaches Customers, Products and Stores, then Categories and, twice, Countries), all `isIncluded` and accessible with `mainGrainMultiplication: 'none'`, a field's blended name being the alias path with dots as `__`, then the field (`customers__email`). `traverseData` resolves a blended name in `column`, `filter` and `sort` by following the links; a row whose key is null joins to null. Reference fields carry aliases (Customer, Product, Store, Order, Category, Country), so no header shows an `_id`; products have names and SKUs, stores a city, customers an email and a city, and Orders an Acquisition Session ID long enough to be clipped.

## Testing

1. Unit (Vitest, at most 4 workers; also the blendable-schema read and its sources, the mock's blended columns, and the load bar's steps):
   1. Source grouping: per connector, skipping non-connector marts, counts and order, connectors fallback.
   2. Visible marts for each rule above, including the selected-mart-plus-connected case with an inaccessible neighbour and the source-clears-on-mart-select rule.
   3. Selection reducer: select source, select mart, follow link to a record, follow link to a filtered mart, back, history limit 20.
   4. Refresh failure keeps counts and data quality.
2. Smoke (Playwright, mock mode): first load selects the focus mart and shows its rows; clicking a source narrows Data Marts; clicking a row fills Row; clicking a "Referenced by" entry moves the selection; Undo restores it and Redo re-applies it; a filter and Reset work; the column picker changes columns.

## Delivery

Unchanged. `plugin.json` stays as it is.

## Column aggregation

Ported from the OWOX web app's report column picker (`AggregationEditorPopover`, `applyAggregationDraft`, `aggregation-governance`, `aggregation-labels`) and the `traverseData` contract (`aggregation`, `dateTrunc`, row keys `"<column> | <TOKEN>"`). Pure code is in `src/model/aggregation.ts`, the mock grouping in `src/sdk/mock/aggregate.ts`, the popover in `src/ui/explorer/AggregationPopover.tsx`.

1. **Control.** A Sigma icon on a column title (on the first output of a column that has several), shown on hover or focus and kept on in the primary colour while the column has a rule. The popover lists the field's allowed functions (multi-select, each its own output), and for DATE, DATETIME and TIMESTAMP a bucket (Day, Week, Month, Quarter, Year) with an optional time zone (only types with a time of day). Functions and a bucket exclude each other. Governance: a joined field uses its post-join set when the blend carries one (`[]` is none), else a field's own `allowedAggregations` narrowed to what its type supports, else the category defaults (number: Sum, Average, Min, Max; text: Count, Count Unique, Combined, Sample; date and time: Min, Max; boolean: Count, Count Unique; other and calculated: none, the backend refuses them with ARRAY_FIELD_OUTPUT_CONTROL_UNSUPPORTED, AGGREGATION_ON_CALCULATED_FIELD and DATE_TRUNC_TIMEZONE_ON_CALCULATED_FIELD, so those fields have no Sigma).
2. **Grouped mode.** Any function or bucket on a visible column makes the query grouped: `column` is exactly the visible columns in grid order, `aggregation` and `dateTrunc` carry the rules, every other column is a group key. No primary key is added and no key tie-breaker sort is sent. Each function is one output column titled `<column title> · <Label>`; the cell is the row key `"<column> | <TOKEN>"` (tokens as the backend: `COUNT_DISTINCT` is `COUNTUNIQUE`, `P50` is `MEDIAN`, `STRING_AGG` is `STRINGAGG`, `ANY_VALUE` is `ANYVALUE`, dots in the column become `_`). A bucketed date shows its bucket start by the bucket.
3. **Rows.** Rows are not clickable in grouped mode; the Row band says "Grouped rows have no single record."; the Data band badge reads "N groups" (or "200+ groups"); the preview-only banner is not shown.
4. **Sorting.** The backend resolves a sort rule on an aggregated column to the alias of its first function, and accepts a sort naming any projected column in the aggregated shape, so a sort is `{ column: <source column> }`. Only the first function of a column has the sort control; group keys sort as before. With no sort of the member's own a grouped grid sorts ascending by its first group key (a column with no function), so "Load more" pages are stable.
5. **Filters** stay WHERE filters on the raw rows (no `function`); the popover of an aggregated column says so.
6. **Export.** Sheets reports carry `aggregationConfig` and `dateTruncConfig` (the same rules) and `autoAggregationOptOut` for the columns with no function (auto-collapse stands down when a rule exists, so the sheet has the grid's rows). Copy to clipboard copies the grouped table as shown, headers `<mart> · <field> · <Label>`. The AI prompt adds an "Aggregations (group by every other field)" block in words.
7. **Saved.** `GridState` and the `grid-columns` document gain `aggregations` and `dateTrunc`; rules for columns no longer visible are dropped (also when a joined mart leaves); a card click and Undo or Redo carry them with the grid snapshot; Reset clears filters and sorts, not aggregations.
8. **Ungroupable columns.** Mirror of the web's auto-collapse `non-groupable-column` rule. A shown column of category `other` (array, JSON, struct, geography) has no rule and would be a GROUP BY key, so while one is shown in a grouped grid no query is sent; the grid says `"<title>" can't be grouped: hide it.`, the badge and Export are off, and the Apply of another column's popover is off with the same note. Rules a saved grid, a `grid-columns` document or a view link holds that the field cannot take (a function not in `allowedFunctions`, any rule on a calculated field, a bucket on a non-date, a time zone on a DATE, a bucket next to functions) are dropped on load; link drops count in `skipped.aggregations`. Time zones are checked against the backend's IANA pattern `^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*$` and a 64 character cap.
9. **Reading rows.** The loaded rows are kept only for a query of the same shape: grouped rows are never shown under another set of group keys or under plain rows (the grid shows its skeleton, no badge, until the new rows arrive), and in grouped mode a shorter column list is re-read, not trimmed.
10. **Mock.** `traverseData` implements every function and the buckets, grouping by the other columns, with the API's keys.
