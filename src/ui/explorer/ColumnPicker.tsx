import { Columns3 } from 'lucide-react';
import type { Field } from '../../model/types';
import { Popover } from '../Popover';
import { FieldLabel } from './FieldLabel';

/**
 * The columns of one data mart's tab: only that mart's fields (the main mart's own, or a joined mart's blended ones).
 * `onChange` gets the whole grid's column list. A joined mart's new field goes last (the grid groups it with its mart);
 * the main mart's own fields keep the schema's order. `locked` names the ticked fields that cannot be unticked.
 */
export function ColumnPicker({ title, fields, main, visible, locked, onChange }: {
  title: string;
  fields: Field[];
  main: boolean;
  visible: string[];
  locked: (name: string) => boolean;
  onChange: (cols: string[]) => void;
}) {
  const set = new Set(visible);
  const mine = new Set(fields.map((f) => f.name));
  const toggle = (name: string) => {
    const next = set.has(name) ? visible.filter((c) => c !== name) : [...visible, name];
    onChange(main ? [...fields.map((f) => f.name).filter((n) => next.includes(n)), ...next.filter((n) => !mine.has(n))] : next);
  };
  const ticked = fields.filter((f) => set.has(f.name)).length;
  return (
    <Popover align="start" tip="Fields" trigger={
      <button type="button" aria-label={`Fields of ${title}`} className="dm-ctl dm-ctl-lg dm-reveal"><Columns3 className="dm-icon" aria-hidden /></button>
    }>
      <div className="flex flex-col gap-1">
        <p className="dm-popover-title text-xs font-medium text-muted-foreground">Fields · {ticked}/{fields.length}</p>
        {fields.map((f) => (
          <label key={f.name} className="dm-reveal-host flex items-center gap-2 text-sm">
            <input type="checkbox" checked={set.has(f.name)} disabled={set.has(f.name) && (visible.length === 1 || locked(f.name))} onChange={() => toggle(f.name)} />
            <FieldLabel field={f} />
          </label>
        ))}
      </div>
    </Popover>
  );
}
