# Review of src/ui: simplification and optimisation

Scope: `src/ui/` at origin/main (48427cd), tests excluded. Read-only review, no files changed.
Paths are relative to `src/ui/`. Findings are ranked by impact divided by effort.
Effort: S is under an hour, M is half a day, L is more than a day.

## Totals

1. 24 findings: 16 S, 7 M, 1 L.
2. Confidence: 19 high, 5 medium.
3. About 420 lines removable from findings 1 to 23, and about 150 more if finding 24 is done.
4. Render savings: findings 1, 2, 7 and 8 stop work that today repeats on every hover, pointer move or selection change.
5. Dead code is small: one unused re-export, one test-only re-export, one unreachable branch, about 15 needless `export` keywords.

## Findings

### 1. Every card re-creates its ResizeObserver on every hover

1. Where: `bands/cards.tsx:286-295`, fed by `bands/CardBands.tsx:271` and `bands/MartsCanvas.tsx:123`.
2. Problem: `contextsOf()` returns a new array on each render, and the `Contexts` layout effect lists `contexts` as a dependency, so each card disconnects and rebuilds a ResizeObserver and reads `offsetWidth` and `clientWidth` on every `CardBands` render. `CardBands` re-renders on every hover change, wire-tip pointer move and drag move.
3. Before: `useLayoutEffect(() => { ...new ResizeObserver(judge)... }, [shown, contexts]);`
4. After: key the effect on content, `const key = contexts.map((c) => c.id + c.name + (c.icon ?? '')).join('|')` and `[shown, key]`. Or build `contextsByMart` once in a `useMemo` over `model` in the two parents.
5. Impact: removes N observer rebuilds and 2N forced layout reads per hover, where N is the number of cards on screen. No lines removed. Risk is low.
6. Effort S. Confidence high.

### 2. Header and cell renderers defined inside the `columns` memo force four workarounds

1. Where: `explorer/MartGrid.tsx:408-432`, with the workarounds at 141-144 (`GridEnv`), 212-214 (`formatOfRef`), 383-389 (`kept` / `onScreen`), 394 (`shownByName`).
2. Problem: `flexRender` renders any function as a component (`node_modules/@tanstack/react-table/dist/FlexRender.js:4-6`), so a rebuilt `columns` array gives every header a new component type and React remounts it, which closes an open menu. The code keeps `columns` stable with a context, a ref that mirrors `formatOf`, and a state copy of the field list.
3. Before: `header: () => <div className="dm-hdr">...</div>` and `cell: ({ row }) => ...formatOfRef.current(...)` built per output inside `useMemo`.
4. After: module-level `HeaderCell({ field, output, lead })` and `BodyCell({ row, field, output, format })`, rendered as `<HeaderCell key={o.key} .../>`. A stable component type with a stable key never remounts, whatever its props do. Then delete `formatOfRef`, the `kept` state, `shownByName`, and pass sorts as props or keep one context.
5. Follow-up: `@tanstack/react-table` is imported only in this file and is used only for `getHeaderGroups`, `getRowModel` and `flexRender`. With module-level components, `outputs.map` and `rows.map` replace it and the dependency can go. That is a dependency change, so it needs your decision.
6. Impact: about 25 lines and three indirections removed, and a format change can repaint cells through props. Risk is medium: the popover-stays-open tests cover the behaviour.
7. Effort M. Confidence high.

### 3. Parked and applied filters are four states that one map and a derivation would replace

1. Where: `explorer/MartGrid.tsx:225-257`, and again at 286-290, 312-315, 343-346, 401-402, 461-462, 715.
2. Problem: `filters`, `parked`, `slices` and `parkedSlices` hold a partition of two maps by "is the field offered now". The partition is recomputed by hand in six places, and a render-phase block (231-257) moves entries between the pairs when the schema changes.
3. Before: `const [parked, setParked] = useState(...filter(!offeredNow))`, `const [filters, setFilters] = useState(...filter(offeredNow))`, plus the same for slices, plus the `seenOffered` block.
4. After: `const [allFilters, setAllFilters] = useState(seed.saved?.filters ?? {})`, then `const filters = useMemo(() => pick(allFilters, offered), [allFilters, offeredKey])`. Same for slices. `onChange` sends `allFilters` as it is. The `seenOffered` block shrinks to the two toast messages, which share one helper (lines 249-256 are the same sentence twice).
5. Impact: about 30 lines and eight setter calls removed, and "parked filter lost" bugs become impossible because nothing is moved. Risk is medium: the HAVING cleanup at 343-346 treats parked and applied rules differently and must keep doing so.
6. Effort M. Confidence high.

### 4. Three dialogs each hand-roll the same portal, backdrop, Escape listener and focus trap

1. Where: `explorer/ExportMenu.tsx:449-466` (`TextDialog`), 553-598 and 687-689 (`ExportDialog`), 754-766 and 806-808 (`CreateMartDialog`).
2. Problem: the Escape `keydown` effect appears three times, the Tab trap three times with three different selectors, and the `fixed inset-0 z-50 ... bg-black/40` shell three times. Only `ExportDialog` pulls focus back when it falls out (588-598), so the other two can lose focus behind the backdrop.
3. Before: per dialog, `useEffect(esc listener)`, `const trap = (e) => {...}`, `createPortal(<div className="fixed inset-0 ..." onClick={onClose} onKeyDown={trap}>...`.
4. After: one `Modal({ label, onClose, canClose = true, width, children })` in `ui/Modal.tsx` that owns the portal, backdrop, Escape, the `tabStops` trap from `ExportDialog` and focus return. Each dialog keeps only its body.
5. Impact: about 60 lines removed and one focus behaviour instead of three. Risk is low to medium: `CreateMartDialog` blocks Escape while running, which `canClose` covers.
6. Effort M. Confidence high.

### 5. Three copy flows keep six states that are one

1. Where: `explorer/ExportMenu.tsx:69-77`, 241-287, 298-302, 385-387, 437-502.
2. Problem: `copied/promptOpen`, `data/dataOpen` and `sqlCopied/sqlOpen` are mutually exclusive. Each copy function clears the other two by hand, there are three `Copied*Text` components with the same icon logic, and three `TextDialog` instances.
3. Before: `setResult(null); setData(null); setSqlCopied(null); setCopied({ assistant, prompt, ok }); if (!ok) setPromptOpen(true);` in three variants.
4. After: `const [copy, setCopy] = useState<{ kind: 'prompt' | 'data' | 'sql'; text: string; ok: boolean; message: string; dialog: {...} } | null>(null)` and `const [copyOpen, setCopyOpen] = useState(false)`, one `async function copyOut(kind, text, describe)`, one `CopiedText`, one `TextDialog`.
5. Impact: about 45 lines removed, and the reset on mart change (line 77) becomes two setters instead of six. Risk is low.
6. Effort S. Confidence high.

### 6. Selection geometry is written three times while `blockOf` already computes it

1. Where: `explorer/MartGrid.tsx:584-610`, against `explorer/copySelection.ts:9-18`.
2. Problem: `rect`, `span`, `inCols`, `inRows`, `inBlock`, `edges` and `corner` branch on cell block, column span and row span, and `edges` repeats the same four comparisons three times. `blockOf(sel, rowCount, colCount)` already returns `{ r0, r1, c0, c1 }` for all three kinds.
3. Before: `if (rect) {...} else if (span?.kind === 'col') {...} else if (span) {...}`.
4. After: `const block = sel && !(cellSel && !cellSel.to) ? blockOf(sel, rowCount, outputs.length) : null;` then `inBlock = (r, c) => !!block && r >= block.r0 && r <= block.r1 && c >= block.c0 && c <= block.c1`, one four-line `edges`, and `corner = block && { row: block.r1, col: block.c1 }`.
5. Impact: about 15 lines removed, one source of truth shared with copy. Risk is low: the selection tests are detailed.
6. Effort S. Confidence high.

### 7. A selection change re-renders every cell of the table

1. Where: `explorer/MartGrid.tsx:558-574` (`menuEnv`), 611, 649, 660, 703-706 (`setSelected`), 753, 766-774.
2. Problem: the whole table body is rendered inline in `Grid`, so each arrow key or drag `mouseenter` re-runs `CellValue` formatting for up to 200 rows times the column count (`PAGE_SIZE` is 200), and each cell is a Radix tooltip root (`OverflowTip`). The same render rebuilds `menuEnv`, a new context value, so every `ColumnControls` re-renders too. Per cell the render also does `byName.get(outputByKey.get(id)!.column)` and `numericOutput(id)`; line 753 does the `outputByKey` lookup four times per header.
3. Before: `table.getRowModel().rows.map((r, ri) => <tr>...{r.getVisibleCells().map((c, ci) => <td data-selected=... data-edge={edges(ri, ci)} ...>`.
4. After: `const GridRow = memo(function GridRow({ row, ri, cols, marks }))` where `marks` is a short string for that row's selection state (empty for rows outside the block), and `cols` is a memoised `outputs.map((o) => ({ key, maxWidth, numeric }))`. Wrap `menuEnv` in `useMemo`, which needs `setFilter`, `setSlice`, `changeColumns` and `reorder` in `useCallback`.
5. Impact: a selection move re-renders the rows it touches instead of all 200, and header controls stop re-rendering on selection. No lines removed. Risk is medium: drag handlers must stay stable for the memo to hold.
6. Effort M. Confidence high for the cause, medium for the size of the gain (not profiled).

### 8. Pointer-move state lives in `CardBands`, so every move re-renders all cards

1. Where: `bands/CardBands.tsx:98`, 279-283 (`wireTip`), 103 and 437 (`drag`); `bands/MartsCanvas.tsx:44-53` and 172-173.
2. Problem: `setWireTip({ text, x, y })` runs on each pointer move over a line, and `useCardDrag` / `useCanvasDrag` set state on each move while dragging. Both states sit in the component that renders every card. `ColumnDragLayer` (`explorer/ColumnDrag.tsx:33-37`) already shows the fix this codebase uses.
3. Before: `const [wireTip, setWireTip] = useState(...)` in `CardBands`, updated from `onPointerMove`.
4. After: a `WireTipLayer({ canvas })` child that attaches its own `pointermove` listener and holds the state, and a `CardDragLayer` that holds the drag position and reports only `overMain` and `dragging` changes upward.
5. Impact: pointer moves re-render one small layer instead of the bands. Risk is low.
6. Effort S for the tip, M with the drag ghost. Confidence high.

### 9. Three press-then-drag state machines share most of their code

1. Where: `bands/useCardDrag.ts:18-79`, `bands/useCanvasDrag.ts:18-87`, `explorer/ColumnDrag.tsx:48-206`.
2. Problem: `swallowNextClick` is copied verbatim three times (useCardDrag 25-29, useCanvasDrag 25-29, ColumnDrag 56-60). The first two hooks also share `press`, `dragging`, `cancelled`, `START_PX`, the lost-release check, Escape handling and the five listener registrations line for line.
3. Before: two hooks of about 60 lines each that differ in what they pick up and what a drop means.
4. After: `usePressDrag<T>({ root, pick: (target) => T | null, onMove, onDrop, active })` in `bands/usePressDrag.ts` plus an exported `swallowNextClick`. `useCardDrag` and `useCanvasDrag` become about 15 lines each. `ColumnDrag` only imports `swallowNextClick`, since its auto-scroll and re-measure loop are its own.
5. Impact: about 60 lines removed, one place to fix pointer edge cases. Risk is medium: `useCanvasDrag` clears `cancelled` on a buttonless move (line 50) and `useCardDrag` does not, so pick one behaviour on purpose.
6. Effort M. Confidence high.

### 10. Hover-intent submenu logic is copied in three menus

1. Where: `explorer/ColumnMenu.tsx:100-116`, `explorer/FilterEditor.tsx:174-197`, and `src/charts/ChartMenu.tsx:17` (named overlap, outside scope).
2. Problem: each menu builds a `HoverIntent`, clears it on unmount, and repeats `open` with the `seq` arithmetic, `hoverRow`, `hoverOther`, `closeSub`, and the `editing()` DOM query (ColumnMenu 111 and FilterEditor 192 differ only in the selector).
3. Before: `const [intent] = useState(() => new HoverIntent()); useEffect(() => () => intent.clear(), [intent]); const open = (key, row, focus) => {...}; const hoverRow = ...`.
4. After: `const { sub, open, hoverRow, hoverOther, leaveRow, closeSub } = useSubmenu<K>({ isEditing })` in `MenuParts.tsx`. The `HoverIntent` class becomes private to it.
5. Impact: about 25 lines removed and the three menus cannot drift. Risk is low.
6. Effort S. Confidence high.

### 11. Arrow, Home and End roving focus is implemented four times

1. Where: `explorer/MenuParts.tsx:65-71`, `explorer/ExportMenu.tsx:421-427`, `SheetsChecklist.tsx:61-76`, `bands/useSmartSearch.ts:226-234`.
2. Problem: the same wrap-around index arithmetic and key switch, with small differences (the checklist clamps and does not wrap).
3. Before: `const go = (to) => {...}; if (e.key === 'ArrowDown') go(at + 1); else if (e.key === 'ArrowUp') go(at - 1); else if (e.key === 'Home') ...`.
4. After: `rovingTarget(key, at, length, { wrap })` returning the next index or null, in `ui/roving.ts`. Each caller focuses or highlights the result.
5. Impact: about 20 lines removed and one keyboard contract for menus and lists. Risk is low.
6. Effort S. Confidence high.

### 12. `ColumnMenu` repeats its indicator buttons, editor panels and focus-after logic

1. Where: `explorer/ColumnMenu.tsx:270-295`, 160-186, 119-138.
2. Problem: four indicator buttons differ only in tooltip, label, icon and sub key. Three editor `Panel` blocks share the wrapper and the `data-popover-body` div. `hide` and `moveBy` repeat the "find the icon by `data-field` after a timeout" code around a module-level `focusTimer`.
3. Before: four `<Tooltip><button ... onClick={(e) => toggle(e.currentTarget, 'filter')}>` blocks.
4. After: `const marks = [{ sub: 'filter', on: !!filter, tip, label, icon }, ...]` and one `marks.filter((m) => m.on).map(...)`; `EditorPanel({ row, seq, label, onEscape, children })`; `const focusIconOf = (head, fieldName) => {...}` used by both `hide` and `moveBy`.
5. Impact: about 35 lines removed; `MenuPopup` drops from about 130 lines to about 95. Risk is low.
6. Effort S. Confidence high.

### 13. `MartCard` takes props that every caller derives the same way

1. Where: `bands/cards.tsx:125-195`; call sites `bands/CardBands.tsx:317-344`, 355-376, 383-400, 411-430 and `bands/MartsCanvas.tsx:149-167`, 180-195.
2. Problem: all six call sites pass `freshness={mart.dataLastUpdatedAt}`, which the card can read from `mart`. The three ghost call sites pass `count={{ state: 'idle' }}` and two no-op callbacks, though `ghost` already switches counting off (`cards.tsx:201` and `256`). `ticked` is defined twice in `CardBands` (143 and 169) and `contextsOf` twice (CardBands 271, MartsCanvas 123).
3. Before: `freshness={mart.dataLastUpdatedAt} count={{ state: 'idle' }} onRetryCount={() => undefined} onNeedCount={() => undefined}`.
4. After: drop `freshness`; make `count`, `onRetryCount` and `onNeedCount` optional and ignored for a ghost.
5. Impact: about 20 lines removed across six call sites. Risk is low.
6. Effort S. Confidence high.

### 14. Grid edit handlers repeat the same steps

1. Where: `explorer/MartGrid.tsx:540-556` and 561 (filter, slice, chart filters), 396-405 and 457-464 (aggregation), 306 and 325 (grid state object).
2. Problem: `setFilter`, `setSlice` and `applyChartFilters` each do "note if unapplied, `markEdit()`, set or delete a map entry, `setLimit(PAGE_SIZE)`". `changeAgg` and `changeColumns` both do "set agg, `dropOrphanHaving` on two maps, `saveAggregation`". The `GridState` literal is built by hand twice.
3. Before: `markEdit(); setFilters((cur) => { const n = { ...cur }; if (f) n[name] = f; else delete n[name]; return n; }); setLimit(PAGE_SIZE);` twice, with a variant.
4. After: `const withEntry = (m, k, v) => ...`, `const applyAgg = (next) => {...}`, and `const current = useMemo<GridState>(...)` used by both the adoption check and the save effect. Eight handlers start with `markEdit()` and end with `setLimit(PAGE_SIZE)`; one `edit(fn)` wrapper covers them.
5. Impact: about 20 lines removed. With finding 3 done, `dropOrphanHaving` is called once per change, not twice. Risk is low.
6. Effort S. Confidence high.

### 15. Ghost timing and focus-after-add are implemented twice, once per view

1. Where: `bands/CardBands.tsx:101`, 151-157 against `bands/MartsCanvas.tsx:55-61`; `bands/CardBands.tsx:111-131` against `bands/MartsCanvas.tsx:40`, 68-74.
2. Problem: both views keep "the card whose ghosts show follows the hovered card, with a 400 ms grace" as a state, a render-phase set and a timer effect. Both keep a "focus this card once it renders" state with an effect that queries by `martElementId`.
3. Before: `const [ghostOf, setGhostOf] = useState(null); if (ghostOf === null && overShown) setGhostOf(hoveredMart); useEffect(() => { ...setTimeout(..., 400)... })`.
4. After: `useLingering(target, hold, 400)` and `useFocusCardWhenRendered(root)` in `bands/`, used by both.
5. Impact: about 20 lines removed, and the 400 ms constant lives in one place. Risk is low.
6. Effort S. Confidence medium: the two effects differ slightly in when they keep the current value.

### 16. The export menu writes each disabled-or-enabled item twice

1. Where: `explorer/ExportMenu.tsx:341-381`, and `menu.current?.querySelector('summary')?.focus()` at 307, 385, 386, 387, 388, 389, 412, 431.
2. Problem: Copy to clipboard, Copy SQL and Create Data Mart each have a disabled branch wrapped in a tooltip and an enabled branch with the same icon and label. The summary-focus expression appears eight times.
3. Before: `{copyOff ? <Tooltip content={copyOff}><span className="block"><button disabled ...>...</button></span></Tooltip> : <button onClick=...>...</button>}` three times.
4. After: `ExportItem({ action, icon, label, off, tip, onClick })` and `const focusSummary = () => menu.current?.querySelector<HTMLElement>('summary')?.focus();`.
5. Impact: about 25 lines removed. Risk is low.
6. Effort S. Confidence high.

### 17. `storageUnavailable` duplicates `storage`, and one branch cannot run

1. Where: `explorer/MartGrid.tsx:717`, `explorer/ExportMenu.tsx:34` and 116.
2. Problem: the only caller passes `storage={martStorage} storageUnavailable={!martStorage}`, so the "storage isn't loaded" message at line 116 is unreachable outside tests. `aggregation`, `slices`, `ownSorts`, `loading`, `run`, `edges`, `titles` and `joinedMarts` are optional in `Props` but always passed, so their `?? []` and `?? new Map()` fallbacks serve tests only.
3. Before: `if (!p.storage) return { reason: p.storageUnavailable ? "...isn't available to you" : "...isn't loaded" };`
4. After: drop the prop, keep the first message, and make the always-passed props required.
5. Impact: about 5 lines and one prop removed; the props type says what the component needs. Risk is low: one test names `storageUnavailable` and needs an update.
6. Effort S. Confidence high for the prop, medium for the optional props (tests may rely on omitting them).

### 18. Dead and needless exports

1. `explorer/CellValue.tsx:6`: `export { formatValue }` has no importer anywhere in `src`. Delete it.
2. `explorer/ColumnMenu.tsx:16`: `export { HOVER_MS }` is imported only by `ColumnMenu.test.tsx:7`. Import it from `MenuParts` in the test and delete the re-export.
3. Exported but used only in their own file (grep over `src`, tests included): `ITEM` (`MenuParts.tsx:17`), `FORMAT_LABELS`, `CURRENCIES`, `currenciesFor`, `SubKey` (`ColumnMenu.tsx:18`, 57-61), `TIME_ZONES` (`AggregationEditor.tsx:9`), `RECENT_MS` (`ExportMenu.tsx:57`), `isTruncated` (`Tooltip.tsx:27`), `isMac`, `undoTip`, `redoTip` (`header/HistoryButtons.tsx:10-15`), `NO_KEY_NOTE` (`bands/DataBand.tsx:13`), `SEARCH_DEBOUNCE_MS` (`bands/useSmartSearch.ts:13`), `MartsView` (`bands/CardBands.tsx:30`), `GridSeed` (`MartGrid.tsx:59`), `ColumnDragView`, `CanvasDrag`, `CardDrag`, `MultiOption`. Drop the `export` keyword.
4. `explorer/MartGrid.tsx:93`: `SeededGrid` types `onRows` as `(label) => void` while `MartGrid` and `Grid` take three arguments. Use one shared props type.
5. Impact: about 3 lines, and a smaller public face per module. Risk is none.
6. Effort S. Confidence high.

### 19. `App` keeps the fold choice in more places than it reads

1. Where: `App.tsx:35-65`, 100-106, and 80 with `useViewLink.ts:73-93`.
2. Problem: `folded()` reads `touched ?? linkFolds ?? folds ?? default`. `toggle` writes the same value into both `folds` and `touched`, and `touched` always wins, so the `setFolds` call at 102 and the `...own` merge at 52 change nothing. The `clicked` ref (41, 53-54, 105) holds exactly what `touched` holds until the saved folds arrive. Separately, line 80 passes a new object as `currentFolds` on every render, so the `useCallback` around `copy` never returns a cached function, and nothing memoised consumes it.
3. Before: `setFolds((f) => ({ ...f, [band]: now })); setTouched((t) => ({ ...t, [band]: now })); ... else clicked.current = {...}`.
4. After: `setTouched(...)` only; on load, `if (Object.keys(touched).length) write(touched)` through a functional read; `folds` holds only what was saved. Drop the `useCallback` on `copy`.
5. Impact: about 8 lines and one ref removed. Risk is low to medium: the write-after-load order is covered by tests on saved folds.
6. Effort S. Confidence medium.

### 20. Six "latest value" refs can be one hook

1. Where: `bands/useSmartSearch.ts:55-56`, `bands/useCanvasDrag.ts:16-17`, `bands/useCardDrag.ts:16-17`, `bands/cards.tsx:198-199`, `bands/MartsCanvas.tsx:43` and 95, `explorer/ColumnDrag.tsx:46-47`, and `bands/useCardClick.ts:31-39`.
2. Problem: each writes `const latest = useRef(x); useEffect(() => { latest.current = x; });` so a long-lived listener can read fresh props.
3. Before: two lines per site, plus `latest.current.` at each read.
4. After: `useEffectEvent` (stable in React 19.2, the project is on 19.3) for the callbacks called from listeners set up in effects: `const onDrop = useEffectEvent(props.onDrop)`. For plain values, a three-line `useLatest(value)`.
5. Impact: about 6 lines, and the intent is named. Risk is low. `useCardClick` also resolves waiters in that effect, so leave it as it is.
6. Effort S. Confidence medium: check each call site is inside an effect-registered listener before switching to `useEffectEvent`.

### 21. `Grid` is one 595-line component with four separable concerns

1. Where: `explorer/MartGrid.tsx:190-784`.
2. Problem: one function holds joined-source loading, filter parking, page adoption, aggregation cleanup, query building, column defs, mart group tabs, cell selection with drag, copy and keyboard, and the table markup. It has about 30 `useState` calls and five render-phase state adjustments.
3. After, in this order, each step safe alone:
   1. `useGridSelection({ rowCount, colCount, charts, scroller })` in `explorer/useGridSelection.ts`: lines 575-707, about 130 lines, returns `sel`, the per-cell marks and the handlers. Do finding 6 first.
   2. `GroupHeaderRow` component: lines 728-750 with `remove` (505-528) and `fieldsOf`.
   3. `useParkedFilters` or the derived form from finding 3: lines 225-257.
   4. `GridToolbar`: lines 714-718.
4. Impact: `Grid` drops to about 300 lines; the selection logic gets unit tests without a table. No net line change. Risk is low per step.
5. Effort M. Confidence high.

### 22. `ExportMenu.tsx` is four components and a hook in one 864-line file

1. Where: `explorer/ExportMenu.tsx`: `ExportMenu` 62-434, `TextDialog` 446-481, `useMartReports` 520-534, `ExportDialog` 541-714, `CreateMartDialog` 727-864.
2. Problem: the three dialogs share nothing with the menu but `messageOf` and the focus-return callback, and `CreateMartDialog` belongs with `src/datamart/`.
3. After: `explorer/export/ExportMenu.tsx`, `ExportDialog.tsx`, `CreateMartDialog.tsx`, `TextDialog.tsx`, with `Modal` from finding 4. The `follow()` function (174-223) moves to a `useExportFlight` hook.
4. Impact: no net lines; each file under 250 lines. Risk is none (a move).
5. Effort S. Confidence high.

### 23. `CardBands` mixes wire building, ghost timing, focus repair and four card blocks

1. Where: `bands/CardBands.tsx:41-440`, the wire memo at 180-218, the render IIFE at 306-404.
2. Problem: the wire list is built in a 40-line memo keyed on joined strings (`idsKey`, `treeKey`) that are split back into arrays inside (181, 221). The card list is an immediately invoked function with a nested `reportCard` and four `MartCard` blocks.
3. After: `buildBandWires(model, view, tree, shownIds, ghostIds, focusGhosts, joinSources)` as a pure function in `bands/band-wires.ts` (testable without React), and a `BandCards` component for lines 306-432. With finding 13 the four card blocks share a `common` props object.
4. Impact: `CardBands` drops to about 250 lines. Risk is low to medium: the string keys exist to keep wire identity stable across hovers, so the pure function must be called inside the same memo.
5. Effort M. Confidence high.

### 24. The column menu hand-rolls positioning, dismissal and keyboard that Radix already ships here

1. Where: `explorer/MenuParts.tsx:23-82`, `explorer/menuPlacement.ts:1-34`, `explorer/ColumnMenu.tsx:252-266`, 106-112.
2. Problem: `Panel` re-measures in a layout effect on every render, listens for resize, runs a ResizeObserver, and does its own flip and clamp. `ColumnControls` adds capture-phase `pointerdown` and `scroll` listeners for dismissal. "Is a field being edited" is stored as a `data-edited` DOM attribute set from three places (MenuParts 75, ColumnMenu 107) and read back with `querySelectorAll` (ColumnMenu 111, FilterEditor 192). `@radix-ui/react-popover` is already a dependency and does placement, collision, outside-press and Escape.
3. After: `Panel` built on `Popover.Root` with `Popover.Anchor virtualRef` and `Popover.Content side/align/collisionPadding`; keep `Row` and the roving keys; replace `data-edited` with a `dirty` ref passed through context.
4. Impact: about 150 lines removed (`menuPlacement.ts`, half of `Panel`, the dismissal effect). Risk is high: submenu-beside-row placement, the date flyout with `returnTo`, and about ten menu test files depend on current behaviour. This changes a cross-cutting pattern, so it needs your decision before any work.
5. Effort L. Confidence medium.

## Checked and left alone

1. `bands/wires.ts`: imperative on purpose, with its four invariants written down. No change proposed.
2. `explorer/ColumnDrag.tsx`: the state already lives in a leaf layer; only `swallowNextClick` is shared (finding 9).
3. `explorer/useMartRows.ts`: the `AbortController` and `readKey` ref guard billed warehouse runs. No simpler form keeps "columns only shrank, read nothing".
4. `useModelData.ts` `useCardStatus`: the queue, generation and sequence refs each answer a stated race. No change proposed.
5. `let live = true` cancellation appears 13 times in `src/ui`. A shared `useAsync` would save about 25 lines but each site sets state differently on failure, so the gain is small.
