import { RotateCw } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { LIST_OPS, addValue, mergeValues, narrow, tokensOf } from '../../filters/valueSuggest';
import { Panel } from './MenuParts';

/**
 * Where a text input's suggestions come from. `loaded` are the distinct values of the rows already on the grid: they show at once.
 * `key` names the read (column and rules): its values are read once and kept in `cache` until a reload. `load` gets `fresh` true on a reload, which must read. Without `load` only `loaded` is offered.
 */
export type ValueSource = { key: string; load?: (signal: AbortSignal, fresh: boolean) => Promise<string[]>; loaded?: string[]; cache: Map<string, string[]> };

/** Under these text operators a pick adds to the text; the second pick switches the operator to the list form. */
const SWITCH: Record<string, string> = { contains: 'eq', not_contains: 'neq' };

type Props = { op: string; value: string; onChange: (v: string, base?: string) => void; source?: ValueSource; className: string;
  /** The text is still what the picks built (or a reopened single value), so "contains" reads as a list; a hand-typed comma is a literal one. */
  inPick?: boolean;
  /** Asks the form to change the operator (to the list form after the second pick). */
  onOp?: (op: string) => void;
  /** Called once the column's values are in the cache. */
  onLoad?: () => void };

/**
 * A text input with the column's known values under it. The values load on first focus; typing narrows them by the text after the last comma;
 * a pick adds the value to the comma-separated list (for the list operators) and the input keeps its focus. A failed read shows nothing.
 */
export function ValueInput({ op, value, onChange, source, className, inPick = false, onOp, onLoad }: Props) {
  const [anchor, setAnchor] = useState<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  // Whether the input was ever focused: the in-flow no-match note then stays after a blur, so pressing Apply does not shift it away between mouse down and up.
  const [touched, setTouched] = useState(false);
  const [hot, setHot] = useState(-1);
  // Whether the hot row was reached with the arrow keys: a pointer resting on the reload row highlights it, but Enter still applies.
  const [keyed, setKeyed] = useState(false);
  // Per read key: loading, or failed (a failed read is not retried, and shows nothing).
  const [status, setStatus] = useState<Record<string, 'loading' | 'failed' | 'done'>>({});
  const flights = useRef(new Set<AbortController>());
  const id = useId();
  useEffect(() => { const f = flights.current; return () => f.forEach((c) => c.abort()); }, []);

  const key = source?.key;
  const loaded = source && key !== undefined ? source.cache.get(key) : undefined;
  const loading = !!key && status[key] === 'loading';
  const read = (fresh: boolean) => {
    if (!source?.load || key === undefined) return;
    const ac = new AbortController();
    flights.current.add(ac);
    setStatus((s) => ({ ...s, [key]: 'loading' }));
    source.load(ac.signal, fresh).then(
      (values) => { if (!ac.signal.aborted) { source.cache.set(key, values); setStatus((s) => ({ ...s, [key]: 'done' })); onLoad?.(); } },
      () => { if (!ac.signal.aborted) setStatus((s) => ({ ...s, [key]: 'failed' })); },
    );
  };
  const start = () => { if (key !== undefined && !source?.cache.has(key) && !status[key]) read(false); };
  // A reload forgets what was kept for this read and asks again.
  const reload = () => { if (key === undefined) return; source?.cache.delete(key); read(true); setHot(-1); setKeyed(false); };

  // Pick mode lasts while the picked text is still there; typing after it narrows by the text after the last comma.
  const list = LIST_OPS.has(op) || (op in SWITCH && inPick);
  // A reopened single value counts as one token: the next pick follows it.
  const text = inPick && !value.includes(',') ? `${value}, ` : value;
  // A value with a comma would read as two in a list, so it is not offered there.
  const pool = mergeValues(source?.loaded ?? [], loaded ?? []);
  const options = list
    ? narrow(pool.filter((o) => !o.includes(',')), text)
    : pool.filter((o) => o !== value && o.toLowerCase().includes(value.trim().toLowerCase()));
  // In a list, the one suggestion left is the word already typed (exactly: "Paid" against "paid" still offers the fix): nothing to add, so the panel does not hang over the editor's buttons.
  const exact = list && options.length === 1 && options[0] === text.slice(text.lastIndexOf(',') + 1).trim();
  // A value that is already the text (a pick) or, in a list, every value picked, leaves nothing to suggest: the panel closes instead of saying "No matching values" over the Apply button.
  const settled = !options.length && (list
    ? text.slice(text.lastIndexOf(',') + 1).trim() === '' && pool.some((o) => !o.includes(','))
    : pool.includes(value));
  // Once the values are in, the panel stays up with no match too, so the reload row can still be reached.
  const shown = open && !!source && (loading || (options.length > 0 && !exact) || (!!loaded && !settled));
  // The listbox is in the DOM once the values are in; while they load there is only a status note.
  const listed = shown && !(loading && !loaded && !options.length);
  // The reload row (only values from the server can be out of date) comes after the last option in the arrow-key order.
  const rows = options.length + (loaded ? 1 : 0);
  const at = Math.min(hot, rows - 1);
  const onReload = !!loaded && at === options.length;
  const pick = (v: string) => {
    // A value with a comma cannot join a list: it replaces the text.
    if (op in SWITCH && !v.includes(',')) {
      const next = addValue(inPick ? text : '', v);
      onChange(next, next);
      if (tokensOf(next).length >= 2) onOp?.(SWITCH[op]!);
    } else onChange(list && !(op in SWITCH) ? addValue(text, v) : v);
    setHot(-1);
    setKeyed(false);
  };

  // Only values that came from the server can be out of date; the rows on the grid are what the grid shows.
  const reloadRow = (where: 'inline' | 'panel') => loaded && (
    <button type="button" id={`${id}-reload`} data-hot={onReload ? '' : undefined} className={`dm-suggest-note dm-suggest-reload ${where === 'inline' ? 'dm-suggest-reload-inline' : ''}`} onMouseDown={(e) => e.preventDefault()} onClick={reload} onMouseEnter={() => { setHot(options.length); setKeyed(false); }}>
      <RotateCw size={14} aria-hidden="true" />Reload values
    </button>
  );

  return (
    <>
      <input ref={setAnchor} aria-label="Value" className={className} type="text" value={value} autoComplete="off"
        {...(source ? { role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': shown, 'aria-controls': listed && options.length ? id : undefined, 'aria-activedescendant': listed && at >= 0 ? (onReload ? `${id}-reload` : `${id}-${at}`) : undefined } : {})}
        onChange={(e) => { onChange(e.target.value); setOpen(true); setHot(-1); setKeyed(false); start(); }}
        onFocus={() => { setOpen(true); setTouched(true); start(); }}
        onBlur={() => { setOpen(false); setHot(-1); setKeyed(false); }}
        onKeyDown={(e) => {
          if (!source) return;
          if (e.key === 'Escape' && shown) { e.preventDefault(); e.stopPropagation(); setOpen(false); return; }
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!rows) return;
            e.preventDefault();
            setOpen(true);
            setKeyed(true);
            setHot(e.key === 'ArrowDown' ? (at + 1) % rows : at < 0 ? Math.max(options.length - 1, 0) : at === 0 ? rows - 1 : at - 1);
          } else if (e.key === 'Enter' && shown && at >= 0 && (!onReload || keyed)) { e.preventDefault(); if (onReload) reload(); else pick(options[at]!); }
        }} />
      {/* A slot of one fixed height under the input, whatever the state (idle, loading, no match) and whether the input has focus, so the editor's buttons never move.
          Anything but real options is said here, in the flow; options float. */}
      {source && (
        <div className="dm-suggest-slot">
          {loading && !loaded && !options.length
            ? <span role="status" className="dm-suggest-note">Loading values…</span>
            : touched && !!loaded && !loading && !options.length && !settled && (
              <>
                <span role="status" className="dm-suggest-note">No matching values</span>
                {reloadRow('inline')}
              </>
            )}
        </div>
      )}
      {shown && anchor && options.length > 0 && !exact && (
        <Panel anchor={anchor} mode="below" onEscape={() => setOpen(false)} focusSeq={0} matchWidth className="dm-suggest">
          {/* Pressing an option must not take focus from the input: several can be picked in a row. */}
          <div id={id} role="listbox" aria-label="Suggested values" onMouseDown={(e) => e.preventDefault()}>
            {options.map((o, i) => (
              <div key={o} id={`${id}-${i}`} role="option" aria-selected={i === at} data-hot={i === at ? '' : undefined} className="dm-suggest-option" title={o}
                onClick={() => pick(o)} onMouseEnter={() => { setHot(i); setKeyed(false); }}>{o}</div>
            ))}
          </div>
          {reloadRow('panel')}
        </Panel>
      )}
    </>
  );
}
