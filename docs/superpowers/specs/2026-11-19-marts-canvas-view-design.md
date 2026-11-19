# Canvas view for the Data Marts band

Date: 2026-11-19. Status: approved in chat, waiting for review of this file.

## Goal

The Data Marts band gets a second view. Grid is today's band. Canvas draws the report as a tree, laid out like the Relationships diagram on the OWOX data mart page. The main mart is on the left and the joined marts are on the right. On the canvas the member adds a mart by hovering the mart it should join and clicking a ghost card. They move a joined mart under another mart by dragging it.

## What the member asked for

1. A Grid / Canvas switch on the Data Marts band that looks like the Table / Charts switch on the Data band.
2. Canvas shows the marts in the current report. The main mart is on the left and the joined marts are on the right.
3. Hovering a mart shows the marts that can join it as dimmed cards on its right. The member moves the pointer to one and adds it as a click in Grid would.
4. Pressing and moving a joined mart starts a drag. Marts the dragged one has no relationship with are dimmed. Marts it can join keep their look. A dashed line runs from the dragged mart to the closest mart it can join. On release, the dragged mart joins that mart.

Answers from the chat:

1. When C moves under B and D hangs from C, D moves with C. If D cannot follow, B is not a valid target.
2. The canvas is custom SVG and absolutely positioned cards, built from the existing card, wire and drag code. There is no new dependency, no zoom and no pan.
3. A target that has no path to the dragged mart stays dimmed and gets no dashed line. No card changes its style during a drag. The dashed line is the only mark of the target.
4. The band reopens in the view the member picked last. The first visit is Grid.

## 1. The switch

`ViewSwitch` (`src/ui/bands/ViewSwitch.tsx`) takes its options and its `aria-label` as props. The Data band passes Table and Charts as now. The Data Marts band passes Grid (`LayoutGrid` icon) and Canvas (`Workflow` icon), in the same header slot the Data band uses.

The choice is saved in the `bands` document of the `preferences` collection (`src/api/preferences.ts`) as a new optional field, `martsView: 'grid' | 'canvas'`. A missing or unknown value reads as Grid. The switch is not a selection change, so it adds no Undo step. A failed write is logged and changes nothing on screen, like the fold choices.

Search, context badges, storage filters and Data Sources keep working in Grid only. With Canvas on, the band shows the report tree whatever the search says, and the search box stays as it is.

## 2. The report tree

A new pure module, `src/state/join-tree.ts`, builds the tree from the main grid's columns and the main mart's joined sources (`JoinedSource[]`).

1. The root is the main mart, alias path `''`.
2. A joined mart is a node at the alias path of the columns it uses. `inUsePaths` already reads these paths. A mart whose columns span two paths is placed at the shallowest. Today's UI does not produce that case.
3. A node's parent is the node at `parentPath(aliasPath)`. A path whose parent is not in use hangs from the deepest ancestor path that is. The main mart is the fallback.

The tree replaces the `sourceOfMart` guess wherever the canvas needs a mart's path.

## 3. Layout

A new pure module, `src/ui/bands/canvas-layout.ts`, maps the tree to positions.

1. The column is the node's depth in the tree: the main mart is in column 0 and its children in column 1.
2. The leaves stack top to bottom in tree order. A parent is centred on its children.
3. Cards are the grid card size. The column gap leaves room for wires and a ghost column.
4. The function returns `{ id, x, y }` per node and the canvas's total width and height.

The band body becomes a scroll box when the canvas is wider or taller than the band.

## 4. Drawing

1. Cards are the existing `MartCard`, absolutely positioned, with the same element ids (`martElementId`). Selected and joined states look as in Grid.
2. Wires reuse `wires.ts`. Each one runs from a parent card to a child card along the path in use. Model edges that the tree does not use are not drawn.
3. While the joined sources load, the canvas shows the main card and the band's loading bar.

## 5. Hover to add

1. Hovering a card shows ghost cards in the next column to its right. A ghost is a joined source whose `parentPath` is the hovered card's alias path and whose mart is not in the report.
2. Ghosts are dimmed and joined to the hovered card by a dashed wire.
3. The 400 ms grace from the Grid ghosts carries over. Leaving a card keeps its ghosts for 400 ms, and hovering a ghost keeps them.
4. A click on a ghost adds that mart through that exact alias path. The fields are those of a Grid click: the fields remembered for the mart, else `defaultJoinFields`.
5. `join-plan.ts` gets `planAddAt(grid, sources, aliasPath, remembered)`. It returns the new grid. `useCardClick` dispatches it as one `setMarts`, so Undo covers it.

## 6. Drag to move a mart

### Starting and ending

`useCardDrag` gets a mode for the canvas. A press on a joined card that moves past 5 px starts a drag. The main card does not drag on the canvas. The dragged card follows the pointer as the existing drag ghost. Escape, a cancelled pointer, or a release with no target ends the drag and changes nothing. The click after a drag is swallowed, as now.

### Valid targets

A card T is a valid target for dragged mart C when all of these hold:

1. T is in the report (the main mart or a joined mart).
2. T is not C and is not under C.
3. T is not C's current parent.
4. The joined sources have the path `T.path + '.' + c`, where `c` is the last segment of a source for C's mart. For the main mart, `T.path + '.'` is empty and the path is a depth-1 source for C.
5. For every node D under C, the path with C's old path prefix replaced by C's new path is a source for D's mart.

A pure function in `join-tree.ts`, `rejoinTargets(tree, sources, martId)`, returns the valid targets, each with the new alias path for C and for every node under C.

### What the member sees

1. Cards that are not valid targets, and are not C itself, drop to 15% opacity with grayscale.
2. Valid targets keep their look.
3. A dashed line runs from the dragged card to the valid target whose centre is closest to the pointer. With no valid targets, there is no line.
4. No card changes its border, colour or size during the drag.

### Release

The release moves C and its subtree under the target the dashed line points to. `join-plan.ts` gets `planRejoin(grid, sources, moves)`. `moves` maps each old alias path to its new one. For every column, filter, sort, aggregation and date bucket on a field of an old path, it swaps in the field of the new path with the same own name (`ownNameOf`). A field the new path does not offer is dropped. Column order is kept. One `setMarts` dispatch carries it, so Undo covers it.

## 7. Clicks on the canvas

1. A click on a joined card removes it and everything under it, as `withoutMart` does for each mart.
2. A click on the main card does what it does in Grid.
3. A click on a ghost adds it (section 5).

## 8. Testing

Vitest, with `--poolOptions.threads.maxThreads=4`.

1. `join-tree.test.ts` covers the tree from columns, a path whose parent is not in use, and `rejoinTargets`. The `rejoinTargets` cases are the diamond A→C, B→C, the subtree rule with C→D where `b.c.d` is missing, and no targets under C.
2. `canvas-layout.test.ts` covers columns by depth and parents centred on their children.
3. `join-plan.test.ts` covers `planAddAt` and `planRejoin` mapping columns, filters, sorts, aggregations and buckets, plus a dropped field.
4. An RTL test covers the switch (Grid by default, Canvas after a click, the saved preference is read back) and adding a mart through a ghost.

Playwright, on `/?mock`: switch to Canvas, hover the main card, add a ghost, drag C from A onto B, and check the grid's column headers and Undo.

The mock fixtures (`src/sdk/mock/fixtures.ts`) get a diamond: the main mart joins A and B, both join C, and C joins D through both.

## Out of scope

1. Zoom, pan and a minimap.
2. Changing the main mart on the canvas. That stays a drag onto the main card in Grid.
3. One mart joined twice through two paths.
