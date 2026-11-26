# Sankey column order: drag by ⋮ in the Columns menu

Agreed with the user on 2026-11-25 ("Menu rows only"): in a Sankey's chart menu, ⋮ > Columns, a vertical ⋮ (lucide `EllipsisVertical`) replaces the `Tag` icon before "Column 1" to "Column 5". Dragging a row by its ⋮ reorders the Sankey's columns. The column titles above the chart stay as they are.

## Behaviour

1. Every Column N row shows ⋮ where the Tag icon was. Rows for used columns (N <= number of columns) are draggable by the ⋮; an unused row's ⋮ is muted and not draggable.
2. Pressing the ⋮ and moving 4px or more starts a drag; a press without movement does nothing (the row's submenu still opens by clicking the row's label area, Right or Enter as today).
3. While dragging: the dragged row follows the pointer vertically, clamped to the span of the used rows; a 2px Sheets-green line marks where it will land; no submenu opens or switches (hover intent is ignored, an open Column submenu closes when the drag starts); the cursor is `grabbing`.
4. Drop: the column moves to the marked slot and the chart is saved through `onChange({ dimensions })`, so one drag is one Undo step. Dropping where it started changes nothing and saves nothing. Escape during a drag cancels it and keeps the menu open. The menu stays open after a drop, with the rows showing the new order.
5. Keyboard: on a used Column row, Alt+ArrowUp / Alt+ArrowDown move that column one place (same save, one Undo step each), and focus stays on the moved row. Plain arrows keep moving focus as today.
6. Ribbons take their colour from the first column, so moving another column to first place recolours the chart. That is expected; no change.

## Implementation notes

1. `MenuItem` (`src/charts/MenuItems.tsx`): the `group` kind gets an optional `onReorder?: (from: number, to: number) => void` and an optional `draggable?: number` (how many leading rows can be dragged). `GroupSubmenu` renders the drag handle and drag state when `onReorder` is set. Other menus are unchanged.
2. `Row` (`src/ui/explorer/MenuParts.tsx`) may take a `handle?: ReactNode` rendered first in the row, or the group submenu can pass the ⋮ as the row's glyph plus pointer handlers on a wrapping element; pick whichever keeps `Row` small. The handle carries `aria-hidden` (the keyboard path is Alt+Arrows, announced through the row's `aria-description`: "Alt+Up or Alt+Down to move").
3. `src/charts/kinds/sankey.tsx`: pure helper `moveColumn(names, from, to): string[]` (exported, unit tested), `icon: EllipsisVertical` on the Column rows, `onReorder` that calls `onChange({ dimensions: moveColumn(names, from, to) })` when the order changes.
4. Pointer drag with pointer capture on the handle (no HTML5 drag and drop), the same 4px start threshold idea as `src/ui/explorer/ColumnDrag.tsx`.
5. README: the Sankey section says how to reorder columns.

## Tests

1. Unit: `moveColumn` (forward, backward, same place, out of range).
2. Component (vitest, `src/charts/sankey-body.test.tsx` or a new `sankey-column-order.test.tsx`): the Column rows show the ⋮ and no Tag; a pointer drag from Column 1 to below Column 3 saves `[b, c, a]`; a drag back to its own place saves nothing; Escape cancels; Alt+ArrowDown on Column 1 saves `[b, a, c]`; Undo restores the order; hovering another row while dragging opens no submenu; an unused row cannot be dragged.
3. e2e (`e2e/sankey.spec.ts`): drag Column 1 below Column 2 in a real browser and check the column titles above the chart swap.
