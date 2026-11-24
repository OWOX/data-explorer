# Ad-hoc report: a five-step AI pipeline on fast and decision models

Date: 2026-11-23. Status: approved in chat, spec awaiting review.

## Goal

A member who does not know the data types a request in the search box and picks the ad-hoc row. The explorer then builds a view that answers it:

1. the main data mart, chosen as a core entity (users, visitors), not a report-style mart;
2. up to 5 joined data marts, with the relationship each one is reached by;
3. the fields of every mart in use;
4. filters, slices, aggregations and sorts;
5. charts.

No AI request runs while the member types. Every AI request runs after the click.

## Today

1. `useSmartSearch` runs `/api/search` and then `findAdhocMart` (one AI request) on every pause in typing. The ad-hoc row waits for that answer.
2. After the pick, `buildAdhocView` asks the `reasoning` model for columns (`fieldsQuestion`) and then for filters and sorts (`filtersQuestion`). The answers are free JSON, checked by `parseAiFields` and `parseAiFilters`.
3. The view never joins marts, never sets slices and never sets charts.
4. `plugin.json` declares `{ "id": "ai", "models": ["fast", "reasoning"], "optional": true }`.

## Models

Each model does the job it is reliable at. Code builds every list of options and checks every answer.

| Model | What it does here | Why |
|---|---|---|
| `fast` | Step 0 reads the query into hints. Step 3 shortlists fields of a mart with more than 64 candidates. The number-format picker. | It writes free text (terms, numbers, currency codes). Its output is only a hint that code checks. |
| `decision` | Steps 1 to 5 make every pick. | It answers `choice`, `score` and `boolean` questions about one JSON state and cannot name an option it was not offered. OpenAI, Gemini and OWOX AI return probabilities. |
| `reasoning` | Not used. | Free JSON that can be wrong, slower and costlier than `fast`, and `decision` picks more safely. |

### Manifest

`plugin.json` becomes `{ "id": "ai", "models": ["fast", "decision"], "optional": true }`.

1. A credential must map every declared model, so a project has both models or neither. The pipeline needs no "fast without decision" mode.
2. On release, every installation loses its AI selection until a member chooses OWOX AI or a credential again on the plugin's Credentials tab. Until then `ctx.credentials.ai` is absent and the search behaves as it does without AI.
3. OpenRouter and openai-compatible credentials cannot map `decision`, so those projects lose AI.
4. OWOX AI is offered only when the deployment provides `decision`.
5. The number-format picker (`src/format/ai-pick.ts`, role `formats`) moves from `reasoning ?? fast` to `fast`.

### Calling decision

1. New dependency: the `ai` package, 7.x, for `experimental_decide`.
2. `src/search/decide.ts` wraps it as `ask(questions, state, signal)`. The wrapper:
   1. sends `state` as one JSON text part;
   2. aborts on the run's signal and after 20 s;
   3. returns, per question id, the chosen option id (or score level, or boolean) and its probability when the provider sends one;
   4. throws `AiUnavailable` for a timeout, an abort, a 4xx/5xx or an answer that names no offered option.
3. The plan's first task reads the `ai` 7.x types and pins the answer shape. The rest of this spec relies only on the chosen option and an optional probability.
4. Limits the builders respect: 1 to 64 questions per call, 2 to 255 options per `choice`, 2 to 10 described levels per `score`, non-empty `instructions` on every question.
5. `AiCredential` in `src/sdk/types.ts` gains `decision?`, typed as the model `experimental_decide` takes.

### Confidence

A pick is "unsure" when its probability is under 0.6, or the second option is within 0.15 of it. Steps 1 and 2 show alternatives for an unsure pick (see "What the member sees"). A provider without probabilities (Anthropic for `choice` and `score`) never makes a pick unsure.

## The search box

1. While the member types, the hook runs only `/api/search`, as today. `findAdhocMart` and its AI request go away.
2. The ad-hoc row reads `Ad-hoc report "<trimmed draft>"` with the `Sparkles` icon. It updates on every keystroke, before the search answers.
3. With AI configured, the row is enabled from 2 characters on, even when the search finds nothing: step 1 chooses from the whole catalogue.
4. Without AI, the row is enabled only when the search found a mart. Picking it opens the first hit (a mart, else the first report's mart) in its default view, as today.
5. Enter with nothing highlighted picks the ad-hoc row, as today.
6. A pick made before `/api/search` answers waits for that search (it joins the request in flight, as today), because step 1 uses its hits.

## Step 0: read the query (fast)

One `fast` request through the existing `createAiRun` call path, temperature 0, 10 s.

1. State: the query and today's date.
2. Answer: `{ subjects: string[], measures: string[], breakdowns: string[], time: string | null, values: { text: string, op?: "eq" | "gt" | "gte" | "lt" | "lte" | "neq" }[], ranking: { direction: "asc" | "desc", n?: number } | null, chartHint: "trend" | "share" | "compare" | "flow" | "correlation" | null }`.
3. `parseIntent` keeps only well-formed parts: strings trimmed and capped at 80 characters, at most 10 per list, unknown keys dropped.
4. When the request fails, every later step runs with an empty intent. The query text still goes into every state.

## Step 1: main mart (decision)

### Core-entity score (code, `src/search/core.ts`)

For every accessible mart, from `model.edges` with no request:

1. `inbound`: edges whose `target` is the mart;
2. `outbound`: edges whose `source` is the mart;
3. `neighbours`: distinct marts across both;
4. `keyAgreement`: the share of inbound edges whose join conditions use the same `targetField` set. When every relationship into a mart joins on one field, that field is very likely its key.

`coreScore = log2(1 + inbound) + log2(1 + outbound) + 0.5 * log2(1 + neighbours) + keyAgreement`. No title or name is read.

### Shortlist (code)

1. `relevance`: 3 for a mart in the search hits (mart hits and the marts of report hits), plus 1 for each step 0 subject that shares a word with the mart's title or description.
2. Rank by `relevance` first, then `coreScore`. Take the top 20.
3. Load their schemas through the shared loader (cached, concurrent calls share one request). Drop a mart whose `schema.primaryKey` is empty. A report-style mart usually has no key and few relationships, so it falls out here without a title rule.
4. With fewer than 2 marts left, skip the question: one mart is the answer, none means the fallback below.

### Question

One `choice`, `main`, with one option per shortlisted mart (option id = mart id). Instructions: pick the mart whose rows are the business entity the query is about, so the other data can be joined to it.

State: `{ query, intent, marts: [{ id, title, description, inbound, outbound, neighbours, key: string[], searchHit: boolean }] }`, with titles and descriptions cut as `prompts.ts` cuts them today.

### Fallback

When the request fails, the main mart is the shortlist's first mart. With an empty shortlist, the first search hit. With neither, the row does what a disabled row does today: it applies the query as a title search.

### Applying it

The hook dispatches `smartFound` and `setMarts` with the main mart in its default columns (`always: true`), as `pickAdhoc` does today. That is the one Undo step for the whole report. Every later step changes the grid through `fillGrid`, which the reducer drops once the member has edited the grid, moved to another mart or pressed Undo.

## Step 2: path (decision)

### Candidates (code)

1. The main mart's joined sources from `blendable.get(mainId)`, depth 2 or less.
2. Each source is one candidate, keyed by its alias path. A mart reached by two relationships is two candidates, so the relationship is chosen with the mart.
3. Each candidate carries: the mart's title and description, the label, the relationship's alias and description (from the `Edge` with the source's `relationshipId`), depth, `mainGrainMultiplication`, `mainGrainCollapse`, and the titles of the marts on the way.
4. More than 64 candidates: keep the 64 with the most step 0 word matches, then the shallowest.

### Question

One `score` per candidate (question id = alias path), 3 levels:

1. `0`: not related to the query;
2. `1`: useful context;
3. `2`: needed to answer the query.

### Choosing (code)

1. Keep candidates scored 1 or 2, highest first. Break ties by depth (shallower first), then by `mainGrainMultiplication: 'none'` first.
2. Take the top 5. A depth-2 source brings its parent path along as a bare node, as the join tree already does.
3. When the request fails, no marts are joined and the pipeline goes on with the main mart alone.

## Step 3: fields (decision, one call per mart, in parallel)

### Candidates (code)

1. Per mart in use (main plus step 2), its reporting-visible fields: the main mart's schema, and each joined source's `fields`.
2. A mart with more than 64 fields first goes through one `fast` request: given the query, the intent and the field names, aliases and descriptions, return up to 64 names. Names not in the list are dropped. When that request fails, code keeps the 64 fields with the most word matches against the query, plus the key and date fields.

### Question

One `score` per field (question id = field name), 3 levels: `0` not needed, `1` useful, `2` needed. State: query, intent, the mart, and per field its name, alias, type, category, description and allowed aggregations.

### Choosing (code)

1. Per mart, fields scored 2, then fields scored 1, at most 8 per mart and 20 in total. The main mart's fields come first.
2. A joined mart with no field scored 1 or 2 is dropped from the view.
3. Roles: a `number` field is a measure; a `string`, `date`, `time` or `boolean` field is a breakdown.
4. When a mart's request fails, the main mart keeps its default columns and a joined mart is dropped.

The fill sets `columns`. It runs after all step 3 requests finish.

## Step 4: filters, slices, aggregation, sorting (decision, one call)

Code builds every question below. They go into one `decision` call (at most 64). A question with fewer than 2 options is not asked.

### Aggregation

1. Rows are grouped when step 0 found a breakdown or a measure word, or when a step 3 measure scored 2.
2. One `choice` per measure, `agg.<field>`: the functions the field allows (`allowedFunctions`), plus `none`.
3. One `choice` per date breakdown, `bucket.<field>`: `none` plus `DATE_BUCKETS` (`DAY`, `WEEK`, `MONTH`, `QUARTER`, `YEAR`).
4. Without grouping, these questions are not asked.

### Date filter

One `choice`, `date`, over the relative presets (`RELATIVE_PRESETS`, with `last_n_days` offered as 7, 30 and 90, and `last_n_months` as 3, 6 and 12) plus `none`. The field is the first date breakdown, else the main mart's first date field. Not asked when step 0 found no time phrase.

### Value filters

The value comes from the query, never from the model.

1. For each step 0 value with `op` missing or `eq`/`neq`: for each text breakdown, read its top 200 values with the query `topValuesQuery` builds (one warehouse query per column, capped at 6 columns).
2. Match in code: case-insensitive equality, then a match after removing spaces, punctuation and accents, then a whole-word prefix.
3. One match in one column: code applies it. No AI request.
4. Several matches: one `choice`, `value.<n>`, whose options are the matching column-and-value pairs plus `none`. Only those matched values go to the model.
5. No match: no filter for that value.
6. A value with `gt`, `gte`, `lt` or `lte` and a number: one `choice`, `threshold.<n>`, over the number fields in use plus `none`. It becomes a filter on the picked field. Under grouping it would be a HAVING filter, which the explorer does not create (see the slice spec), so it is skipped.

### Filter or slice

A value or date filter on a field of a joined mart whose `mainGrainMultiplication` is not `'none'` gets one more `choice`, `placement.<n>`, with two options:

1. `filter`: keep only main rows that have a matching joined row ("users who have orders in Germany");
2. `slice`: keep every main row and count only the matching joined rows ("each user's orders in Germany").

On a main-mart field, or a lookup join, it is a filter and nothing is asked.

### Sorting

1. Code default: under grouping, the first measure descending; otherwise the default order (`sorts: null`).
2. When step 0 found a ranking, one `choice`, `sort`, over the shown columns, with the direction from the intent. `n` sets `limit` when it is under `PAGE_SIZE`.

### Applying it

`parseAiFilters`-style checks run on the result: every field in the schema, every operator offered for the field, every value of the shape the operator takes. When the request fails, the grid keeps its step 3 columns with no filters or aggregations.

## Step 5: charts (decision)

### Candidates (code, `src/search/chartCandidates.ts`)

Every `ChartKind` whose needs the view meets, with its fields filled in:

| Kind | Needs |
|---|---|
| `timeSeries`, `line` | a date breakdown and a measure |
| `bar`, `rankedBar`, `pie` | a text breakdown and a measure (the pie folds values past its top list into "Other") |
| `heatmap` | two breakdowns and a measure |
| `sankey` | 2 to 5 text breakdowns and an additive measure |
| `scatter` | two measures and a breakdown |
| `spread` | a measure and a breakdown |

### Question

1. One `choice`, `primary`, over the candidates.
2. One `score` per remaining candidate, `extra.<kind>`, levels `0` no, `1` maybe, `2` yes.
3. State: the query, the intent's `chartHint`, and each candidate's kind and fields.

### Applying it

1. Charts: the primary, then up to 2 candidates scored 2.
2. They go in front of the member's chart list for the main mart. A chart whose kind and fields equal one in the list is not added again. Nothing is removed.
3. The grid switches to `view: 'charts'` in the same fill.
4. When the request fails, no charts are added and the grid stays a table.

## What the member sees

1. After the click, the band's notice line shows the steps: "Choosing data mart", "Joining", "Picking fields", "Filters", "Charts". The current one has a spinner.
2. The main mart opens after step 1. Each later step changes the grid when it finishes.
3. An unsure pick in step 1 shows "Also matches:" with up to 2 more marts as chips. A chip makes that mart the main one and reruns steps 2 to 5, as a new Undo step.
4. An unsure pick in step 2 adds nothing to the screen. The pick stands.
5. When a step fails, the notice reads "AI couldn't finish the report. Showing what it built so far." and the pipeline stops.
6. One Undo takes back the whole report.

## Cancelling

1. Typing, clearing the box, picking another row or a chip aborts the pipeline. The abort reaches every AI request and warehouse query in flight.
2. Closing the box does not abort it.
3. A step whose signal aborted dispatches nothing.

## Cost

| What | Per ad-hoc report |
|---|---|
| `fast` requests | 1, plus 1 per mart with more than 64 fields |
| `decision` requests | 4, plus 1 per extra mart in step 3 (at most 9) |
| Schema reads | up to 20 on the first report of a session, cached after |
| Warehouse queries | 1 top-values query per text breakdown checked for a value, at most 6 |

On OWOX AI each successful AI request counts as one AI Process Run.

## Modules

1. `src/search/intent.ts`: step 0 question and `parseIntent`.
2. `src/search/decide.ts`: the `experimental_decide` wrapper and the confidence rule.
3. `src/search/core.ts`: core-entity score and shortlist.
4. `src/search/steps/main.ts`, `path.ts`, `fields.ts`, `view.ts`, `charts.ts`: per step, a pure `build` (candidates and questions from inputs) and a pure `apply` (answers to a result), plus a `run` that calls the model.
5. `src/search/valueMatch.ts`: literal-to-value matching.
6. `src/search/chartCandidates.ts`: valid charts for a view.
7. `src/search/pipeline.ts`: runs the steps in order, reports progress, stops on abort or failure.
8. Removed: `findAdhocMart`, `buildAdhocView`, `discoveryQuestion`, `fieldsQuestion`, `filtersQuestion`, `mergeAiView`.
9. `useSmartSearch` calls the pipeline on the ad-hoc pick and renders progress and chips.

## Testing

1. Every `build` and `apply` gets unit tests with fixed inputs and no model: candidate lists, the 64 and 255 caps, ties, fallbacks.
2. `core.ts`: a mart with many relationships and a key outranks a report-style mart with a similar title, and no title rule is involved.
3. `valueMatch.ts`: case, accents, punctuation, several matches, no match.
4. `chartCandidates.ts`: each kind appears exactly when its needs are met.
5. `decide.ts`: a fake model checks abort, timeout, an unknown option id and missing probabilities.
6. `pipeline.ts`, with fake `fast`, `decide` and loaders: steps run in order, a failed step stops the run and keeps earlier fills, an abort dispatches nothing, an edit made during the run blocks later fills.
7. `useSmartSearch`: no AI request while typing, the row label follows the draft, Undo takes back the whole report, a chip reruns steps 2 to 5.
8. Tests run with Vitest capped at 4 threads.
