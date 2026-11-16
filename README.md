# Data Explorer

**Open the rows behind any data mart in a few clicks, and follow a record to the records joined to it.**

A plugin for [OWOX Data Marts](https://docs.owox.com/). One page, four bands: **Data Sources, Data Marts, Data, Row**.

![Data Explorer: Data Sources, Data Marts, Data and Row bands](docs/data-explorer.svg)

## The challenge

A question about one order, one customer or one campaign ends in a row. The rows that explain it are in the data marts joined to that one. OWOX already knows the marts, their fields and how they join, but it shows no rows next to that model. To see the data you build a report or write SQL in the warehouse console. To follow `customer_id` into Customers you copy the id and start again in another tab. A quick look turns into a dozen steps, and you lose the path you took.

## What this gives you

🔎 **Find the data mart.** Search by title in the Data Marts band, or click context badges (a mart needs any one of the selected contexts). Select a connector in Data Sources to see only the marts it feeds.

🗺️ **See what it joins to.** The Data Marts band shows the selected mart and every mart joined to it, with lines for the joins and for the source that feeds each mart. Each card has its row count, data quality, freshness and contexts. A Storage filter narrows the cards when the project has several storages.

📋 **Rows without SQL.** The Data band is the mart's rows in a grid. Pick the columns, filter each column by its type, and click titles to sort, several columns at a time. With no sort of yours, rows come newest first by the mart's first date field. Date columns filter from one-click presets (Today, Last 30 days, This month and more). Dates and timestamps show in your own locale and time zone; the stored value is in the tooltip. Fields show their alias only, with a (?) holding the description. Your column choice and which bands you folded are saved per member.

🔗 **Follow a record.** A relationship column shows the related record's title instead of a bare id. Click it and that record opens in the Row band, with its own links and a "Referenced by" list of the marts that point at it. Undo and Redo, right after the page title (or Alt+← and Alt+→, or Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z), step back and forward along the path you took.

📤 **Take it to a sheet.** Export sends the grid as it is, with its columns, filters and sorting, to Google Sheets as an OWOX report, runs it and opens the sheet. Run it again later with Update.

## What it costs

Every grid, record and row count is a `traverseData` query in your warehouse, and the warehouse bills it. A card asks for its row count only once it scrolls into view, and counts are cached per member. Reopening the plugin reloads the model; the Retry on a storage that failed to load recounts them.

## What it writes

Nothing until you click Export. Export creates a spreadsheet, creates or updates your report and runs it. Rows are never written. Per member, the plugin keeps row counts, your column choices, which bands you folded and the reports you exported.

## Install

Once the plugin is published, open **Plugins** in OWOX Data Marts and add **Data Explorer**.

---

The rest of this file is for developers.

## Export to Google Sheets

The Data band's header has an Export button when the project has a Google Sheets destination you can use (none: no button). It creates an OWOX report from the grid as it is now (the shown columns, the complete filters and your sorts, no row limit), runs it and opens the sheet.

1. One destination and no report of yours for this data mart: one click creates a new spreadsheet, the report, runs it and opens the sheet. Both are titled "<Data mart> · Data Explorer · <date time>".
2. Otherwise Export opens a cascading menu. Its first level lists the destinations (the Google Sheets icon and the destination's title), also when there is only one. Hovering a destination, clicking it, or ArrowRight or Enter opens a flyout beside it (to the left when there is no room on the right) with "Update '<report>'" for each report you created from the plugin on it (it applies the grid's current state and runs again) and "New report…". Arrow keys walk a level and Escape closes one.
3. "New report…" asks for a title and a target: a new spreadsheet, or a pasted link of an existing one (its `#gid=` picks the tab, default the first). Share an existing spreadsheet with the destination's Google account as Editor.
4. If OWOX cannot create a spreadsheet (a service-account destination needs a Drive folder), the dialog opens with the message so you can paste a link instead.
5. The status of the run shows next to the button, with a link to the sheet. After 3 minutes without a result it says "Still running" and keeps the link.
6. If creating the report fails after the spreadsheet was made, a retry from the dialog reuses that spreadsheet. If the request timed out or hit a network or gateway error, the report may exist: the dialog closes and asks you to check OWOX before trying again.
7. Only the first 10 sorts are exported. The report keeps every column unaggregated, so the sheet has the grid's rows.
8. The reports you create are remembered per data mart (`exports`, member scope). One that OWOX no longer has is dropped when the menu opens.
9. Export writes only on your click: it creates the spreadsheet, creates or updates the report and runs it (a billed warehouse run). Updating replaces the report's configuration, so aggregations added to it in OWOX are cleared.

In mock mode (`?mock`) add `&sheets=1` for one destination or `&sheets=0` for none (default two).

The page header has no Refresh button. The model (marts, edges, contexts, connectors, data quality) is loaded when the plugin opens; to reload it, reopen the plugin. The Refresh in the Data band and in the Row band only re-reads that band's rows or record. If a storage fails to load, the header shows a warning with Retry, which reloads the model, counts and data quality; if that reload fails, the previous model, counts and quality stay on screen and the header shows the error with Retry.

## Develop

```bash
npm run dev
```

Then open `http://localhost:5173/?mock` to run against mock data.

## Test

```bash
npm test        # unit tests (Vitest, max 4 workers)
npm run e2e     # Playwright smoke tests of the bands
```

## Release

1. Tag the commit `vX.Y.Z`.
2. Publish a GitHub Release. The Pages workflow builds and deploys the site.
3. In OWOX: Plugins, then Publish Plugin, then `owox/data-explorer`.

## Limitations (v1)

1. Writes only from your click on Export: a spreadsheet, a report, a run. Rows are never written.
2. Row counts are warehouse queries cached per member. Reopening the plugin reloads the model; the Retry on a storage that failed to load recounts them.
3. The columns you pick in a data mart's grid are saved per member and per data mart; a saved column that is no longer available is dropped. Sorts and filters are not saved.
4. "Load more" re-reads from the start, because the API has no offset.
5. A relationship title is looked up only for single-field relationships.
6. The OWOX link always points to app.owox.com.
7. Nested RECORD fields are not expanded: their leaf columns are not offered. Repeated fields only filter on blank.
