# Data Explorer: Charts view of the Data band

Date: 2026-11-17
Status: design approved in chat
Builds on: `2026-11-15-data-explorer-bands-design.md` (Data band, grid, filters, aggregation).

## Goal

A `Table | Charts` switch next to the Data band's title. Charts shows the same data marts, columns and filters as the
table, drawn as scorecards, a time-series bar chart and a pie chart. Every number on screen comes from a `traverseData`
query; the plugin does no arithmetic on values.

## Decisions taken in chat

1. Charts are drawn in our own SVG. No chart dependency.
2. A metric is a shown number column; a dimension is a shown string or boolean column.
3. Chart customisation is saved per member in a new `charts` collection, one document per main data mart.
4. Stack values and pie slices are capped at 8 plus "Other"; "Other" is its own backend query (`not_in`).
5. Sort controls are hidden in Charts mode.
6. The time-series chart has an orientation switch (vertical / horizontal) in its header.

## Switch

1. A segmented control with two buttons, `Table` and `Charts` (lucide `Table2`, `ChartColumn`), `role="radiogroup"`,
   sits in the Data band header right of the title. Table is the default.
2. The mode lives in the grid state (`GridState.view?: 'charts'`, absent = table). It is an Undo step, it is in the
   copied view link (`vw: 1`). It is not written to the member's `grid-columns` store, so opening the plugin afresh
   shows Table.

## Fields

1. **Metric:** a shown field with category `number`, not a primary key, not calculated, whose allowed functions are not
   empty. Its function is the first Σ function the grid has on the column; with none, `SUM` when allowed, else the first
   allowed function.
2. **Dimension:** a shown field with category `string` or `boolean`, not a primary key.
3. **Date field:** a shown field that `canBucket`.
4. Each field belongs to a data mart: the main one, or the joined one in `field.joined.martId`.
5. **Measure:** what a time series or pie counts: a metric, or a mart's **Unique Records** (every chart mart with a
   primary key, main or joined; a joined mart has one when the backend allows a unique count on its alias path). The
   list is per mart in group order: its Unique Records, then its metrics. Any mart's measure pairs with any mart's
   date or dimension. A joined mart's label is "<group title> · Unique Records". The pie offers every Unique Records
   and the summable metrics (always summed).

## Layout in Charts mode

1. The grid's header rows stay: column letters, group headers (icon, title, picker, remove), column titles with the
   filter and Σ controls. Sort buttons and the sort items of the column menu are hidden. Headers keep their widths, and
   the header and the charts scroll together horizontally.
2. The table body is replaced by, top to bottom:
   1. **Scorecard strip.** One cell per data mart group, exactly under that group's header span (it is a `<td colSpan>`
      in the same table). Inside, the cards flex-wrap, so a narrow span stacks them on several lines. A card is at most
      10rem wide (`flex: 0 1 10rem`, `min-width: 0`): it does not stretch to fill the cell, but may shrink in a narrow
      one.
      1. First card: **Records**, the unique count, when the data mart has a primary key.
      2. Then one card per metric of that data mart: the field label and function label ("Amount · Sum"), the value
         formatted with the column's format.
      3. When a date field of that data mart is shown, each card has a sparkline under the value (the time-series date
         field when it belongs to that mart, else that mart's first date field; the bucket is the time-series bucket).
   2. **Time series**, when a date field is shown. A panel spanning the visible width (sticky left), titled
      "<Metric> by <bucket>" ("· by <dimension>" when stacked).
   3. **Pie**, when at least one metric and one dimension are shown: "<Metric> by <dimension>".
3. Nothing to chart (no metric and no PK in any mart): one line, "Show a number column to chart it."

## Queries

All go through `readRows`. Each carries the grid's current filters (`toTraverseFilters(schema, filters)`), and no sort
or limit except as listed. Query builders are pure functions in `src/charts/queries.ts`.

| # | Purpose | Options |
|---|---|---|
| 1 | Scorecards | `column`: all metrics, `aggregation`: their functions, `uniqueCount`: `''` when the main mart has a PK, plus the alias path of each shown joined mart with a PK → one row. Without metrics: `uniqueCount` only. |
| 2 | Auto bucket | `column: [date]`, `aggregation: [MIN, MAX]` on the date field → one row. The bucket is the smallest of DAY, WEEK, MONTH, QUARTER, YEAR that gives ≤ 60 buckets over that span (`pickBucket(min, max)`; dates parsed only to count buckets, no value is shown from it). |
| 3 | Sparklines | per data mart with a date field: `column: [date, ...mart metrics]`, `dateTrunc`, `aggregation`, `uniqueCount` for that mart when it has a PK, `sort` date asc. |
| 4a | Stack top values | `column: [dim, metric]`, `aggregation`, `sort` metric desc, `limit: 8`. For a Unique Records measure: `column: [dim]`, `uniqueCount: [aliasPath]`, `sort` its key desc. |
| 4b | Time series | `column: [date, (dim), metric]` (a Unique Records measure: no metric column, `uniqueCount: [aliasPath]` of its mart), `dateTrunc`, `aggregation`, plus filter `dim in top8` when stacked, `sort` date asc. |
| 4c | Time series Other | stacked only and when 4a returned 8: `column: [date, metric]`, filter `dim not_in top8`. |
| 5a | Pie slices | same as 4a with the pie's dimension and metric. |
| 5b | Pie Other | when 5a returned 8: `column: [metric]`, aggregation (or `uniqueCount: [aliasPath]` for Unique Records), filter `dim not_in top8` → one row. |

1. Output keys: a function output is `aggregatedKey(column, fn)`; the main unique count is `Unique Count`; a joined
   one is `<alias path with dots as _>__unique_count`.
2. Blank dimension values are not charted: queries 4a–5b carry an extra `is_not_blank` filter on the dimension, and the
   panel shows the note "Rows with a blank <dimension> are not shown." (SQL `NOT IN` drops NULLs anyway, so this keeps
   the top values and Other consistent.)
3. Bar heights, slice angles and the share in a tooltip are ratios of returned values for drawing. Every value text on
   screen is a returned value.
4. A query runs only while Charts is shown, the band is open and the grid is not blocked. Results are cached in memory
   for the session by `martId + version + JSON(options)`. Refresh bumps the version. A newer query aborts the older one.

## Chart menus

A `⋮` button (lucide `EllipsisVertical`) at the top right of each panel opens a menu built from `MenuParts`.

1. Scorecards (one ⋮ at the right end of the strip): a checklist of cards (show or hide each), "Sparklines" on or off.
2. Time series: Date field (only with more than one), Bucket (Auto, Day, Week, Month, Quarter, Year), Metric (only
   with more than one), Stack by ("No stacking", then each dimension). Left of the ⋮, the orientation switch: two icon
   buttons (`ChartColumn` vertical, `ChartBar` horizontal), `aria-pressed`.
3. Pie: Metric (see 4; metrics only when summable, always summed), Dimension.
4. The Metric menus offer the measures list (see Fields), in group order: each mart's Unique Records, then its metrics.

## Click to filter

A click on a chart mark adds grid filters through the same path as a filter edit, so it is one Undo step.

1. Pie slice: the dimension's filter, `eq` for text, `is_true` / `is_false` for a boolean. "Other" is not clickable.
2. Bar: the date column `between` the bucket's first and last moment; on a stacked bar the clicked segment's value is
   added (not for "Other"). The keyboard reaches each bucket (Enter / Space: the bucket filter only).
3. Bucket bounds: a zoned bucket (an instant type: TIMESTAMP and its zone variants) sends UTC instants from the bucket's
   local midnight to one second before the next, DST-aware, and its filter text ends "(UTC)". DATE and DATETIME are not
   zoned (the backend buckets DATETIME by its raw calendar day), so they send calendar days.
4. A bucket of blank dates is not clickable; a filter that would not be complete is dropped with the "not applied" note.
5. The pie hides its share when the measure's mart is not the dimension's: one row may sit in several slices.

## Column letters

Right-clicking a column letter (A, B, C) opens that column's menu, the one its menu icon opens, in Table and Charts.

## Saved settings

`src/api/chart-settings.ts`, collection `charts` (member scope, added to `plugin.json`), doc id = main mart id:

```ts
type ChartSettings = {
  scorecards?: { hidden?: string[]; sparklines?: boolean };       // hidden: card ids (field name, or 'records:<martId>')
  timeSeries?: { date?: string; bucket?: DateBucket | 'AUTO'; metric?: string; stack?: string | null; orientation?: 'vertical' | 'horizontal' };
  // timeSeries.metric: a field name, 'records' (main mart) or 'records:<martId>'
  pie?: { metric?: string; dimension?: string };                   // metric: as timeSeries.metric
};
```

1. Read once when Charts first opens for a mart; written on every change (one put, failures logged).
2. `resolveCharts(settings, fields)` turns saved choices into the ones in effect: a choice naming a field that is not
   shown (or a `records:<martId>` of a mart without a key) falls back to the default (first date, first metric, first dimension, `stack` none, bucket AUTO, vertical,
   sparklines on). The saved document is not rewritten by a fallback.

## Drawing

`src/charts/`: `Sparkline.tsx`, `BarChart.tsx`, `PieChart.tsx`, `Scorecard.tsx`, `ChartPanel.tsx` (title, actions,
skeleton, `ErrorBox` with Retry). Plain SVG, `viewBox` with the measured width (`ResizeObserver`).

1. Colours: series tokens `--dm-series-1..9` (the ninth is "Other", neutral grey) on `:root`, with dark-mode values,
   following the dataviz skill's palette.
2. Bars: value axis with 4 ticks from 0 to the largest stacked total returned by 4b/4c (a max of returned values), gridlines,
   bucket labels formatted by `formatBucket`, thinned to fit. Horizontal: 20px per bucket, oldest at the top.
3. Tooltips (`Tooltip` from the codebase) on bars and slices: label, value as returned, share.
4. Legend under the bar chart when stacked and beside the pie.
5. Accessibility: every chart's `<svg role="img" aria-label>` names what it shows; each panel has a visually hidden
   table of the returned rows.

## Testing

1. Unit: `queries.ts` builders, `pickBucket`, `chartFields` (metric, dimension, date classification and function choice),
   `resolveCharts`, `chart-settings` read and write.
2. Mock SDK: `uniqueCount` with joined alias paths and with grouping, `not_in` and `in` filters if missing.
3. Component: switch toggles and is an Undo step; scorecards sit in their group's cell and wrap; sparklines appear only
   with a date field; menus change the chart and save; orientation switch; filters apply to chart queries; no query
   while folded or in Table mode.
4. e2e: switch to Charts, see the scorecards and the bar chart, change Stack by, flip orientation.

## Docs

README: a "Charts" item under "What this gives you", a line under "What it costs" (each chart is a billed query, run only
while Charts is shown), and `charts` under "What it writes".
