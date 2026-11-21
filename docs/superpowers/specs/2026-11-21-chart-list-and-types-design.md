# Chart list and new chart types: design

Date: 2026-11-21. Branch: `feat/chart-list-and-types`.

## Goal

The Charts view of the Data band shows a list of charts the member builds, not two fixed panels. The member adds charts
from a menu in the band header, picks each chart's type and fields in that chart's own menu, copies a chart as an image,
and the panels take only the width their content needs.

## Decisions taken

1. Saved settings change shape. Old `timeSeries` and `pie` choices are dropped, not converted. Scorecard choices stay.
2. In the header list a tick hides or shows a chart and keeps its setup. "Remove" in the chart's own menu deletes it.
3. New types are hand-drawn SVG, like the current bar, pie and sparkline. No chart library.
4. A mart with no saved charts shows the time series and the pie, as today.
5. AI ranking of chart suggestions is out of scope. "Add chart" offers every type the shown columns can draw.

## 1. Saved settings

`src/charts/settings.ts` and `src/api/chart-settings.ts`.

```ts
type ChartKind = 'timeSeries' | 'pie' | 'rankedBar' | 'line' | 'heatmap' | 'scatter' | 'spread';
type ChartSpec = {
  id: string;            // stable, made when the chart is added
  kind: ChartKind;
  hidden?: boolean;
  measure?: string;      // measureId: a field name, 'records' or 'records:<martId>[@path]'
  measure2?: string | null;
  date?: string;
  bucket?: DateBucket | 'AUTO';
  dimension?: string;
  dimension2?: string;   // heatmap columns when they are a dimension
  stack?: string | null;
  orientation?: Orientation;
  area?: boolean;
};
type ChartSettings = { version: 2; scorecards?: { hidden?: string[]; sparklines?: boolean }; charts?: ChartSpec[] };
```

1. `clean` keeps `scorecards` from any doc. It reads `charts` only when `version === 2`. Each spec drops unknown keys,
   wrong types and unknown kinds. A spec without a string `id` is dropped.
2. `charts` undefined means the defaults: a time series and a pie, each built by its kind's `create(cf)`. The defaults
   are written only on the member's first change to the list or to a chart.
3. A saved name that is no longer shown falls back to a default for this view only and is never written back, as today.
4. Every save writes `version: 2`.

## 2. Chart registry

`src/charts/kinds/<kind>.tsx`, one module per type, collected in `src/charts/kinds/index.ts`.

```ts
type ChartKindDef<R> = {
  kind: ChartKind;
  label: string;                                     // "Ranked bar", shown in menus
  eligible(cf: ChartFields): boolean;                // the shown columns can draw it
  create(cf: ChartFields, from?: ChartSpec): Omit<ChartSpec, 'id'>; // defaults; `from` carries fields on a type switch
  resolve(spec: ChartSpec, cf: ChartFields): R | null; // saved names to shown fields; null when it cannot draw now
  title(r: R, cf: ChartFields): string;              // its name in the header list
  Panel: (p: PanelProps<R>) => ReactNode;            // its ⋮ menu items and its width (section 6) come from the panel
};
```

On a type switch, `create(cf, from)` keeps `measure`, `date`, `bucket` and `dimension` when the new type can use them
and fills the rest with its defaults. `id` and `hidden` never change.

| # | Kind | Eligible when | Reads | Its own ⋮ settings |
|---|---|---|---|---|
| 1 | `timeSeries` (today's bars) | a date and a measure | `seriesQuery`, `seriesOtherQuery`, as now | Date, Bucket, Metric, Stack, Orientation |
| 2 | `pie` | a dimension and a `pieMeasures` entry | `topValuesQuery`, `pieOtherQuery`, as now | Metric, Dimension |
| 3 | `rankedBar` | a dimension and a measure | the pie's two queries with the measure's own function, AVG included | Metric, Dimension |
| 4 | `line` | a date and a measure | the time series's reads, once per measure (a second measure is its own unstacked series) | Date, Bucket, Metric, Second measure (Off or a measure), Stack (only with no second measure), Area |
| 5 | `heatmap` | a dimension, plus a date or a second dimension | `topValuesQuery` for each dimension axis, then one `[x, y, measure]` read with `in` filters on both top lists | Rows, Columns (a date bucket or a dimension), Metric |
| 6 | `scatter` | a dimension and two metrics | `[dim, m1, m2]`, sorted by m1 descending, limit 200 | Dimension, X metric, Y metric |
| 7 | `spread` | a dimension and a metric whose `allowedFunctions` has P25, P50 and P75 | `[dim, metric]` with P25, P50, P75 (and MIN, MAX for whiskers when allowed), sorted by P50 descending, limit 8 | Dimension, Metric |

1. Every query goes through the existing `withFilter` and `withCounter` rules, so the grid's filters and slices apply
   as they do now. Charts still show the data before HAVING.
2. New query builders go in `src/charts/queries.ts` beside the current ones: `heatmapQuery`, `scatterQuery`,
   `spreadQuery`.
3. A click on a bar, cell, point or row adds the same filters `clickFilters.ts` adds today: `dimensionFilter` for a
   dimension value, `bucketFilter` for a date bucket. "Other" is never clickable.
4. Each panel's ⋮ menu ends with Chart type ▸ (the eligible kinds), Copy to clipboard and Remove.

New SVG components in `src/charts/svg/`: `LineChart` (one or two Y axes, optional area fill), `Heatmap`,
`Scatter` and `SpreadChart`. The ranked bar reuses `BarChart` in horizontal orientation. All of them follow the
existing rules: sizes are ratios for drawing only, every shown value is the caller's formatted text, marks are
focusable with Enter and Space, and the series colours come from `--dm-series-*`.

## 3. Shared settings state

The doc stays in `ChartsBody`, with today's rules: it loads once per mart, applies each change over the latest doc (so
two quick changes both land), saves after every change and gives no `change` before the doc loads. The header menu
needs the doc and the chart fields, which only `ChartsBody` has, so `ChartsBody` portals the menu into the header:
the Data band renders an empty slot next to the Table / Charts switch and passes its element down through a context
(`src/charts/menuSlot.ts`, `ChartsMenuSlot`).

## 4. Header menu

Built by `src/charts/listMenu.ts` and portalled into the header slot (section 3), only while the band shows Charts
and the doc has loaded. It reuses `ChartMenu`. "Add chart" and "Chart type" are its existing radio submenus;
`ChartMenu` gains one item kind for Remove and Copy: `{ kind: 'action', label, onPick }`.

1. A tick per scorecard, as today (moved from the scorecard strip, whose ⋮ goes away).
2. Sparklines.
3. One tick per chart in list order, labelled with its title ("Page Views · Sum by day"). Unticking sets `hidden`.
4. Add chart ▸, listing the eligible kinds. A pick appends `{ id, ...create(cf) }`.

A chart whose `resolve` gives null (its fields are no longer shown and no default exists) stays in the list as
"<type> (columns hidden)", keeps its setup, is not drawn and sends no query.

## 5. Copy to clipboard

`src/charts/copyImage.ts`.

1. The panel gives the export its title and its own `<section>`. The export reads the chart's `<svg>` and the legend
   entries (swatch colour and text) from it.
2. The export clones the SVG and writes each element's computed `fill`, `stroke`, `font-*` and `opacity` as
   attributes, so no CSS variable or class is needed outside the page.
3. It draws on a canvas at 2× scale with a plain background in the current theme's card colour: the title, the SVG,
   then the legend rows. No frame and no ⋮ button.
4. It tries three routes in order. Each was checked in Chromium against a frame with the host's `sandbox` and `allow`
   values (OWOX/owox-data-marts#1922):
   1. `navigator.clipboard.write` with `image/png`. The OWOX host grants `clipboard-write` only to privileged plugins
      (`PluginRuntimePage.tsx`, `PRIVILEGED_ALLOW`), so in this plugin's frame it fails with `NotAllowedError` until
      #1922 lands.
   2. A `copy` event fired by `execCommand('copy')`, setting `text/html` to `<img src="data:image/png;base64,…">`
      and `text/plain` to the title. It works in a plain frame. It pastes as an image in rich-text editors (Docs,
      Slides, Gmail), not in apps that read only `image/png`.
   3. When both fail, the PNG downloads as `<chart title>.png` (every plugin frame has `allow-downloads`).
5. A toast says which happened: "Chart copied" for routes 1 and 2, "Clipboard is blocked here, the chart was
   downloaded as PNG" for route 3.

## 6. Panel width

1. `.dm-chart-panels` becomes a wrapping flex row with the same gaps and inset. Each panel sets its own width
   (`ChartPanel`'s `width`), from its kind and its bucket count.
2. Pie, ranked bar, scatter and spread: `min(100%, 26rem)`.
3. Time series, line and heatmap: `clamp(20rem, <buckets × 28px + axis width>, 100%)`. Horizontal bars use `26rem`.
4. Panel heights stay as they are now.

## 7. Error handling

1. Each panel keeps the `ChartPanel` loading, error-with-retry and empty states.
2. A failed save is logged and changes nothing on screen, as today.
3. A failed image export (canvas or blob) shows an error toast and changes nothing.

## 8. Testing

1. Per kind: `eligible`, `create` (including a type switch from every other kind), `resolve` with missing fields,
   and its query builder against the traverse options it must produce.
2. Settings: `clean` of a v1 doc keeps scorecards and drops charts; bad specs are dropped; defaults are not saved
   until a change.
3. `ChartsBody`: two quick changes both land; no `change` before load.
4. SVG render tests for `LineChart`, `Heatmap`, `Scatter` and `SpreadChart`: marks, labels, keyboard picks.
5. `copyImage`: each of the three routes, the fall-through order, the inlined colours.
6. Playwright, on the mock: add a chart from the header menu, switch its type, set a second measure, hide it, remove
   it, and copy it with the clipboard mocked. Existing chart e2e specs are updated for the moved menu.
7. Vitest runs with `--poolOptions.threads.maxThreads=4`. Playwright runs with `--workers=1 --trace off`.

## Out of scope

1. AI ranking of the "Add chart" list.
2. Histogram, map and funnel types, and period-over-period change on scorecards.
3. Dragging charts to reorder them.
