# Data Explorer

An OWOX Data Marts plugin that reads data and writes only the reports you export. It runs as a static Vite + React site in an iframe and lets you browse data marts, how they connect, and their rows.

## Layout

One page, four bands from top to bottom:

1. **Data Sources**: the connectors that feed data marts. Select one to see the marts it feeds.
2. **Data Marts**: the selected mart and every mart joined to it, or what the search matches. Lines join sources to marts and marts to marts; hover or select a card to light its lines. Each card shows a row count (requested once the card scrolls into view), a data quality icon and the contexts. With two or more storages, a Storage filter in the band header narrows the cards to the ticked ones; the selection stays as it is.
3. **Data**: the selected mart's rows, with column filters, a column picker and Load more.
4. **Row**: the clicked row as a record, with its related titles, a Referenced by list and Back.

## Export to Google Sheets

The Data band's header has an Export button when the project has a Google Sheets destination you can use (none: no button). It creates an OWOX report from the grid as it is now (the shown columns, the complete filters and your sorts, no row limit), runs it and opens the sheet.

1. One destination and no report of yours for this data mart: one click creates a new spreadsheet, the report, runs it and opens the sheet. Both are titled "<Data mart> · Data Explorer · <date time>".
2. Otherwise Export opens a menu. With two or more destinations they are listed first. A destination offers "Update '<report>'" for each report you created from the plugin on it (it applies the grid's current state and runs again) and "New report…".
3. "New report…" asks for a title and a target: a new spreadsheet, or a pasted link of an existing one (its `#gid=` picks the tab, default the first). Share an existing spreadsheet with the destination's Google account as Editor.
4. If OWOX cannot create a spreadsheet (a service-account destination needs a Drive folder), the dialog opens with the message so you can paste a link instead.
5. The status of the run shows next to the button, with a link to the sheet. After 3 minutes without a result it says "Still running" and keeps the link.
6. Only the first 10 sorts are exported. The report keeps every column unaggregated, so the sheet has the grid's rows.
7. The reports you create are remembered per data mart (`exports`, member scope). One that OWOX no longer has is dropped when the menu opens.
8. Export writes only on your click: it creates the spreadsheet, creates or updates the report and runs it (a billed warehouse run). Updating replaces the report's configuration, so aggregations added to it in OWOX are cleared.

In mock mode (`?mock`) add `&sheets=1` for one destination or `&sheets=0` for none (default two).

Refresh reloads the model, counts and data quality. If it fails, the previous model, counts and quality stay on screen and the header offers Retry.

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
2. Row counts are warehouse queries cached per member. Refresh recounts them.
3. The columns you pick in a data mart's grid are saved per member and per data mart; a saved column that is no longer available is dropped. Sorts and filters are not saved.
4. "Load more" re-reads from the start, because the API has no offset.
5. A relationship title is looked up only for single-field relationships.
6. The OWOX link always points to app.owox.com.
7. Nested RECORD fields are not expanded: their leaf columns are not offered. Repeated fields only filter on blank.
