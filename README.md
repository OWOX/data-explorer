# Data Explorer

**Open the rows behind any data mart in a few clicks, with fields from the data marts it joins to.**

A plugin for [OWOX Data Marts](https://docs.owox.com/). One page, four bands: **Data Sources, Data Marts, Data, Row**.

![Data Explorer: Data Sources, Data Marts, the Orders data with joined Customers, Products and Stores columns, and one order open](docs/data-explorer.svg)

## The challenge

A question about one order, one customer or one campaign ends in a row. The fields that explain that row often live in other data marts: the customer's city, the product's name, the store. OWOX knows the data marts, their fields and how they join, but it shows no rows next to that model. To see them you build a report or write SQL in the warehouse console. To add the customer's city to an order you copy the id and look it up in another tab. A quick look turns into a dozen steps.

## What this gives you

🔎 **Find the data mart.** Click the search icon in the Data Marts band and describe what you need; the cursor is in the box at once. On a first visit with no main data mart the box opens by itself. The search asks OWOX's own search first and, when the project has an AI model, finds data marts by meaning and sets up the view too. Or click context badges to narrow the band. Select a connector in Data Sources to see only the data marts it feeds, or pick storages in the Storage filter.

🗺️ **See what it joins to.** The Data Marts band shows the selected data mart and every data mart joined to it, with lines for the joins and the sources. With a main data mart selected, the band lists every data mart it can join, at any depth, with the main one first. Hover a card to see the data marts it relates to that the band leaves out, drawn dashed: with a main data mart that happens only while a context badge or the search narrows the band, because otherwise it leaves nothing out. Each card shows its record count, data quality, freshness and contexts.

🖼️ **Canvas view.** The Data Marts band has two views. Grid lists the data marts as cards. Canvas draws the report as a tree: the main data mart on the left, each joined data mart to the right of the mart it joins through. Each card that something can join has a (+) on the middle of its right edge, shown while you hover or focus the card. Hover the (+) to see the data marts that can join under that card as dimmed cards, or click it to keep them shown, and click one to add it under that card. A click on the card itself also focuses it and shows what can join under it. The (+) and the x are the same size. A data mart can sit under more than one card, for example Countries under both Customers and Stores, and each place is its own card. The x on a joined card takes off only that data mart's own columns, filters and sorts: the marts joined through it keep theirs, and it stays as a bare card only when one is; otherwise its card leaves. The x on a bare card removes it and everything joined under it in one step. Undo brings it back. Drag a joined data mart to move it under another one: marts it cannot join are dimmed, and a dashed line points at the closest one that can take it. The band reopens in the view you picked last.

📋 **Rows without SQL.** The Data band shows the rows. Pick columns, filter each by its type (dates from presets such as Last 30 days or This month), and click titles to sort by several columns. A filter or slice badge after a data mart's title lists the fields that have one, and its list ends with Clear, which removes them all. Until you sort, the newest rows come first. Dates and times show in your locale and time zone.

🔌 **One card per service.** On the Data Sources band a card stands for a service, not one custom connector: connectors whose API hosts share a registered domain (three Fibery connectors on `owox.fibery.io`, say) fold into one card named after what their titles share, or after the domain. Selecting it shows the data marts of all of them. Only an inline `data:image` logo is shown. If OWOX refuses the custom connector read, each custom connector keeps its own card, as before. Source cards link nowhere, so the single-connector builder link is not offered.

🧩 **Fields from joined data marts.** Select a joined data mart in the Data Marts band and its fields join the grid under their own tab, such as `Customers · city`; the config button next to the Table / Charts switch lists its fields. It filters, sorts and exports like any other column, and OWOX reads it in the same query. A data mart reachable by several paths joins through the data mart in use that is closest to the main one. A field of a one-to-many join arrives as one cell with its values separated by commas.

➕ **Several data marts, one main.** Click a card in the report (the main one or a joined one) to focus it: the data marts that can join under it show, the others dim, and nothing is removed. Then click a joinable data mart and its first text field and its first metric (neither an ID) become columns; the grid then gets a tab for each data mart ("Orders", "Customers") and the card looks like the selected one (the same solid border and fill; the grid's first tab names the main data mart). The x on a joined card removes its own columns, filters and sorts (the marts joined through it keep theirs); add it again and it comes back with the fields you last chose. Escape or a click on the empty band clears the focus. A data mart the main one cannot join shows dimmed wherever a search, a context badge or a data source lists it, and a click on it explains instead of switching. To make another data mart the main one, drag its card onto the main card, or use its Make main data mart button. Its own columns come first, and the old main stays as a joined mart when the new one can join it. Undo and Redo cover all of it. Each data mart's columns sit together under a group header with its icon and title; a data mart joined under two parents has one group per place, and the title adds the path so the groups can be told apart. Remove from report, at the end of a data mart's panel in the config menu, does the same as that x: it takes only that group's own columns, filters and sorts, the marts joined through it keep theirs, and it stays as a bare card only when one is, otherwise its card leaves; another copy of the same data mart at a different place stays. Removing the main one promotes the next.

🟦 **A grid that selects like Google Sheets.** Click a cell to select it: a blue frame with a fill handle at its corner, and its column letter and row number lit. Click a column letter to select the whole column, or a row number to select the whole row (that row also opens in the Row band); Shift-click extends to a range. Arrow keys move to a single cell and Escape clears. A column title sits on the left with its (i) beside it; the filter, Σ and sort controls sit at the right end, green while idle and a filled green square while a filter, an aggregation or a sort is in use.

🔗 **Open a record.** Click a row to see all its fields in the Row band, with "Referenced by": the data marts that point at it, each opening filtered to this record. Undo and Redo in the page header, left of the copy-link button, step back and forward along your path.

📤 **Take it to a sheet, or to an AI.** Copy to clipboard, in the Export menu, copies the rows the grid has loaded as tab-separated text with a header row, so it pastes into Google Sheets or Excel as cells. It copies exactly what the grid shows (dates in your format, joined values separated by commas, nothing clipped) and runs no query, bills nothing and writes nothing. Export sends the grid as it is (columns, filters, sorting) to Google Sheets as an OWOX report, runs it and opens the sheet. Update reruns it later with the grid's new state. Claude and ChatGPT in the same menu each copy a prompt that asks, through the OWOX Data Marts connector, for the same rows. Copying writes nothing to OWOX. Copy SQL copies the SQL of the grid's last query (with its page LIMIT), read from that query's run in OWOX. It is disabled, with the reason, until OWOX has the SQL. Create Data Mart, the last item, saves the grid as a new SQL data mart in the same storage. Its SQL matches the rows the web UI shows: the data marts the grid uses are referenced, each joined data mart is rolled up per join key (SUM, MAX, STRING_AGG and so on, by the join setting) and LEFT JOINed to the main one, and the grid's filters are applied after the joins. The shown columns are kept. Include grouping and Include sorting are optional and off by default, so the data mart holds raw rows unless you tick them; sorting adds only the order you set, never the grid's default. The data mart is published and available for reporting. If a step fails after the draft exists, the dialog links to the draft and, when the failure is in the SQL or its columns, offers to delete it.

📊 **Charts.** The Data band switches between Table and Charts. Charts shows a strip of scorecards under each data mart's header: Records and one card per metric, each with a sparkline. Below it, a time series draws Records or a metric by a date field in buckets (Auto, or day to year), optionally stacked by a dimension (the top 8 values and Other), as vertical or horizontal bars. A pie shows a metric by a dimension, also the top 8 and Other. The ⋮ menu of each chart picks what it draws, duplicates it, copies it to the clipboard or hides it, and your choices are saved per member. The config button next to the switch lists Add chart first and, under Charts, a tick for each scorecard, the sparklines and each chart, so a hidden one comes back from there. OWOX computes every number; the plugin does no arithmetic.

## What it costs

Every grid, record and record count is a `traverseData` query in your warehouse, and the warehouse bills it. A card asks for its count only when it scrolls into view, and counts are cached per member. The grid asks for the total row count of each new result, which is one more warehouse query: OWOX waits up to 60 s for it before the first row. Load more and a sort reuse the count. In an ungrouped grid, hiding a column and showing a loaded one reuse it too. A change of data mart, filters, slices, grouping or Unique Count, Refresh or Retry, and a column that was never loaded ask again. Hiding the last column of a joined data mart drops its filters and slices, so that asks again if it had any. When the grid shows or filters by a calculated field, the next read after hiding a column asks again, because OWOX may group that read by its other columns. A read left before it ends, by a new sort or by opening Charts, asks again. Folded bands run no queries. Opening the plugin also reads the connector lists (`GET /api/connectors`, and `GET /api/connectors/custom/summaries` for custom connectors your data marts use), which run nothing in your warehouse. Each chart is a `traverseData` query, run only while Charts is shown and the band is open, and cached for the session.

## What it writes

Nothing until you click Export to Google Sheets or Create Data Mart. Export creates a spreadsheet, creates or updates your report and runs it. Create Data Mart creates, publishes and shares one data mart. Copying a prompt for an AI writes nothing. Rows are never written. Per member, the plugin keeps record counts, your columns, which bands you folded, the reports you exported and the chart options (`charts`).

## Install

In OWOX Data Marts, open **Plugins** and add **Data Explorer**.

---

The rest of this file is for developers.

## Export to Google Sheets

The Data band's header always has an Export menu: the Google Sheets destinations you can use (none: none listed), then Claude and ChatGPT after a separator. A Sheets destination creates an OWOX report from the grid as it is now (the shown columns, the complete filters and your sorts, no row limit), runs it and opens the sheet.

1. Export is always a menu, because the AI items are always there. A new spreadsheet and report are titled "<Data mart> · Data Explorer · <date time>".
2. Export opens a cascading menu. Its first level lists the destinations (the Google Sheets icon and the destination's title), also when there is only one. Hovering a destination, clicking it, or ArrowRight or Enter opens a flyout beside it (to the left when there is no room on the right) with "Update '<report>'" for each report you created from the plugin on it (it applies the grid's current state and runs again) and "New report…". Arrow keys walk a level and Escape closes one.
3. "New report…" asks for a title and a target: a new spreadsheet, or a pasted link of an existing one (its `#gid=` picks the tab, default the first). Share an existing spreadsheet with the destination's Google account as Editor.
4. If OWOX cannot create a spreadsheet (a service-account destination needs a Drive folder), the dialog opens with the message so you can paste a link instead.
5. The status of the run shows next to the button, with a link to the sheet. After 3 minutes without a result it says "Still running" and keeps the link.
6. If creating the report fails after the spreadsheet was made, a retry from the dialog reuses that spreadsheet. If the request timed out or hit a network or gateway error, the report may exist: the dialog closes and asks you to check OWOX before trying again.
7. Only the first 10 sorts are exported. The report keeps every column unaggregated, so the sheet has the grid's rows.
8. The reports you create are remembered per data mart (`exports`, member scope). One that OWOX no longer has is dropped when the menu opens.
9. Export writes only on your click: it creates the spreadsheet, creates or updates the report and runs it (a billed warehouse run). Updating replaces the report's configuration, so aggregations added to it in OWOX are cleared.

### Copy to clipboard

The first group of the Export menu has one item, "Copy to clipboard" (lucide `Copy`). It copies the grid's loaded rows, in grid order with its filters and sorts, as TSV: the visible columns in grid order (joined ones included), a header row of the titles as the grid shows them, `\n` line ends. The text of each cell comes from `displayText` in `src/ui/format.ts`, the same function the grid's cells use, so a DATE or TIMESTAMP is in the viewer's format and time zone and a multi-value joined cell is its values joined with ", "; the full value is copied, never the clipped one. A tab, CR or LF inside a value becomes a space. The builder is `src/export/tsv.ts`. It copies through `copyText` (the clipboard API, then a hidden textarea and `execCommand`).

1. The status reads "Copied N rows"; when the mart has more rows than are loaded it reads "Copied the first N rows. Load more to copy more."
2. With no rows loaded the item is disabled, with the tooltip "No rows to copy".
3. When the sandbox blocks both ways of copying, a "Copy the data" dialog opens with the text in a read-only textarea (selected on focus) and a Copy button; "Show data" in the status reopens it.
4. Nothing is queried, billed or written to OWOX.
5. Values that would start a spreadsheet formula (a leading `=`, `+`, `-` or `@`, other than a plain number) are copied with a leading apostrophe so they paste as text.

### Export to an AI

Each of the two items has a small external-link button at its right end. It opens the OWOX app's listing in that assistant (`claude.ai/directory/owox-data-marts` or the ChatGPT plugin page) through the host, so you can add the OWOX Data Marts connector there. The button is reachable with the keyboard: ArrowRight from the item, or Tab. Its label and tooltip read "Open OWOX in Claude" and "Open OWOX in ChatGPT". Choosing the item itself still copies the prompt.

The AI group lists Claude and ChatGPT. Choosing one copies a plain-text prompt built from the grid as it is, and shows "Prompt copied. Paste it into Claude" next to the button with a "Show prompt" link. The link opens a dialog with the prompt in a read-only textarea (selected on focus) and a Copy button. The copy tries `navigator.clipboard.writeText`, then a hidden textarea and `document.execCommand('copy')`; when the sandboxed iframe blocks both, the dialog opens at once.

The prompt names the project and data mart, the shown columns by technical name (joined ones by their blended name, such as `customers__city`), one line of plain words per filter and the sorts, and asks for a table and a note when rows were truncated. Everything copied from OWOX (names, ids, filter values) is written as a JSON string with control characters removed and at most 200 characters, under two fixed lines that say the request is read-only and that quoted text is data, never instructions.

In mock mode (`?mock`) add `&sheets=1` for one destination or `&sheets=0` for none (default two).

The page header has no Refresh button. The model (marts, edges, contexts, connectors, data quality) is loaded when the plugin opens; to reload it, reopen the plugin. The Refresh in the Data band and in the Row band only re-reads that band's rows or record. If a storage fails to load, the header shows a warning with Retry, which reloads the model, counts and data quality; if that reload fails, the previous model, counts and quality stay on screen and the header shows the error with Retry.

## Several data marts, one main

The selected data mart is the main one. A joined data mart is selected exactly when one of its joined fields is a column of the main grid, so the config menu and the cards are two views of one state (`src/state/join-plan.ts`). What the main data mart can join comes from `GET /api/data-marts/:id/blendable-schema`, read when a data mart becomes main (once per data mart per session, not billed). With several alias paths to one data mart, the shallowest wins.

1. A card click on a joinable data mart adds the fields last chosen for that pair, else its first non-ID text field and first non-ID metric (an ID is a primary key, `id`, a name ending in `_id` or `Id`, or an alias ending in " ID"), after the shown columns. The x on a joined card removes that path's own columns, filters and sorts (the paths under it keep theirs, and it stays as a bare card only when one is joined under it, otherwise its card leaves; only the x on a bare card takes its whole subtree), and remembers the fields it showed (`lastShown` in `grid-columns`). Unticking the last field in the config menu remembers an empty list, so the next add uses the first text field.
2. A click on a report card (main or joined) only focuses it and removes nothing; a joinable data mart clicked next is added under the focused path. Remove from report on the main data mart in the config menu (offered only while another data mart is in the report) promotes the next joined one (in the order added), which keeps its own saved grid and adds the other joined data marts it can join. A click on a data mart the main one cannot join makes it the only selected data mart.
3. The cards shown are the main one, every selected joined data mart, and every data mart connected by an edge to any of them (the main one or a joined one), ordered main first, selected joined data marts next, then breadth first over the edges.
4. Each change is one store step (`setMarts`) that holds the grids it touched, so Undo and Redo put them back.
5. Columns of one data mart sit together: the main data mart's own columns first, then each joined data mart's in the order they were added, each keeping its field order (`orderColumns` in `src/state/column-order.ts`, applied on a card click, a tick in the config menu, a restore of saved columns and Undo/Redo). Export, the AI prompt and Copy to clipboard use the same order.
6. With a joined data mart selected the grid gets a group row above the column titles: one cell per data mart and alias path with its icon and title (with the path added when the same data mart is joined through more than one path), main first. The two header rows stay sticky together and the header line stays under the titles. Joined column titles in the grid drop the `<data mart> · ` prefix (the group names it); Export and Copy headers keep it. Group titles have no x: Remove from report in the config menu does what the x on that path's card does (only that path's own columns go), in the same serialised, saved, Undo-able step. Removing the main data mart deselects it and the next selected data mart is promoted, so the first group is always the main one. The last own column of the main data mart cannot be unticked while a joined one is shown.
7. Tabs: the group row is always there, one tab per data mart (a single tab spanning every column when only the main data mart is selected). The tabs carry no buttons. The config button, labelled Configure, next to the Table / Charts switch in both views, opens the config menu (see Config menu). Unticking a joined data mart's last field deselects it when its panel in the config menu closes.
8. Every data mart remembers the own field names it was showing when it last left the grid, whatever its role (`lastShown` in its `grid-columns` document). Added again as a joined data mart it comes back with those fields (the ones the new main's source offers, else the two-column default); clicked as the main data mart its own columns are exactly those, in that order. The most recent leave wins. The per-pair picks stay as the fallback for older saves.
9. The Data Marts band always shows every data mart that has a column on the grid or a filter on one of its fields (applied or parked), whatever the search, context or storage filters.
10. A column with a filter shows only the filled funnel (Material Symbols `filter_alt`, Apache-2.0) in the primary colour, with the filter in the standard tooltip ("Filter: Last 30 days"); the unfiltered hover icon is the outline funnel.

## Link to this view

The chain button in the page header copies a link to the current view. The link holds the selected source, the main data mart and the columns joined to it, the main grid's filters, sorts, aggregations, date buckets, Unique Counts and row limit, the open record, the Data Marts search, context badges and storage filter, and which bands are folded.

Anyone in the project who can see those data marts opens the same view from the link. Once the link opens, the address goes back to the plugin's main page, so reloading doesn't reapply it.

1. A link is at most 2048 characters, the limit of the host. A view that would need more is not copied, and the page says "This view is too large to link. Remove some columns or filters and try again."
2. Parts the opener can't see, or that were deleted since, are skipped. The rest still shows, with a dismissible notice under the header.
3. A link that can't be read opens the default view, with a notice.
4. Opening a link does not change the opener's saved columns or band choices.
5. The link is compressed, not encrypted. Anyone holding it can decode its filter values, so share it as you would share the data.
6. On OWOX versions without page links the button is hidden.

## Aggregation

Aggregate is a row of the column menu (see Column menu); a Sigma icon next to the title, in the primary colour, shows while the column is aggregated and opens the same panel. It is the popover the OWOX report picker has: "Aggregate by" with the functions the field allows (Sum, Average, Min, Max, Count, Count Unique, Combined, Sample, percentiles; the field's own governance or the join's post-join set wins over the type defaults), and for a date a "Group by bucket" (Day, Week, Month, Quarter, Year) with an optional time zone. A date takes functions or one bucket, never both. Array, JSON, struct and calculated fields have no Sigma: the backend refuses a function or a bucket on them. The popover is headed "Aggregation"; its "Clear" button (an outline button left of Cancel and Apply, off while nothing is set) removes them.

1. As soon as one visible column has a function or a bucket, the grid is grouped: the query sends `aggregation` and `dateTrunc` with exactly the visible columns, and every column without a rule is a group key. Primary keys are not added and no key tie-breaker sort is sent.
2. Each function is its own column, headed `<column> · <Label>` (for example "Amount · Sum"), read from the row key `"<column> | <TOKEN>"`. A bucketed date shows its bucket start ("Nov 2026", "Q4 2026", "2026", or the day).
3. Rows of a grouped grid open nothing: the Row band says "Grouped rows have no single record." and the Data band badge reads "N groups".
4. Sort: a group key sorts as before; an aggregated column sorts through its first function (the backend resolves a sort rule on the column to that output), so only that column has the sort control. With no sort of your own the grid sorts ascending by its first group key, so "Load more" pages stay stable (that sort is sent and exported, but no arrow marks it).
5. Filters stay WHERE filters on the raw values. The filter popover of an aggregated column says "Filters rows before they are aggregated".
6. Export to Sheets sends the same `aggregationConfig` and `dateTruncConfig`; `autoAggregationOptOut` lists the columns with no function. Copy to clipboard copies the grouped table as shown. The AI prompt lists "Aggregations" in words.
7. Aggregations and buckets are saved with the grid (`aggregations` and `dateTrunc` in the `grid-columns` document); rules of a column that is no longer shown are dropped; a card click or Undo carries them with the grid. Reset clears filters and sorts, not aggregations.
8. A shown array, JSON or struct column would become a group key the warehouse refuses. A calculated column is fine: the backend groups by a row-level one and projects an aggregate-level one. While an array, JSON or struct column is shown, the grid sends no grouped query and says `"<column>" can't be grouped: hide it.`; Export is off, and the Apply button of another column's popover is off with the same note. Hide the column to get the groups back. Rules a saved grid or a view link holds on such a column, or that the field does not allow, are dropped.
9. Mock mode implements all the functions (percentiles by interpolation, Combined with ", ", Sample takes the first value) and the date buckets.
10. Unique Count is a metric of a data mart, not of a column: the number of its distinct records, counted by its primary key (a key hidden for reporting or a composite key counts too). It is the first row of each mart's fields in the config menu ("Unique Count", offered whenever the backend says the metric is available, for the main mart or a joined one), and it adds a read-only numeric column headed "Unique Count" after that mart's own columns. The key column's own function menu still offers "Count Unique" as an aggregation of that field; the two are different things. A Unique Count groups the rows like a function: the query sends `uniqueCount: [<alias path>]` (`''` is the main mart) with the shown columns as group keys, the row key is `Unique Count` (a joined mart's is `<alias_path>__unique_count`), and no hidden field is named. It sorts by that key; its header menu has Sort and "Remove Unique Count", no filter and no function. It is part of the grid state (`uniqueCount`): Undo, the saved view (`uc` in `gridView`) and the view link (`uc`) carry it, and a path the mart can no longer count, or a joined mart with no column on the grid, is dropped when the grid opens. Export to Sheets sends it as `uniqueCountConfig` (null when none), loading a report maps `uniqueCountConfig` (`true` is the main mart) into the grid, and Copy to clipboard includes the column. Create Data Mart and the AI prompt leave it out.

## Config menu

The config button (labelled Configure; its accessible name is `Configure data`) sits next to the Table / Charts switch in both views. Its menu lists:

1. In Charts only, first: Add chart (a radio of the chart types the shown columns allow, or a note on what is missing) and Charts, a list of ticks for the scorecards, Sparklines and each chart. Hidden ones come back from there.
2. The data marts of the report, shown first in grid order, then, after a separator, the ones on a path with no column. Each row has the mart's icon and title, and a (?) with its description when it has one.
3. A data mart opens its fields: field search, Select all, Clear, the Unique Count row, locked fields and the column menu of each field, hidden or not. The shown fields come first. When something can join under the data mart, a separator and "Joinable Data Marts" follow, each opening the same panel. Remove from report ends the panel, except for the only data mart of the report, a data mart on a path with no column and a joinable one, which have none.

What the menu lists is taken when it opens and stays until it closes, and so are the rows of each panel: a row a panel did not have when it opened (Remove from report, Unique Count) does not appear later, and one it had stays, disabled while its action is not available, so a tick never moves the rows under the pointer. Escape closes one level at a time. Ticking a field of a data mart that is not in the report joins it, and so does a filter or slice set from one of its fields: its badge shows, and one Undo takes both back. Clear on a data mart never leaves the grid without a column.

## Column menu

Every column title in the Data band has a green menu icon (three lines, each shorter than the one above). It opens a Sheets-style menu with up to five rows: Filter, Aggregate, Format, Sort and, after a divider, Hide column. A row that does not apply to the column is left out: Aggregate where the column cannot aggregate, Format on text and boolean columns, Sort where the column cannot sort. Filter, Aggregate and Sort open the same editors as before (Apply, Clear and Escape work the same); Hide column does what unticking the column in the config menu does. Next to the title, the filter, aggregation and sort icons show only while that setting is on, and clicking one opens the menu with that row open. The icon turns white on green while the column has any of them or a format of its own.

Escape closes the open submenu, then the menu.

### Formats

Format changes only what the grid shows.

1. Numbers: Automatic (grouped, `1,223`), Plain number (`1223`), Percent (the value times 100, up to 2 decimals, `12.5%`) and Money with USD, EUR, GBP or UAH (2 decimals).
2. Dates and timestamps: Automatic, Date, Date and time, Time. Text and boolean columns have no formats.
3. For a number or date column with no project pick, the plugin asks the AI (the one set up for smart search; no AI configured, nothing is sent) once per data mart per session. It gets the data mart title, the column name, its alias and its description, never sample values. Its answer is checked: an unknown format or currency is dropped, and a failure is silent. A pick may name a currency outside the four above, which then shows in the list.
4. The pick is stored for the project (`column-formats-project`); your own choice is stored for you (`column-formats-member`), keyed by the data mart. Order: your choice, then the project pick, then Automatic. Choosing Automatic is a choice: it keeps a project pick from applying to you.
5. Copy to clipboard and Export keep the raw values: plain digits for numbers, dates as the Automatic look. A percent or money format never reaches them.
6. A joined column is keyed by its blended column name, and the AI gets the joined data mart's title for it.

### Full screen

The icon at the right of the Data band title (next to the fold chevron) makes the Data band fill the plugin area: 100% of its height, the title row on top, the grid taking the rest and scrolling inside it. The page header and the other bands are hidden, not removed, so the grid keeps its selection, scroll position and filters. The same icon or Escape leaves. Escape does nothing to full screen while a menu, popover or dialog is open, or while a field has focus: it closes that first. With a cell selected and the grid focused, the first Escape clears the selection. The fold chevron is hidden while the band is full screen. Opening a row (a click on it) does not leave full screen; the Row band is hidden with the rest, so exit to see the opened row (the Data hint says so). Full screen is not saved: the page always opens in the normal layout.

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
2. Publish a GitHub Release. The `Deploy to owox.app` workflow tests, builds and deploys it to https://data-explorer.owox.app/. Its `VOID_TOKEN` is in the `owox-app` environment and lasts at most 90 days.
3. In OWOX: Plugins, then Publish Plugin, then `owox/data-explorer`.

## Smart search

The search icon in the Data Marts band opens an input with a go button (an arrow) at its end. Enter or go runs the search. The cursor is in the input as soon as the box opens, whether from a click on the search icon or, on a first visit with no main data mart, by itself. In the dropdown under the box, the ad-hoc report row shows the search icon in front of it when no AI is set up. Escape closes the box and changes nothing that is applied. While results show, the query stays visible with an x that clears it and brings the band back. A query takes up to 256 characters; OWOX's search takes 2 or more, so a one-character query is a title match only. A new query cancels the one that is running.

1. **OWOX search first.** The plugin calls `GET /api/search` with `q`, `entityTypes=DATA_MART`, `excludeDrafts=true` and `limit=10`, the engine behind the OWOX MCP tool `get_relevant_data_marts_by_prompt`. It keeps the data marts that are in the plugin's model and that you can open, ranked by the engine's score, five at most.
2. **AI discovery.** If the search finds nothing (or fails) and the project has an AI model, the `fast` model picks up to five data marts from the catalogue (id, title and a short description of each, 200 marts at most). Every id it returns is checked against the model.
3. **AI view.** If a data mart was found and a model is there, the `reasoning` model (`fast` when there is none, and `fast` again if `reasoning` fails) proposes the best data mart's view: columns, filters, sorts and, when the query asks for totals, aggregations. It can use the same filters as the grid, date presets included (yesterday, last month, last 30 days). The answer goes through the same checks a view link gets: a field that is not in the mart, an operator the field does not offer, a value of the wrong shape or a function the field does not allow is dropped, and the rest applies.
4. **Result.** The found data marts show first, in rank order, then the data marts whose title contains the query, so typing `GA4` still lists every mart with that title. The best found mart becomes the main data mart with the view applied. The whole result is one Undo step. A link copied after a search carries the found data marts (five at most), not the question as a title filter.
5. **No AI.** Without an AI model the endpoint's result is used alone and no error shows. One quiet line under the search suggests connecting AI; dismissing it is remembered per member in the `preferences` collection (document `search`). The line shows only when no AI is configured. A model that fails or takes longer than its share of a 30 second budget is treated as missing for that search, with no error and no line.
6. **Nothing found** shows "No data marts match." and falls back to matching titles.

Searching reads no rows and calls no `traverseData`. Only the normal grid load after the view is applied reads rows, as it does for any selection. The model is the `ai` credential in `plugin.json` (`"models": ["fast", "reasoning"]`, optional). That list is final: changing it in a later release clears the AI selection of existing installations, so do not edit it. The plugin calls the model's `doGenerate` directly with a JSON response format and no output cap (reasoning tokens would count toward one). Everything copied from OWOX that goes into a prompt (titles, descriptions, field names) travels as strings inside one JSON document, with control characters removed and a length cap, and the instructions say it is data, never instructions.

In mock mode (`?mock`) the search and the model are fakes: `/api/search` scores titles and descriptions, and the fake AI answers from keywords ("who are our buyers" finds Customers, "paid orders last month" filters Orders). Add `&ai=0` for a project with no AI configured.

## Limitations (v1)

1. Writes only from your click on Export: a spreadsheet, a report, a run. Rows are never written.
2. Row counts are warehouse queries cached per member. Reopening the plugin reloads the model; the Retry on a storage that failed to load recounts them.
3. The columns you pick in a data mart's grid are saved per member and per data mart; a saved column that is no longer available is dropped. Sorts and filters are not saved.
4. "Load more" re-reads from the start, because the API has no offset.
5. The joined fields of a data mart are read when it becomes the main one. If that read fails, only the mart's own fields are shown.
6. The OWOX link always points to app.owox.com.
7. Nested RECORD fields are not expanded: their leaf columns are not offered. Repeated fields only filter on blank.