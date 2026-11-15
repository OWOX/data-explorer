# Data Explorer plugin: design

Date: 2026-11-14
Status: approved in chat, awaiting spec review

## Goal

An OWOX Data Marts plugin that shows the data model (data marts and their relationships) on a canvas and lets a member browse each data mart's rows and single records. Version 1 does not write rows. Its only writes are the member's export reports (see the bands spec, Export): creating a spreadsheet, creating or updating a report and running it, each from the member's click. Editing comes later, once a write path exists.

## Out of scope for v1

1. Writing rows. OWOX has no row-write API. The edit UI (record forms, suggest dropdowns for relationship columns) is deferred.
2. Saving to Google Sheets from anything but the Data band's Export (see the bands spec).
3. Editing the model itself (relationships, schema, contexts).

## Platform facts this design relies on

All references are to `OWOX/owox-data-marts` at `origin/main` (17c20a523).

1. A plugin is a static site in a cross-origin iframe with an opaque origin. There is no `localStorage` and no cookies. Assets must be served with `Access-Control-Allow-Origin: *`. GitHub Pages does this.
2. `plugin.json` sits at the repo root and is read from a published GitHub Release tagged `vX.Y.Z`.
3. `@owox/plugin-sdk` (npm, 0.43.0) `connect()` returns `ctx`. `ctx.owox` is the API client and acts with the installing member's authority. Requests time out after 30 seconds, and at most 32 can be in flight.
4. `@owox/ui` is internal. The plugin copies the card styles it needs.
5. `ctx.owox.dataMarts.traverseData(id, {column, filter, sort, aggregation, limit})` is the only typed way to read rows. It takes `limit` but has no offset.
6. No row count is stored. A count is a `COUNT` aggregation through `traverseData`, which is a billed warehouse query.

## Stack

1. Vite, React 19, TypeScript (strict).
2. `@xyflow/react` 12 and `@dagrejs/dagre` for the canvas, the same libraries as the host's Models page.
3. `@tanstack/react-table` for the grid.
4. Tailwind CSS v4 and `lucide-react`. Theme follows `ctx.theme`.
5. Vitest for unit tests and Playwright for smoke tests against mock mode.

## Architecture

```
src/
  sdk/        connect() wrapper; mock ctx for ?mock dev mode
  api/        typed wrappers over ctx.owox (marts, edges, contexts, schemas, DQ, counts, rows)
  graph/      pure functions: focus choice, visible-set selection, search, layout
  filters/    per-type operator catalogue and traverseData filter builder
  records/    title-field heuristic, FK resolution
  ui/
    header/   context filters, search
    canvas/   flow, card node, edge
    explorer/ tab bar, mart tab, record tab, column picker, filter popovers
  state/      app store (selection, tabs, filters, column choices)
```

`graph/`, `filters/` and `records/` hold no React code and carry the unit tests.

## Data loading

1. **Marts.** `ctx.owox.dataMarts.list()` pages through every mart. For each storage, `GET /api/model-canvas/data-marts?storageId=` adds `icon`, `dataLastUpdated` and `fieldCount`.
2. **Edges.** `ctx.owox.models.getEdges(storageId)` for each storage returns `{id, sourceDataMartId, targetDataMartId, joinConditions[{sourceFieldName, targetFieldName}]}`.
3. **Contexts.** `GET /api/contexts` returns contexts with `icon`. Mart contexts come from the mart list.
4. **Schemas.** `GET /api/data-marts/:id` returns `schema.fields` (name, alias, type, isPrimaryKey, isHiddenForReporting). The plugin fetches schemas in the background with 6 requests at a time and caches them in memory for the session. Schemas for visible and selected marts are fetched first.
5. **Data quality.** `POST /api/data-marts/data-quality/summaries` with the ids of the visible marts.
6. **Row counts.** A `COUNT` aggregation through `traverseData`, run only for visible cards, at most 12 per view. Results are stored in the `member` collection `row-counts` as `{dataMartId, count, at}`. A cached value is shown as is. Refresh on the canvas recounts the visible cards.

Icons are a key from the OWOX icon enum or `lucide:<name>`. The plugin maps enum keys to lucide icons, using the table in `apps/web/src/features/data-marts/shared/components/DataMartIcon/data-mart-icons.ts`. A `lucide:` name loads from `lucide-react`'s dynamic import. The fallback is `Box` for marts and `Tags` for contexts.

## Canvas

### Visible set

1. **Focus.** By default, the focus is the mart with the most inbound edges. Ties go to the alphabetically first title.
2. **Nothing selected.** A BFS from the focus runs over undirected edges one level at a time. Each level is shown whole or not at all: the plugin adds the next level only if the total stays at or under 12 marts. Level 1 (the direct neighbours of the focus) always shows in full, even when it alone holds more than 12 marts.
3. **Card selected.** The canvas shows the selected mart plus every direct neighbour, inbound and outbound, with no cap.
4. **Filters active.** A context filter or a search query narrows the candidates to matching marts. Up to 12 matches show, ranked by inbound count, with a "+N more" note. Selecting a match switches to rule 3.
5. An edge is drawn only when both of its ends are visible.

### Header

1. Context chips, one per context, each with its icon. Several can be on at once, and a mart matches when it has any selected context.
2. A search box. It matches, case-insensitively, a mart's title, its context names, and its field names and aliases. A field match shows the matching field name on the card.
3. A refresh button that reloads marts, edges, contexts, DQ and row counts for the current view.

### Card

The card is styled after the host's `ModelCanvasFlowNode` and `erd-card`: `rounded-xl border shadow-sm`, with an icon tile and the title. Each card shows:

1. The mart icon and title. An (i) icon in the title's top right corner shows the mart description in a tooltip, and is hidden when there is no description.
2. To the left of (i), an external-link icon (`ExternalLink`) opens `https://app.owox.com/ui/<ctx.projectId>/data-marts/<id>/overview` in a new tab through `ctx.ui.openExternal`, so the explorer keeps its state. The click does not select the card. The base URL is one constant, `OWOX_APP_URL`.
3. A row-count badge (compact format, such as `12.4K`), with a spinner while the count loads.
4. A data quality icon. The status-to-icon map follows the host's `data-quality-status.ts`.
5. A freshness icon, with `dataLastUpdatedAt` as relative time in a tooltip.
6. Context chips with their icons.
7. A muted stub style for marts the member cannot access.

Layout uses dagre, left to right, in canvas mode.

## Explore mode

1. Clicking a card selects it and opens its mart tab. The canvas shrinks to a column one card wide with a top-to-bottom dagre layout, and the explorer panel fills the rest.
2. Tabs are either `mart:<id>` or `record:<martId>:<pk>`. Opening a tab that already exists activates it. Each tab has a close × in its top right corner. Closing the last tab leaves explore mode and restores the full canvas.
3. Each tab keeps its own columns, filters, row limit and loaded data while it stays open.

### Mart tab

1. Rows load through `traverseData` with the chosen columns, the primary key fields, the join-condition fields and `limit: 200`. A skeleton preloader shows until the first chunk arrives.
2. "Load more" re-queries with `limit` increased by 200, because the API has no offset.
3. **Column picker.** It lists all schema fields with checkboxes. The default selection is the first 5 fields in schema order, skipping `isHiddenForReporting`. The primary key is always fetched even when hidden from view.
4. **Toolbar.** "Reset" clears every filter in the tab. "Refresh" re-runs the tab's query.
5. **Marts without a primary key.** Rows show without record links, and a banner reads "Preview only: this data mart has no primary key."
6. Clicking a row of a mart with a primary key opens its record tab.

### Column filters

Each column header has an optional filter popover. The operators depend on the field's type category from `apps/backend/src/data-marts/dto/schemas/field-type-category.ts`, and every filter maps to a `traverseData` filter, so filtering runs in the warehouse.

| Category | Operators |
|---|---|
| string | contains, not contains, equals, not equals, starts with, ends with, is blank, is not blank |
| number | =, ≠, >, ≥, <, ≤, between, is blank, is not blank |
| date, time | on, before, after, between, relative (today, yesterday, this/last week, this/last month, this/last quarter, this year, last N days, last N months), is blank, is not blank |
| boolean | is true, is false, is blank |
| other | is blank, is not blank |

Filters in a tab combine with AND. A column with an active filter shows a filled filter icon.

### Relationship columns

A relationship column is a field of the explored mart that appears as `sourceFieldName` in an outgoing edge, or as `targetFieldName` in an incoming edge.

1. **Title lookup.** After each page loads, the plugin collects the distinct values of each relationship column and runs one `traverseData` on the related mart, filtered `in [values]`, selecting the join field and the title field.
2. **Title field heuristic.**
   1. The first field whose name or alias equals `title` or `name` (case-insensitive).
   2. Else, the first field whose name or alias contains `title` or `name`.
   3. Else, no title. The cell shows the raw value. There is no fallback to "the first string field": a status or a type is not a title, and showing one in place of a key misleads.
3. The cell shows the title, with the raw value in a tooltip.
4. **Click behavior.** When the related join field is the related mart's only primary key, a click opens that record's tab. Otherwise it opens the related mart's tab filtered `equals <value>` on that field.
5. When a relationship has several join conditions (a composite key), the cell shows the raw value and its click opens the related mart filtered on every join condition.

### Record tab

1. The plugin loads `traverseData` with `columns: '*'`, an `equals` filter on each primary key field, and `limit: 1`.
2. Fields show as a read-only label and value list in schema order. Relationship fields show the related title and link like grid cells.
3. "Refresh" reloads the record.
4. If no row matches, the tab shows "Record not found".

## Errors and loading

1. Each API call shows its error where its result would appear: a card badge, a tab body or the header. The message comes from `OWOXApiError` and comes with a Retry button. One failure never blanks the screen.
2. A request is cancelled when its tab closes or `ctx.signal` aborts.
3. A failed row count shows `—` with the error in a tooltip and is not cached.
4. Outside the OWOX host, `connect()` fails and the page shows "Open this plugin from OWOX Data Marts".

## Mock mode

`?mock` replaces `ctx` with an in-memory fake that holds fixture marts, edges, contexts, schemas and rows. It supports the `traverseData` filters the plugin uses. Playwright smoke tests and screenshots run against mock mode.

## Testing

1. **Unit tests (Vitest).**
   1. `graph/`: focus choice, whole-level BFS under the 12-mart budget, level 1 shown past the budget, selected-mode neighbours, search matching, filter narrowing.
   2. `filters/`: the operator catalogue per category and the `traverseData` filter output.
   3. `records/`: the title heuristic, relationship-column detection, value-to-title resolution, and click targets.
2. **Smoke tests (Playwright, mock mode).** Default focus appears, search narrows the canvas, a card click opens a tab with rows, a filter and its reset work, the column picker changes the visible columns, and an FK click opens a record tab.
3. Vitest runs with at most 4 threads.

## Delivery

1. `plugin.json` at the repo root:
   ```json
   {
     "name": "Data Explorer",
     "description": "Browse data marts, their relationships and their rows.",
     "delivery": { "type": "remote", "url": "https://owox.github.io/data-explorer/" },
     "collections": [{ "name": "row-counts", "scope": "member" }]
   }
   ```
2. A GitHub Actions workflow builds and deploys to GitHub Pages when a `vX.Y.Z` release is published.
3. Publish through Plugins → Publish Plugin → `owox/data-explorer`.
