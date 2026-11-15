# Data Explorer: band layout

Date: 2026-11-15
Status: design approved in chat, awaiting spec review
Supersedes: the Canvas and Explore mode sections of `2026-11-14-data-explorer-design.md`. Everything else in that spec (platform facts, data loading, column filters, relationship columns, record loading, errors, mock mode, delivery) still holds unless this file says otherwise.

## Goal

Replace the node canvas and its tabs with the stacked-band layout of the Data Flow plugin (`/Users/flakss/Projects/data-flow`). One page, four bands top to bottom, one selection flowing down:

1. Data Sources
2. Data Marts
3. Data
4. Row

There is no Storages, Destinations or Reports band.

## Decisions taken in chat

1. No tabs. One mart and one record are shown at a time. A back button steps through the history.
2. Sources are connectors only. A mart built from SQL, a table or a view has no source card.
3. The Data Marts band shows the selected mart plus every mart connected to it. There is no 12-mart cap and no relationship-level budget.
4. `@xyflow/react` and `@dagrejs/dagre` are removed.

## Page

1. **Header** (unchanged): search box, context chips, Refresh. A failed storage or a failed refresh shows here, as now.
2. **Bands.** Each band copies Data Flow's `Band` (`src/controls.tsx`) and its `.dm-band*` styles. It has an icon tile, a title, a count badge, an (i) hint and a fold chevron, and its body is a `.dm-band-grid` (`grid-template-columns: repeat(auto-fill, minmax(14rem, 1fr))`, gap `0.85rem`). Folding is per band and lives in component state.
3. **Lines.** One absolutely positioned SVG over the Sources and Data Marts bands draws a bezier per pair of card boxes. It redraws from the live element boxes on resize and whenever the grid reflows (a `ResizeObserver` on both grids). The approach copies Data Flow's `src/wires.ts`; only the two line kinds below are drawn.
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

1. **Search or context filter active.** Marts matching the search (title, context names, field names and aliases) and any selected context. With a source selected, only that source's marts. A field match shows the matching field name on the card, as today.
2. **Mart selected.** The selected mart plus every mart with an edge to or from it.
3. **Source selected, no mart selected.** Every mart the source feeds.
4. **Nothing selected.** Cannot happen after load: on first load the selected mart is the focus mart (most inbound edges, ties to the alphabetically first title) and the band follows rule 2.

Selecting a source clears the selected mart. Selecting a mart keeps the selected source only when the source feeds that mart; otherwise the source is cleared.

Inaccessible marts appear only as connected marts of a selection and use today's muted "No access" card. Clicking one does nothing in the Data band (it shows "You do not have access to this data mart").

### Order

Selected mart first, then the rest by inbound edge count descending, then title.

### Card

Today's `MartCard` content in Data Flow's `.dm-node` style: icon tile, title, OWOX link, (i) description, row-count badge, data quality icon with the tone border, freshness icon. Click selects the mart.

### Row counts

Counts run for visible accessible cards through the existing pool (4 at a time) and cache (`row-counts`). With no cap on the band, a hub mart can show dozens of cards, so counts stay lazy: a card asks for its count only once it is in the viewport (`IntersectionObserver`).

## 3. Data band

1. Title: the selected mart's title and its icon. Count badge: the loaded row count (`200+ rows`), as today.
2. Body: today's `MartTab` grid unchanged — column picker (first 5 fields by default), per-type filter popovers, Reset, Refresh, Load more, related titles in link columns, preview-only banner for marts without a primary key, skeleton preloader, error with Retry.
3. The grid's state (columns, filters, limit) is kept per mart for the session, so going back to a mart restores it.
4. Clicking a row of a mart with a primary key opens it in the Row band.
5. With no mart selected (an empty project), the band shows "Select a data mart."

### Export to Google Sheets

The plugin's only writes: creating a spreadsheet, creating or updating the member's export report, and running it. Each follows the member's own click; that is the plugin's own discipline, as the SDK README asks, not something the SDK enforces. Rows are never written.

1. The header toolbar of the Data band has an Export control next to Columns. Destinations come from `ctx.owox.destinations.list()` (`GET /api/data-destinations`), kept where `type === 'GOOGLE_SHEETS'` and `availableForUse` is not false. They are read once per session and again on the header's Refresh. With none, or when the list fails (a warning is logged), the control is not rendered.
2. One destination and no remembered report for the mart: a plain button. One click makes a spreadsheet (`POST /api/data-destinations/:id/google-sheets/documents`), the report (`POST /api/reports`), runs it (`POST /api/reports/:id/run`) and opens `https://docs.google.com/spreadsheets/d/<id>/edit#gid=<sheetId>`. If the spreadsheet cannot be created, the "New report" dialog opens with the message and the pasted-link option. If the report step fails after a spreadsheet was made, the dialog stays and a retry reuses that spreadsheet; if it fails with the SDK `TIMEOUT` or `NETWORK_ERROR` code or an HTTP 502/504 the report may exist, so the dialog closes and the header says "The report may have been created; check OWOX before trying again."
3. Otherwise a menu in the style of the Data Marts band's filters. With two or more destinations the first level lists them; each opens its submenu (one destination shows it directly). A submenu has "Update '<title>'" for each remembered report on that destination (`PUT /api/reports/:id`, then run) and "New report…", a dialog with the title (prefilled) and a target: a new spreadsheet or a pasted link (`/spreadsheets/d/<id>/`, `#gid=<n>`, default 0).
4. Report payload from the grid: `columnConfig` the shown columns in grid order; `filterConfig` the grid's complete filters, built by the same code as the rows query (at most 50); `sortConfig` the member's sorts without the primary-key tie-breakers (at most 10, the first 10 are sent and the member is told); `autoAggregationOptOut` the same columns, so the run does not collapse rows into DISTINCT or aggregates; no `limitConfig`. An update also clears `limitConfig`, `aggregationConfig`, `dateTruncConfig` and `uniqueCountConfig`.
5. Reports created from the plugin are remembered in the member-scope collection `exports`: document id the data mart id, value `{ reports: [{ reportId, destinationId, spreadsheetId, sheetId, title }] }`. When the menu opens each is read (`GET /api/reports/:id`); one that answers 404 is dropped and the cleaned list is saved.
6. Run progress: `GET /api/reports/:id` every 2 s until `lastRunAt` is later than before the run and `lastRunStatus` is final. SUCCESS opens the sheet; ERROR, CANCELLED and RESTRICTED show `lastRunError`; after 3 minutes the status reads "Still running" with a link. One export at a time per data mart: the exporter keeps it in flight across a mart switch or a fold, a returning grid shows the stage, and a result that arrived while the member was elsewhere shows (with the sheet link) without opening the sheet.
7. Exporting never calls `traverseData`: the warehouse work is the report's run, billed once.

## 4. Row band

1. Title: `<mart title> · <primary key>`.
2. Body: today's `RecordTab` (label and value list, related titles as links, "Referenced by", Refresh, "Record not found", error with Retry).
3. With no row selected, the band shows "Select a row."
4. **Following a link.** Clicking a related title, in the Data grid or in the Row band:
   1. When the click target is a record: the related mart becomes the selected mart (Data Marts redraws, Data shows its rows) and Row shows that record.
   2. When the target is a filtered mart (composite key or non-PK join): the related mart becomes selected and Data opens with that filter applied. Row clears.
5. **Back.** A back button in the Row band header (also `Alt+←`) returns to the previous `{ martId, filters, recordKey }`. The history holds the last 20 steps.

## Selection state

The store drops `tabs`, `activeTabId` and `explore`. It holds:

```ts
type Selection = { sourceKey: string | null; martId: string | null; record: { martId: string; key: Record<string, unknown> } | null };
type State = { selection: Selection; history: Selection[]; search: string; contexts: string[]; grids: Record<string, GridState>; refresh: number };
```

`GridState` is today's per-tab `{ columns, filters, limit }`.

## Refresh

The header Refresh reloads marts, edges, contexts, connectors, data quality and the visible row counts. It also re-runs the Data grid and the Row record. On failure the previous model, counts and data quality stay on screen, and the error shows in the header with Retry. A count already shown is never replaced by a spinner that cannot finish.

## Removed

1. `src/ui/canvas/Canvas.tsx`, `src/graph/layout.ts` (dagre, side arcs), `src/graph/visible.ts` level BFS and `hiddenMatches`, the "+N more" pill.
2. `src/ui/explorer/TabBar.tsx` and tab reducer actions.
3. Dependencies `@xyflow/react`, `@dagrejs/dagre`.

## Errors

Each band shows its own error where its content would be, with Retry. A connectors failure degrades silently (see Data Sources 3). One failure never blanks the page.

## Mock mode

Fixtures gain `definitionType` and `connectorSourceName` per mart (about half the marts on 3 connectors: Facebook Ads, Shopify, Google Analytics 4), and `GET /api/connectors` returns those three with no logo, so the fallback icon shows.

## Testing

1. Unit (Vitest, at most 4 workers):
   1. Source grouping: per connector, skipping non-connector marts, counts and order, connectors fallback.
   2. Visible marts for each rule above, including the selected-mart-plus-connected case with an inaccessible neighbour and the source-clears-on-mart-select rule.
   3. Selection reducer: select source, select mart, follow link to a record, follow link to a filtered mart, back, history limit 20.
   4. Refresh failure keeps counts and data quality.
2. Smoke (Playwright, mock mode): first load selects the focus mart and shows its rows; clicking a source narrows Data Marts; clicking a row fills Row; clicking a related title moves the selection; Back restores it; a filter and Reset work; the column picker changes columns.

## Delivery

Unchanged. `plugin.json` stays as it is.
