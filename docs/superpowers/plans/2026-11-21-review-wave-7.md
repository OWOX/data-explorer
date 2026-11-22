# Review wave 7

No spec: the requirements are the user's list of 2026-11-21 (items 1 to 7), quoted under each task.

## Global constraints

1. Vitest only with `npx vitest run <files> --maxWorkers=2`. Never the whole suite unbounded; this machine overheats.
2. Playwright only with `npm run e2e -- <spec>` (it already passes `--workers=1 --trace off`).
3. No new dependencies. No changes to `plugin.json`. Icons come from `lucide-react`, already installed.
4. Code comments and commit messages: plain sentences, no em dashes, sentence case. End each commit message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
5. Keep existing tests green; update a test only when it asserted the behaviour this task changes.
6. Scratch files and screenshots in the project's `tmp/`. Stage only your own files. Never run bare `git stash`.
7. Grid and Graph card logic stays the same in both views.
8. Memory rule: charts match table data. Null values are never hidden per chart; the blank category is drawn first.

## Task 1: Marts band header: badges on the right, main mart top-left (items 1, 2)

User's words:
- "context badges still not aligned to the right (storage filter), as I asked. Badges must be wrapped into two lines if needed"
- "when data mart mark as main, move it to left top left corner. AS i said the rule is: main data mart in top left corner always."

Files: `src/ui/bands/ContextBadges.tsx`, `src/ui/bands/fitBadges.ts`, `src/ui/bands/CardBands.tsx`, `src/ui/bands/Band.tsx`, `src/ui/bands/bands.css`, `src/ui/bands/useCardClick.ts`, `src/graph/visible.ts`, `src/ui/bands/transitions.ts`.

Requirements:
1. In Grid view the context badges leave the title group (today they are passed in `afterHint` in `CardBands.tsx`) and sit in the band's toolbar, directly left of the Storage filter, right-aligned: the last badge (or the "+N more" chip) ends next to the Storage button. When there is no Storage filter (one storage) they still end at the right edge of the header.
2. The badges wrap onto at most two lines. What does not fit in two lines goes behind the existing "+N more" chip at the end of the second line. `fitBadges` becomes line-aware (two lines of the available width); update its unit tests. Lines are right-aligned (`justify-content: flex-end`).
3. The title group (icon, "Data Marts", count, hint, Grid/Graph switch, Make it main) stays on the left on one line. The header does not jump in height while the window resizes, beyond the second badge line appearing.
4. Graph view is unchanged (no badges there today).
5. Main mart position: reproduce first, with the mock app and Playwright. Cases: (a) in Grid, click a joined card in the report (it gets focused), press "Make it main"; (b) in Grid, click a band card the main mart cannot join (it gets picked), press "Make it main"; (c) the same from Graph, then switch to Grid; (d) drag onto the main card (already covered by `e2e/main-mart.spec.ts`). After each, the new main mart's card must be the first `article` in `#band-marts` and sit at the top-left of the cards grid (its bounding box has the smallest top, then the smallest left). Find why it is not in the failing case(s) (stale `canvasTree`, card transitions keeping the old order, `visible.ids` order, the leaving animation, a FLIP) and fix the cause, not the symptom. Write the cause in the report.
6. Tests: `fitBadges` unit tests for two lines; an e2e in `e2e/context-badges.spec.ts` that the badges' right edge is within 16px of the Storage button's left edge and that a narrow viewport gives at most two badge lines plus the chip; an e2e in `e2e/main-mart.spec.ts` for each failing make-main case (the new main is the first and top-left card). Save one screenshot of the header at deviceScaleFactor 2 to `tmp/w7t1-header.png`.

## Task 2: Chart menus: fields grouped by data mart, icons on every row (items 4, 7)

User's words:
- "in drop down menu make fields grouped by data marts and show data marts icons"
- "add icons to chats menu" (chart menus: Metric, Dimension, Date field, Bucket, Second measure, Stack by, Area, Chart type, Copy to clipboard, Remove, and the scorecard menu's Metric and Hide, the Charts list menu)

Files: `src/charts/ChartMenu.tsx`, `src/charts/listMenu.ts`, `src/charts/Scorecards.tsx`, `src/charts/kinds/*.tsx`, `src/charts/ChartPanel.tsx`, `src/ui/explorer/MenuParts.tsx`, `src/ui/bands/bands.css` (menu styles), `src/charts/fields.ts`.

Requirements:
1. Every submenu that lists fields or measures (Metric, Dimension, Date field, Second measure, Stack by, and the scorecard Metric) shows its options grouped by data mart, in the grid's group order (main mart first). Each group starts with a non-interactive header row: the data mart's icon (the same `PickedIcon` with the mart's own icon and the default mart icon fallback that the mart cards use) and the data mart's title. Rows under a header show the field's own label without the "Mart ·" prefix (`Contact Organization · Name` becomes `Name` under the "Contact Organization" header). A joined mart's title is the group title the grid uses for its alias path. A Count Unique row sits in its mart's group as "Count Unique".
2. A submenu with a single group still shows its header (the user wants to see whose fields they are). A submenu with options that belong to no mart (Bucket, Chart type) has no headers.
3. Header rows are skipped by arrow-key navigation and are not menu items: use `role="presentation"` on the header and wrap each group in `role="group"` with `aria-label` set to the mart title. The tick of the selected option still shows.
4. Every row of every chart menu has a leading icon from lucide-react, in one consistent column, like the column menu's rows: Metric `Sigma`, Dimension `Tag`, Date field `Calendar`, Bucket `CalendarRange`, Second measure `ChartNoAxesCombined`, Stack by `Layers`, Area `ChartArea`, Chart type `ChartColumn`, Copy to clipboard `Copy`, Remove `Trash2`, Hide `EyeOff`, Add chart `Plus`, Sparklines `ChartSpline`. Scorecard tick rows in the Charts list menu use `Hash`. Chart rows keep their kind icon. Check rows keep the tick column; the icon comes after it. Items without an icon in the code are a defect: give `MenuItem` a required `icon` on every kind.
5. Tests: unit test that the Dimension options of a two-mart `ChartFields` come out as two groups with the right titles and unprefixed labels; an e2e (extend `e2e/charts.spec.ts`) that opens a chart's Dimension submenu and sees the mart group headers and that arrow-down skips them. Screenshot of an open grouped submenu at deviceScaleFactor 2 to `tmp/w7t2-menu.png`.

## Task 3: Grid header ×, scorecards keep their values, light grey blank slices (items 3, 5, 6)

User's words:
- "cross in data mart cell title must remove data marts title, not all data marts and there columns connected thought via deleted data mart"
- "there is no need update score cards value if one of the column is removed because it doesn't change totals"
- "make null and (blank) values in pie chart light grey (lighter when now)"

Files: `src/ui/explorer/MartGrid.tsx`, `src/ui/bands/useCardClick.ts`, `src/charts/useChartQuery.ts`, `src/charts/blank.ts`, `src/charts/kinds/pie.tsx`, `src/charts/svg/PieChart.tsx`.

Requirements:
1. The × in a joined data mart's group header in the grid ("Remove <mart> from the grid", `MartGrid.tsx` `remove`) removes only that mart's own columns at that alias path. Marts joined through it keep their columns and stay joined through it (the same behaviour the report card × already has for a middle mart: `removePaths: [path]`). Focus after removal goes to the nearest tab still there. The main mart's × is unchanged.
2. Removing a column (any way: the grid ×, the column menu, the column picker) must not re-read the scorecards or sparklines when the new query asks for a subset of what an already-read query returned. Rule, in `useChartQuery` (or a helper next to it): a resolved read R answers a new query Q with no fetch when both are for the same mart and version, every property other than `column`, `aggregation` and `uniqueCount` is equal, Q's non-aggregated columns (the group keys) equal R's, Q's aggregations are a subset of R's (same column and function), and Q's `uniqueCount` paths are a subset of R's. The answer is R's rows (extra keys are harmless; cards read by key). The cards show their values with no skeleton flash. Adding a column still reads.
3. The blank category in a pie is light grey, lighter than now (`BLANK_COLOR` is `var(--muted-foreground)` today), readable in light and dark themes and clearly different from the "Other" slice (`OTHER_COLOR`). Use the same colour for the blank category everywhere `BLANK_COLOR` is used, so a stack and a pie agree. The legend swatch follows.
4. Tests: unit tests for the subset rule (subset reuses, a different filter does not, a different group key does not, an added column does not); a test that `useChartQuery` makes no second read after a column is dropped; a MartGrid or useCardClick test that the header × on a middle mart passes only its own path and the leaf keeps its columns; an e2e in `e2e/grid-edit.spec.ts` or `e2e/joined-apply.spec.ts` for the header × on a middle mart if the mock has a chain.

## Task 4: Filter editor and column picker polish (second list, items 1 to 4)

User's words:
- "make colors in dates popup green as other google sheets style elements"
- "selection from suggested option in filter "contains" works wrong. It must stay visible while user clicked to options from drop down and add concatenate them with ", ""
- On how several picks behave (answer to my question): "it does support Is any of, is none of. switch to this mode is several values are selected from dropdown: https://docs.owox.com/docs/getting-started/setup-guide/output-controls/#supported-operators-by-column-type"
- "padding between search input and buttons Clear and Apply must be the same as between dropdown and input field."
- ""Displaying" shows wrong value, it must be visible columns number"

Files: `src/ui/explorer/FilterEditor.tsx`, `src/ui/explorer/ValueInput.tsx`, `src/filters/valueSuggest.ts`, `src/filters/catalogue.ts`, `src/ui/SheetsChecklist.tsx`, `src/ui/explorer/ColumnPicker.tsx`, `src/styles.css` or `src/ui/bands/bands.css`.

Requirements:
1. Date and date-time filter inputs (native `type="date"`, `datetime-local`, `time` in `FilterEditor.tsx`) use the Sheets green the other Sheets-style controls use (find the existing green token, e.g. the Clear button's text colour or the primary green) for the picker's selected day, selected hour and minute, and accents: set `accent-color` (and `color-scheme: light` where the app is light) on those inputs. Check it in Chromium with a screenshot of the open picker if Playwright can capture it; if the native popup cannot be captured headless, say so in the report and show the computed `accent-color`.
2. Value suggestions under the text operators "contains" and "does not contain": a pick keeps the suggestion list open and the input focused (as the list operators already do), and adds the value to the comma-separated text with ", ". Once the text holds two or more values picked this way, the operator switches: "contains" becomes the multi-value equality operator ("is any of", today `eq` with a comma list, sent as `in`), "does not contain" becomes "is none of" (`neq` list, sent as `not_in`). Read the OWOX doc linked above for those operators' names; if the catalogue's labels for the list forms of `eq`/`neq` differ from the doc ("Is any of", "Is none of"), show the doc's label in the operator dropdown when the value is a list. Typing a comma by hand under "contains" does not switch (a literal comma is allowed there). A single pick under "contains" stays "contains" with that one value.
3. In the filter editor form, the vertical space between the value input (or search input) and the Clear / Apply row equals the space between the operator dropdown and the value input. Measure both in the browser; they must match to the pixel.
4. In the column picker (`ColumnPicker.tsx` via `SheetsChecklist`), "Displaying N" shows the number of columns of that mart visible in the grid (its selected count), not the list length. Other checklists (Storage filter, Aggregation) keep their current text unless the same prop is passed: add an optional prop to `SheetsChecklist` rather than changing its default.
5. Tests: unit tests for the operator switch on the second pick under contains and does not contain, and for no switch on a typed comma; a unit test for the Displaying count; e2e in `e2e/value-suggest.spec.ts` that two picks under contains keep the list open and leave the operator at "is any of" with "a, b"; a measured spacing check in an e2e. Screenshots at deviceScaleFactor 2 to `tmp/w7t4-filter.png`.
