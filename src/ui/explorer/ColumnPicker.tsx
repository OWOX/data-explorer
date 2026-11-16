import { Box, ChevronRight, Columns3 } from 'lucide-react';
import { useState } from 'react';
import type { JoinedSource } from '../../api/blendable';
import type { Field, Model, Schema } from '../../model/types';
import { Popover } from '../Popover';
import { PickedIcon } from '../bands/picked';
import { FieldLabel } from './FieldLabel';

export type JoinedState = 'idle' | 'loading' | 'ready' | 'failed';

/**
 * The columns a grid can show: the mart's own fields, then one folded group per data mart joined to it (a field hidden for
 * reporting is offered nowhere). `onOpen` fires each time the picker opens, so the joined marts are read when first needed.
 */
export function ColumnPicker({ schema, sources, joinedState, visible, model, onChange, onOpen }: {
  schema: Schema;
  sources: JoinedSource[];
  joinedState: JoinedState;
  visible: string[];
  model: Model;
  onChange: (cols: string[]) => void;
  onOpen: () => void;
}) {
  const set = new Set(visible);
  const order = [...schema, ...sources.flatMap((s) => s.fields)].map((f) => f.name);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (name: string) => {
    const next = set.has(name) ? visible.filter((c) => c !== name) : [...visible, name];
    // The mart's own fields keep the schema's order; joined ones keep the order they were added in, a new one last.
    const own = new Set(schema.map((f) => f.name));
    onChange([...schema.map((f) => f.name).filter((n) => next.includes(n)), ...next.filter((n) => !own.has(n) && order.includes(n))]);
  };
  const row = (f: Field) => (
    <label key={f.name} className="dm-reveal-host flex items-center gap-2 text-sm">
      <input type="checkbox" checked={set.has(f.name)} disabled={set.has(f.name) && visible.length === 1} onChange={() => toggle(f.name)} />
      <FieldLabel field={f} />
    </label>
  );
  const nativeOn = schema.filter((f) => set.has(f.name)).length;
  const joinedOn = visible.length - nativeOn;
  return (
    <Popover align="end" onOpenChange={(o) => { if (o) onOpen(); }} trigger={
      <button type="button" className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent"><Columns3 className="size-4" />Columns ({nativeOn}/{schema.length}{joinedOn > 0 ? ` +${joinedOn}` : ''})</button>
    }>
      <div className="flex flex-col gap-1">
        {schema.map(row)}
        {joinedState === 'loading' && <p className="mt-1 text-xs text-muted-foreground">Reading the joined data marts…</p>}
        {joinedState === 'failed' && <p className="mt-1 text-xs text-muted-foreground">The joined data marts could not be read, so only this data mart&apos;s own fields are listed.</p>}
        {sources.map((s) => {
          const expanded = open.has(s.aliasPath);
          const ticked = s.fields.filter((f) => set.has(f.name)).length;
          const mart = model.marts.get(s.martId);
          return (
            <div key={s.aliasPath} className="flex flex-col gap-1">
              <button type="button" aria-expanded={expanded} onClick={() => setOpen((cur) => { const n = new Set(cur); if (n.has(s.aliasPath)) n.delete(s.aliasPath); else n.add(s.aliasPath); return n; })}
                className="mt-1 flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left text-sm font-medium hover:bg-accent">
                <ChevronRight className={`size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`} aria-hidden />
                <PickedIcon icon={mart?.icon} fallback={Box} size={14} />
                <span className="min-w-0 flex-1 truncate">{s.label}</span>
                <span className="dm-badge tabular-nums" aria-label={`${ticked} of ${s.fields.length} ticked`}>{ticked}/{s.fields.length}</span>
              </button>
              {expanded && <div role="group" aria-label={s.label} className="flex flex-col gap-1 pl-5">{s.fields.map(row)}</div>}
            </div>
          );
        })}
      </div>
    </Popover>
  );
}
