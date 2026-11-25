import { useState } from 'react';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import { UNIQUE_COUNT_LABEL } from '../../model/unique-count';
import { ownInSchemaOrder } from '../../state/column-order';
import { SheetsChecklist, type ChecklistItem } from '../SheetsChecklist';
import { FieldMenuButton } from './ColumnMenu';
import { FieldHint, FieldLabel } from './FieldLabel';

/** One data mart of the config menu, at one alias path ('' for the main mart). */
export type ConfigMart = {
  path: string; title: string; icon?: string | null; description?: string | null;
  main: boolean;
  /** Listed with the data marts of the report: it has a column, or it is kept in the report with none, or it is the main mart. The caller says; the menu does not guess. */
  shown: boolean;
  fields: Field[];
  /** Which rules some field of the mart carries (shown or not); the config menu marks the row with them. */
  rules?: { filter: boolean; slice: boolean; aggregate: boolean };
  locked: (name: string) => boolean;
  unique?: { on: boolean; onToggle: () => void };
  /** Takes the data mart out of the report. Absent when it is not in the report, or is the only one. `onRemove` must read the state as it is when called: a change may have gone out just before it. */
  remove?: { onRemove: () => void; disabled?: boolean };
};

/**
 * The fields of one data mart: a checklist of only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart).
 * The main mart's own fields that stay keep the order they have on the grid (the member may have dragged them); a newly
 * ticked one goes right after the nearest field before it in the schema that is shown, or first when none is, so a grid
 * that was never reordered stays in schema order. `mart.locked` names the ticked fields that cannot be unticked.
 * `mart.unique` is the mart's Unique Count metric, when the mart offers one (a hidden or composite key counts too): a first row toggles its column, which sits after the mart's own columns. It does not show or hide any field.
 * The rows list the shown fields first, in the grid's order, then the rest in schema order, as they were when this mounted: a tick never moves a row.
 */
export function MartFields({ mart, visible, onChange }: { mart: ConfigMart; visible: string[]; onChange: (cols: string[]) => void }) {
  const { fields, main, locked, unique, title } = mart;
  const set = new Set(visible);
  const mine = new Set(fields.map((f) => f.name));
  const [order] = useState(() => {
    const shown = visible.filter((c) => mine.has(c));
    return [...shown, ...fields.map((f) => f.name).filter((n) => !shown.includes(n))];
  });
  // The Unique Count row is decided when the panel opens, like the rest of its rows: it does not appear later, and stays (disabled) while the mart offers none.
  const [hadUnique] = useState(() => !!unique);
  const byName = new Map(fields.map((f) => [f.name, f]));
  const listed = [...order.map((n) => byName.get(n)).filter((f): f is Field => !!f), ...fields.filter((f) => !order.includes(f.name))];
  // A joined mart whose last field is unticked stays in the report with no column (the grid keeps it), so Clear is one change like any other.
  const apply = (picked: string[]) => {
    // A joined mart with no column has nothing to untick.
    if (!main && picked.length === 0 && !visible.some((c) => mine.has(c))) return;
    const keep = new Set(picked);
    const others = visible.filter((c) => !mine.has(c));
    let next = main
      ? [...ownInSchemaOrder(visible, fields.map((f) => f.name), keep), ...others]
      : [...visible.filter((c) => !mine.has(c) || keep.has(c)), ...picked.filter((n) => !set.has(n))];
    // Clear never leaves the grid without a column.
    if (next.length === 0) next = visible.slice(0, 1);
    onChange(next);
  };
  const shownNow = visible.filter((c) => mine.has(c));
  const items: ChecklistItem[] = listed.map((f) => ({
    value: f.name,
    text: fieldLabel(f),
    label: <FieldLabel field={f} hint={false} />,
    action: <FieldMenuButton field={f} onHide={() => apply(shownNow.filter((n) => n !== f.name))} />,
    extra: <FieldHint field={f} decorative />,
    description: f.description?.trim() || undefined,
    disabled: set.has(f.name) && (visible.length === 1 || locked(f.name)),
  }));
  return (
    <div className="flex flex-col gap-2">
      <SheetsChecklist label={`Fields of ${title}`} items={items} selected={shownNow} displaying={shownNow.length} onChange={apply}
        lead={hadUnique ? { item: { value: 'unique-count', text: UNIQUE_COUNT_LABEL, disabled: !unique }, on: unique?.on ?? false, onToggle: () => unique?.onToggle() } : undefined} />
    </div>
  );
}
