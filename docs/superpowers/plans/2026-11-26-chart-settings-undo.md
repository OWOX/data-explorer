# Chart settings in the Undo history

Asked for on 2026-11-26: Undo does not put a Sankey column back where it was. Chosen fix: every chart setting change the member makes is one Undo step, the same way grid edits are.

## What counts

1. Every member edit that goes through `change(...)` in `src/charts/ChartsBody.tsx` is one history step. That covers Sankey column order, metric, chart type, a column picked or removed, resize (one step per finished drag, not per frame), duplicate, hide, show, add chart, scorecard picks.
2. Not history steps: the first load of the saved settings, and writes that are part of another action (the prune when the member hides a grid column, via `pruneRef`; an AI run writing charts). These update the store's copy without an entry, so a later Undo of something else doesn't bring back a stale copy.
3. Undo and Redo move the chart settings like a grid: the step's "before" settings come back on screen and are saved (`chartSettings.save`), so a reload shows what Undo left.

## Store (`src/state/store.tsx`)

1. `State.charts: Record<string, ChartSettings>` (the loaded settings per mart) next to `grids`. `Entry.charts?: Record<string, ChartSettings | null>` next to `Entry.grids`.
2. `editCharts { martId, settings }`: like `editGrid`. No entry when the settings are deep-equal to the store's; otherwise push `{ ...selection, charts: { [martId]: before }, seq }`, set the new settings, clear `future`.
3. `saveCharts { martId, settings }`: like `saveGrid`, no entry (load, prune, AI).
4. `step()`: swap `charts` exactly as it swaps `grids` (both may be in one entry; keep `grids` behaviour identical).
5. Keep `ChartSettings` imported as a type only, to avoid a cycle; move the type if needed.

## ChartsBody

1. On load, dispatch `saveCharts`. `change(...)` dispatches `editCharts` (member edits) or `saveCharts` (prune and other non-member writes), then saves as today.
2. When the store's `charts[martId]` changes to something other than `latest.current` (Undo, Redo), set `latest.current` and `settings` from it and save it. Guard against a save loop.
3. A resize drag commits once on drop (check how resize calls `change` today; make it one step per drag).
4. If the mart's charts are not mounted when Undo lands (table view), the store still holds the right settings; when ChartsBody mounts it uses the store's copy over the loaded one if the store has one, and saves it.

## Tests

1. Store: `editCharts` pushes one entry, deep-equal is a no-op, Undo and Redo swap charts, a step holding both grids and charts restores both, `saveCharts` pushes nothing.
2. Component: reorder Sankey columns, click Undo: the old order is back and saved; Redo moves it again. The same for changing a chart's metric and for hide. A resize drag is one Undo step.
3. Undo in table view, then switch to Charts: the undone settings show.
4. e2e (`e2e/sankey.spec.ts`): drag a column, press the header Undo, the titles go back.
5. README: Undo covers chart menu changes. Remove "Undo does not restore…" from known issues in the release notes.
