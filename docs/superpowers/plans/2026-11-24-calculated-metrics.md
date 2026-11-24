# Calculated metrics in charts

Spec: `docs/superpowers/specs/2026-11-17-data-explorer-charts-design.md` (Fields). This plan amends its item 1.

Goal: a main mart's aggregate calculated field, such as Net Revenue with the formula `SUM(purchases.line_net_revenue)`, is a chart metric. Today `chartFields` drops every calculated field.

## Global Constraints

1. A calculated field has a level. `metric`: the formula aggregates, so a query selects it with no function and the backend refuses any function. `column`: row-level, and a query without a function makes it a group key. A missing or unknown level counts as `metric`, as the backend does.
2. Only `metric` fields become chart metrics. `column` fields stay out, as today. A joined mart's calculated fields stay out (`src/api/blendable.ts` drops them).
3. The Unique Count pseudo-field (`src/model/unique-count.ts`) is `isCalculated` with no level. It must not become a chart metric.
4. A calculated metric has function `null`. No query may put it in `aggregation`. Its row key is the column name, unchanged (no `| SUM`, dots kept).
5. Pie, Sankey and Spread never offer a calculated metric.
6. A filter on a calculated metric is an aggregate filter with no `function`. It never goes into a chart query as is. Charts follow it as they follow HAVING filters (`src/charts/havingKeys.ts`).
7. `src/charts/answers.ts` does not change. A column with no function counts as a key there, so a read is reused only when both sides have the same calculated metrics. That is required: the formula may join another mart, and the plugin does not know which.
8. No new dependency. Tests run as `npx vitest run --maxWorkers=4`. `npx tsc -b` has two errors before this work, both `Unused '@ts-expect-error'` in `src/ui/bands/look-rules.test.tsx` and `src/ui/bands/wave6-css.test.ts`. Add none. `npx eslint .` stays clean.
9. Comments and text: plain words, no em dashes, short sentences. Match the style around them.

## Task 1: The level, the metric and its queries

Files: `src/sdk/types.ts`, `src/model/types.ts`, `src/api/schemas.ts`, `src/charts/fields.ts`, `src/charts/queries.ts`, `src/charts/Scorecards.tsx`, their tests, `src/charts/charts-body.test.tsx`, the charts spec.

1. `SchemaFieldDto.calculated?: unknown` becomes `calculated?: { level?: string } | null`. If that breaks callers that check `!== undefined`, keep their behaviour.
2. `Field` gets `calculatedLevel?: 'metric' | 'column'`, set in `schemas.ts` next to `isCalculated`: `'column'` only when the stored level is `'column'`, else `'metric'`. Add a helper `isCalculatedMetric(field)` in `src/model/aggregation.ts`: `field.calculatedLevel === 'metric'`.
3. `Metric` becomes `{ field: Field; fn: AggFn | null }`; `null` is a calculated metric. In `chartFields`, a field with category `number` that is not an ID and is a calculated metric gives `{ field, fn: null }`. Other calculated fields give nothing. `allowedFunctions` stays `[]` for calculated fields, which keeps Pie, Sankey and Spread out. `ruleNewColumns` adds no rule for one.
4. `queries.ts`: `metricKey` returns `field.name` when `fn` is null. Every `aggregation` is built from metrics with a function only, and the key is left out when none is left (scorecards, sparkline, `measureParts`, scatter). The column is always named. `sankeyLowQuery` keeps its type correct without a cast that hides a null.
5. `Scorecards.tsx`: `metricLabel` is the field label alone when `fn` is null. `metricText` and `metricFormat` accept null: the field's own type, and its own format (the unit is kept). `isIntegerMeasure` follows the field's type.
6. Tests, written first:
   - schemas: levels `metric`, `column`, missing, unknown; an ordinary field has no level.
   - fields: a `metric` field is a metric with `fn: null`; `column` is not; a field with `isCalculated` and no level is not; not in `pieMeasures` or `sankeyMeasures`; `ruleNewColumns` adds nothing.
   - queries: scorecards with only a calculated metric and Unique Count gives `column: ['net']`, `uniqueCount: ['']` and no `aggregation`; with an ordinary metric too, only that one is in `aggregation`; sparkline, series, top values and scatter likewise; `metricKey` keeps dots.
   - answers: a read without the calculated metric does not answer an ask with it, nor the reverse; with it on both sides, dropping an ordinary metric is answered.
   - charts body: Orders with a shown calculated metric shows its card by its plain label with the value from the row key `net`, and the ⋮ menu of the Count Unique card has Metric with both choices. Picking it when the column is hidden shows the column. Stub the schema and the rows in the test; do not change the demo fixtures.
7. Spec: Fields item 1 says a shown main mart calculated metric is a metric with no function; row-level and joined calculated fields are not.

## Task 2: Filters on a calculated metric

Files: `src/charts/havingKeys.ts`, `src/ui/explorer/MartGrid.tsx`, `src/charts/havingKeys.test.ts`, a test of the MartGrid wiring in `src/charts/charts-body.test.tsx`.

1. `keysPlan`: a calculated metric column is not a group key, whether or not it is filtered. (Today it counts as one: a second key gives `fallback`, and as the only key it would be sent as an `in` rule.)
2. `keysPlan`: a filter rule without `function` whose column is a calculated metric is an aggregate rule, like one with a function. It makes the plan `read`. The keys read names the column and puts no rule in `aggregation`; `aggregation` is left out when empty.
3. Ungrouped rows: when the rows query has no `aggregation`, no `dateTrunc`, no `uniqueCount` and no calculated metric among its columns, and a filter on a calculated metric is sent, the plan is `fallback`.
4. `MartGrid`: `chartFilter` leaves out rules without a function whose column is a calculated metric. `hasChartFilters` does not count them as plain filters. The grid's own query does not change. Nothing new is memoized on an unstable value.
5. Tests, written first: each of 1 to 3, both with and without another HAVING rule; a charts body test where a filter on the calculated metric never reaches a scorecard query, and the keys read does.
