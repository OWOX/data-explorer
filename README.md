# Data Explorer

A read-only OWOX Data Marts plugin. It runs as a static Vite + React site in an iframe and lets you browse data marts, how they connect, and their rows.

## Layout

One page, four bands from top to bottom:

1. **Data Sources**: the connectors that feed data marts. Select one to see the marts it feeds.
2. **Data Marts**: the selected mart and every mart joined to it, or what the search matches. Lines join sources to marts and marts to marts; hover or select a card to light its lines. Each card shows a row count (requested once the card scrolls into view), a data quality icon and the contexts. With two or more storages, a Storage filter in the band header narrows the cards to the ticked ones; the selection stays as it is.
3. **Data**: the selected mart's rows, with column filters, a column picker and Load more.
4. **Row**: the clicked row as a record, with its related titles, a Referenced by list and Back.

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

1. Read-only.
2. Row counts are warehouse queries cached per member. Refresh recounts them.
3. The columns you pick in a data mart's grid are saved per member and per data mart; a saved column that is no longer available is dropped. Sorts and filters are not saved.
4. "Load more" re-reads from the start, because the API has no offset.
5. A relationship title is looked up only for single-field relationships.
6. The OWOX link always points to app.owox.com.
7. Nested RECORD fields are not expanded: their leaf columns are not offered. Repeated fields only filter on blank.
