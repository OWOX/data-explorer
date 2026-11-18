# Main mart slot, joinable band, hover ghosts, join paths, Copy SQL

Date: 2026-11-17. Status: approved in chat, waiting for review of this file.

## Goal

The main data mart stays put while the member explores. A click on a card never replaces the main mart. The member changes the main mart on purpose: they drag a card onto it, or they deselect it. The band shows what can join the main mart, hover reveals what a card relates to, a mart joins by the path closest to the main one, and the Export menu copies the SQL the grid ran.

## What the member asked for

1. The main data mart is always the top-left card.
2. A click on a data mart that cannot join the current main one does not change the main one.
3. The main mart changes in two ways. The member drags a card onto the main card, and the grid is rebuilt with the new main's columns first. Or the member deselects the main mart, and the next joined mart becomes main.
4. Hovering a card in the Data Marts band shows the marts it has relationships with.
5. A mart that can join through several marts already in use joins through the one closest to the main mart.
6. "Copy SQL" is the last item of the Export menu.

Answers from the chat:

1. With a main mart set and no search, the band shows only marts joinable to it.
2. Search, context badges and Data Sources still list every mart. Cards that cannot join the main mart are dimmed. One of them becomes main only by a drag onto the main card.
3. Hover adds the hovered card's neighbours that are not in the band as ghost cards.
4. After a drag, the old main mart stays as a joined mart if the new main can join it.
5. Copy SQL copies the SQL of the grid's last query, read from its run, including the page `LIMIT`.

## 1. Main mart first

`computeVisible` (`src/graph/visible.ts`) puts the main mart first under every rule. Rule 0 (smart search) puts its hits first today, so it changes. Under rule 0 and rule 1 the joined marts follow the main mart, then the rest in the rule's own order.

The main mart still leaves the band when its storage is unticked. That rule is unchanged.

## 2. The band with a main mart set

### Rule 2 (main mart set, no search, no context badge)

Today rule 2 shows the main mart, the joined marts and the one-hop neighbours of each. The new rule 2 shows the main mart and every mart in `blendable.get(main)`, at any depth, in ticked storages. The always-shown marts (joined and filtered) stay. Order: main, joined in the order added, then breadth first over the edges, as `arrange` does now.

`computeVisible` gets a new input, `joinable: string[] | null`. It is the mart ids of the main mart's joined sources, or null while they load. While null, rule 2 falls back to today's one-hop set so the band is not empty during the read. `useJoinSources` already reads these sources in `App.tsx`.

### Rules 0, 1 and 3 (search, context badge, Data Sources)

They list the same marts as today. With a main mart set, each card that is not the main mart and not in `joinable` is drawn dimmed (`unjoinable` on `MartCard`). `computeVisible` returns the set as `unjoinable: Set<string>`, so the card does not decide it.

### Click

1. A click on the main card deselects it. The next joined mart becomes main. This is today's behaviour.
2. A click on a joinable card joins or unjoins it. This is today's behaviour.
3. A click on an unjoinable card changes nothing. It shows a tooltip on the card: "Can't join <Main>. Drag it onto <Main> to make it the main data mart." `planClick` no longer makes such a mart the main one when a main mart is set.
4. With no main mart set, a click makes the mart main, as today.

## 3. Drag onto the main card

1. The member drags any card other than the main one. The drag uses pointer events and no new library. It starts after the pointer moves 5 px, so a click stays a click.
2. During the drag, a copy of the card follows the pointer and the main card shows a drop outline. Dropping anywhere else cancels.
3. On drop the dragged mart becomes main, as one store step, so Undo takes it back in one step.
4. The new grid's columns are, in this order:
   1. the new main's own columns: its saved columns, or its defaults;
   2. the old main as a joined mart, if the new main can join it, with the old main's own columns that the joined source offers;
   3. every other joined mart the new main can reach, with the fields it showed;
   4. joined marts the new main cannot reach are dropped with their filters and sorts.
5. Filters and sorts on kept columns stay. Each dropped mart's fields are remembered with `saveLastShown`, as a removal does today.
6. Keyboard: the card's menu gets "Make main data mart", which does the same as a drop.

The plan is a new `planMakeMain` in `src/state/join-plan.ts`, next to `planClick`, and it returns the same shape (`selection`, `grids`, `saves`, `remember`). `useCardClick` gets a `makeMain(id)` that loads what the plan needs the way `run` does now.

## 4. Hover shows the marts a card relates to

1. Hovering a card lights its direct neighbours and the lines to them, as today.
2. Neighbours of the hovered card that are not in the band appear as ghost cards: a dashed border, 60% opacity, with the lines drawn. They are added after the last card, so no card moves.
3. Ghost cards go when the pointer leaves the hovered card and the ghosts. They stay while the pointer is on a ghost, so it can be clicked.
4. A click on a ghost acts as a click on a real card under the rules above.
5. Ghosts run no count query. They show the record line empty.
6. Focus by keyboard shows the same ghosts as hover.

`computeVisible` does not change for this. `CardBands` computes the ghosts from `neighbours(hovered, model.edges)` minus `visible.ids`, filtered to accessible marts in ticked storages.

## 5. Join path when several are possible

Today `sourceOfMart` (`src/state/join-plan.ts`) takes the first source for a mart, which is the shallowest alias path. The new rule takes the set of in-use marts: the main mart (depth 0) and the joined marts, each with the depth of the path it joined by.

1. Keep the paths whose next-to-last hop is an in-use mart. The parent of a path is its `aliasPath` without the last segment.
2. Among those, pick the one whose parent has the smallest depth. A direct join to the main mart has a parent at depth 0, so it always wins.
3. If no path goes through an in-use mart, take the shallowest path, as today.

Example: the main mart is Orders and Customers is joined. Stores is reachable as `Orders→Stores` and `Orders→Customers→Stores`. It joins by `Orders→Stores`. If only `Orders→Customers→Stores` and `Orders→Products→Stores` exist, it joins through Customers, because Customers is in use and Products is not.

`sourceOfMart(sources, martId, inUse)` takes the in-use paths as a third argument. Every caller in `join-plan.ts` passes them.

## 6. Copy SQL

1. The Export menu ends with a separator and "Copy SQL", below Claude and ChatGPT.
2. `Traversal` in `src/sdk/types.ts` gets `readonly runId?: string`. The OWOX client sets it from the `x-owox-run-id` header (`packages/api-client/src/traversal.ts`).
3. `useMartRows` keeps the run id of the grid's latest first-page query.
4. When the Export menu opens, the plugin reads `GET /api/data-marts/<main>/runs/<runId>` with `ctx.owox.getJson` and keeps `additionalParams.httpData.executionSqlQuery`. OWOX saves the run when the query ends, so a 404 is retried 3 times, 1 s apart. The result is cached per run id.
5. The item is enabled only once that SQL is in hand. A click copies it to the clipboard.
6. Until then, and whenever the SQL is unavailable, the item is shown disabled with the reason in its hint: the grid's query is still running, the grid has no query yet, the host gives no run id, the run could not be read, or the run has no SQL.
7. The SQL is the query the grid ran, with its page `LIMIT`. The enabled item's hint says so.
8. Copy SQL runs no query, bills nothing and writes nothing.

## Tests

1. `src/graph/visible.test.ts`: main mart first under rules 0 to 4; rule 2 shows every joinable mart; rule 2 falls back to one hop while `joinable` is null; `unjoinable` under rules 0, 1 and 3.
2. `src/state/join-plan.test.ts`: `planClick` ignores an unjoinable mart when a main mart is set; `planMakeMain` column order, kept and dropped marts, filters and sorts; `sourceOfMart` path choice, including the fallback.
3. Page tests: the unjoinable tooltip, ghost cards on hover and focus, a click on a ghost, Copy SQL states (disabled with each reason, enabled, copied).
4. One Playwright test: drag a card onto the main card and check the grid's first columns.
5. Vitest runs with at most 4 threads.

## Out of scope

1. An OWOX endpoint that returns SQL without running a query.
2. Copy SQL without the page `LIMIT`.
3. Dragging cards to reorder the band.
