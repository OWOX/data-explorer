# Data Explorer

A read-only OWOX Data Marts plugin. It runs as a static Vite + React site in an iframe and lets you browse data marts, their relationships on a canvas, and their rows.

## Develop

```bash
npm run dev
```

Then open `http://localhost:5173/?mock` to run against mock data.

## Test

```bash
npm test        # unit tests (Vitest, max 4 workers)
npm run e2e     # Playwright (4 workers)
```

## Release

1. Tag the commit `vX.Y.Z`.
2. Publish a GitHub Release. The Pages workflow builds and deploys the site.
3. In OWOX: Plugins, then Publish Plugin, then `owox/data-explorer`.

## Limitations (v1)

1. Read-only.
2. Row counts are warehouse queries cached per member. Refresh recounts them.
3. "Load more" re-reads from the start, because the API has no offset.
4. A relationship title is looked up only for single-field relationships.
5. The OWOX link always points to app.owox.com.
6. Nested RECORD fields are not expanded: their leaf columns are not offered. Repeated fields only filter on blank.
