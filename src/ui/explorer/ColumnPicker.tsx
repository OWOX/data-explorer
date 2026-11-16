import { Columns3 } from 'lucide-react';
import type { Schema } from '../../model/types';
import { Popover } from '../Popover';
import { FieldLabel } from './FieldLabel';

export function ColumnPicker({ schema, visible, onChange }: { schema: Schema; visible: string[]; onChange: (cols: string[]) => void }) {
  const set = new Set(visible);
  const toggle = (name: string) => {
    const next = set.has(name) ? visible.filter((c) => c !== name) : [...visible, name];
    onChange(schema.map((f) => f.name).filter((n) => next.includes(n)));
  };
  return (
    <Popover align="end" trigger={
      <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><Columns3 className="size-4" />Columns ({visible.length}/{schema.length})</button>
    }>
      <div className="flex max-h-72 flex-col gap-1 overflow-auto">
        {schema.map((f) => (
          <label key={f.name} className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={set.has(f.name)} disabled={set.has(f.name) && visible.length === 1} onChange={() => toggle(f.name)} />
            <FieldLabel field={f} />
          </label>
        ))}
      </div>
    </Popover>
  );
}
