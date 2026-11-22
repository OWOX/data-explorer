import { useEffect, useId, useRef, useState } from 'react';
import { LIST_OPS, addValue, narrow, tokensOf } from '../../filters/valueSuggest';
import { Panel } from './MenuParts';

/** Where a text input's suggestions come from. `key` names the read (column and rules), so a read is made once per key while the menu is open. */
export type ValueSource = { key: string; load: (signal: AbortSignal) => Promise<string[]>; cache: Map<string, string[]> };

/** Under these text operators a pick adds to the text; the second pick switches the operator to the list form. */
const SWITCH: Record<string, string> = { contains: 'eq', not_contains: 'neq' };

type Props = { op: string; value: string; onChange: (v: string, base?: string) => void; source?: ValueSource; className: string;
  /** The text the picks built (or a reopened single value): while the value still starts with it, "contains" reads as a list; a hand-typed comma is a literal one. */
  base?: string | null;
  /** Asks the form to change the operator (to the list form after the second pick). */
  onOp?: (op: string) => void };

/**
 * A text input with the column's known values under it. The values load on first focus; typing narrows them by the text after the last comma;
 * a pick adds the value to the comma-separated list (for the list operators) and the input keeps its focus. A failed read shows nothing.
 */
export function ValueInput({ op, value, onChange, source, className, base = null, onOp }: Props) {
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [hot, setHot] = useState(-1);
  // Per read key: loading, or failed (a failed read is not retried, and shows nothing).
  const [status, setStatus] = useState<Record<string, 'loading' | 'failed' | 'done'>>({});
  const flights = useRef(new Set<AbortController>());
  const id = useId();
  useEffect(() => { const f = flights.current; return () => f.forEach((c) => c.abort()); }, []);

  const key = source?.key;
  const loaded = source && key !== undefined ? source.cache.get(key) : undefined;
  const loading = !!key && status[key] === 'loading';
  const start = () => {
    if (!source || key === undefined || source.cache.has(key) || status[key]) return;
    const ac = new AbortController();
    flights.current.add(ac);
    setStatus((s) => ({ ...s, [key]: 'loading' }));
    source.load(ac.signal).then(
      (values) => { if (!ac.signal.aborted) { source.cache.set(key, values); setStatus((s) => ({ ...s, [key]: 'done' })); } },
      () => { if (!ac.signal.aborted) setStatus((s) => ({ ...s, [key]: 'failed' })); },
    );
  };

  // Pick mode lasts while the picked text is still there; typing after it narrows by the text after the last comma.
  const inPick = op in SWITCH && base !== null && (base.endsWith(', ') ? value.startsWith(base) : value === base);
  const list = LIST_OPS.has(op) || inPick;
  // A reopened single value counts as one token: the next pick follows it.
  const text = inPick && !base!.endsWith(', ') ? `${value}, ` : value;
  // A value with a comma would read as two in a list, so it is not offered there.
  const pool = loaded ?? [];
  const options = list
    ? narrow(pool.filter((o) => !o.includes(',')), text)
    : pool.filter((o) => o !== value && o.toLowerCase().includes(value.trim().toLowerCase()));
  const shown = open && !!source && (loading || options.length > 0);
  // The listbox is in the DOM once the values are in; while they load there is only a status note.
  const listed = shown && !(loading && !loaded);
  const at = Math.min(hot, options.length - 1);
  const pick = (v: string) => {
    if (op in SWITCH) {
      const next = addValue(inPick ? text : '', v);
      onChange(next, next);
      if (tokensOf(next).length >= 2) onOp?.(SWITCH[op]!);
    } else onChange(list ? addValue(text, v) : v);
    setHot(-1);
  };

  return (
    <>
      <input ref={setAnchor} aria-label="Value" className={className} type="text" value={value} autoComplete="off"
        {...(source ? { role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': shown, 'aria-controls': listed ? id : undefined, 'aria-activedescendant': listed && at >= 0 ? `${id}-${at}` : undefined } : {})}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHot(-1); start(); }}
        onFocus={() => { setOpen(true); start(); }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (!source) return;
          if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!options.length) return;
            e.preventDefault();
            setOpen(true);
            setHot(e.key === 'ArrowDown' ? (at + 1) % options.length : at <= 0 ? options.length - 1 : at - 1);
          } else if (e.key === 'Enter' && shown && at >= 0) { e.preventDefault(); pick(options[at]!); }
        }} />
      {shown && anchor && (
        <Panel anchor={anchor} mode="below" onEscape={() => setOpen(false)} focusSeq={0} className="dm-suggest">
          {loading && !loaded
            ? <div role="status" className="dm-suggest-note">Loading values…</div>
            : (
              // Pressing an option must not take focus from the input: several can be picked in a row.
              <div id={id} role="listbox" aria-label="Suggested values" onMouseDown={(e) => e.preventDefault()}>
                {options.map((o, i) => (
                  <div key={o} id={`${id}-${i}`} role="option" aria-selected={i === at} data-hot={i === at ? '' : undefined} className="dm-suggest-option" title={o}
                    onClick={() => pick(o)} onMouseEnter={() => setHot(i)}>{o}</div>
                ))}
              </div>
            )}
        </Panel>
      )}
    </>
  );
}
