# Share links carry the charts

## Problem

A view link (`/v?s=…`) holds the data mart, columns, filters, slices, sorts, aggregations and whether Charts is open. It does not hold the charts. Charts are saved per member and per main data mart (`charts` collection), so a reader who opens the link sees their own saved charts, or the defaults (time series and pie), not the sharer's. A Sankey the sharer built never reaches the reader.

## Goal

Someone who opens a link sees the sharer's charts and scorecard choices for that data mart, the same way they already see the sharer's columns and filters.

## Behaviour

1. **Copy link** puts the sharer's chart settings for the main data mart in the link: the chart list (type, fields, Sankey columns, orientation, stack, area, bucket, size, hidden) and the scorecard choices (hidden cards, sparklines, metric and date picks). This happens whether the table or Charts is showing.
2. **Opening a link** shows those settings in place of the reader's saved ones for that data mart, for this session. Nothing is written to the reader's saved charts on open.
3. **Editing** works as it does today. The first chart or scorecard edit saves the settings on screen (the link's, with the edit) as the reader's own, the same way the first grid edit after a link saves the link's columns. Undo works as usual.
4. **Reload** (or a later session) shows the reader's saved charts: the link is forgotten once applied, as today.
5. **A link without charts** (from an older build, or one that was too long with them) opens as today: the reader's saved charts.
6. **Too long:** if the link with charts is over `MAX_ROUTE_LENGTH` (2048), Copy link copies it without charts and shows a notice: "The link was copied without the charts: they make it too long." If it is still too long without charts, the current "too large" notice stands.

## Link format

The payload stays `v: 1`. A new optional top-level key `ch` holds a `ChartSettings` object for `m` (the main data mart). Older builds ignore unknown keys, so their readers open such a link as before.

1. Chart ids are left out of `ch` (they are long, random and incompressible) except the fixed default ids (`time-series`, `pie`), which edits target. On decode, a chart without an id gets `newChartId()`.
2. Field names stay as plain strings. Deflate folds the repeats with the column names already in the payload.
3. Decoding runs the same cleaning the saved doc gets (`clean` in `src/api/chart-settings.ts`, exported for this). A `ch` that is not an object is dropped and counted in `dropped`. A chart entry that fails cleaning is dropped and counted in `dropped`, so the existing "some parts were skipped" notice covers it.
4. Field names that the reader's schema does not have need no special handling: charts already resolve saved names against the shown columns at draw time and fall back as they do for a stale saved doc.

## Where it plugs in

1. `src/state/view-link.ts`: `DecodedView` gains `charts?: ChartSettings`; encode writes `ch`, decode reads and cleans it.
2. `src/ui/useViewLink.ts`:
   1. Copy: the settings come from the store (`state.charts[martId]`) when Charts was opened this session, else from `chartSettings.load(martId)`. Encode with them, and fall back to encoding without them when the result is too long (point 6 above).
   2. Open: `applyView` carries the decoded charts.
3. `src/state/store.tsx`: `applyView` puts the charts in `state.charts[martId]` and marks the mart in a new `linkCharts: Record<string, true>`. No history entry: opening a link is not an Undo step, as today.
4. `src/charts/ChartsBody.tsx`: on mount, a mart marked in `linkCharts` uses `state.charts[martId]` and skips `chartSettings.load`. Edits and saves are unchanged; the first save makes the doc the reader's own.
5. `src/ui/explorer/MartGrid.tsx:472`: hiding a column while Charts is closed prunes the picks from `chartSettings.load(martId)`. For a mart marked in `linkCharts` it prunes `state.charts[martId]` instead, so hiding a column does not swap the link's charts for the reader's saved ones.
6. The mark lives in the store for the session and is not cleared, since a page applies at most one link. It is not kept across reloads.

## Testing

1. `view-link.test.ts`: round trip with `ch` (ids dropped and regenerated, default ids kept); a malformed `ch` and a malformed chart entry are counted in `dropped`; a payload without `ch` decodes with no `charts`.
2. `useViewLink` test: copy falls back to a link without charts, with the notice, when charts push it past the limit; copy reads saved settings when the store has none.
3. Store test: `applyView` with charts sets `charts` and `linkCharts` and adds no history entry.
4. `ChartsBody` test: a mart in `linkCharts` shows the link's charts and does not call `load`; the first edit saves them with the edit.
5. `MartGrid` prune test: hiding a column with Charts closed on a link mart prunes the link's charts, not the saved ones.
6. e2e (`sankey.spec.ts` or `charts.spec.ts`): in the mock, add a Sankey, copy the link, clear the saved charts, open the link: the Sankey shows. Reload: the saved charts show.

## README

The Charts paragraph says charts are saved per member. Add: a view link carries the sharer's charts and scorecard choices; the reader sees them until they reload, and their first chart edit saves them as their own.
