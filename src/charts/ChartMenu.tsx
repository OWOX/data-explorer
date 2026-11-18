import { EllipsisVertical } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HOVER_MS, HoverIntent, Panel, Row } from '../ui/explorer/MenuParts';

/** A tick row (stays open: several can be changed in a row) or a row opening a submenu of radio choices (closes on a choice). */
export type MenuItem =
  | { kind: 'check'; label: string; checked: boolean; onToggle: () => void }
  | { kind: 'radio'; label: string; value: string; options: { value: string; label: string }[]; onPick: (value: string) => void };

/** The ⋮ button of a chart and its menu, built from the same panel and rows as the column menu. */
export function ChartMenu({ name, items }: { name: string; items: MenuItem[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [sub, setSub] = useState<{ at: number; row: HTMLElement; seq: number } | null>(null);
  const [placed, setPlaced] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const holder = useRef<HTMLSpanElement>(null);
  const [intent] = useState(() => new HoverIntent());
  useEffect(() => () => intent.clear(), [intent]);
  const close = useCallback((refocus = true) => { intent.clear(); setAnchor(null); setSub(null); setPlaced(false); if (refocus) button.current?.focus(); }, [intent]);
  useEffect(() => {
    if (!anchor) return;
    // A press outside the menu closes it, as the column menu does.
    const down = (e: Event) => { const t = e.target as Element; if (!t.closest?.('[data-column-menu]') && !holder.current?.contains(t)) close(false); };
    // A scroll of anything that holds the button closes it too (a fixed menu would be left behind), as the column menu does.
    const away = (e: Event) => {
      const t = e.target;
      if (t instanceof Node && t !== document && (t as Element).closest?.('[data-column-menu]')) return;
      const h = holder.current;
      if (t === document || (t instanceof Node && h && t.contains(h))) close(false);
    };
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('scroll', away, true);
    return () => { document.removeEventListener('pointerdown', down, true); window.removeEventListener('scroll', away, true); };
  }, [anchor, close]);
  const open = (at: number, row: HTMLElement, focus: boolean) => { intent.clear(); setSub((cur) => ({ at, row, seq: focus ? (cur?.at === at ? cur.seq : 0) + 1 : cur?.at === at ? cur.seq : 0 })); };
  const closeSub = () => { const row = sub?.row; setSub(null); row?.focus(); };
  const later = (apply: () => void) => intent.after(HOVER_MS, apply);
  const picked = sub ? items[sub.at] : undefined;
  return (
    <span ref={holder} className="inline-flex">
      <button ref={button} type="button" aria-label={`${name} options`} aria-haspopup="menu" aria-expanded={!!anchor} onClick={(e) => (anchor ? close(false) : setAnchor(e.currentTarget))}
        className="inline-flex size-7 items-center justify-center rounded-md hover:bg-accent">
        <EllipsisVertical className="size-4" aria-hidden />
      </button>
      {anchor && (
        <Panel anchor={anchor} mode="below" role="menu" label={`${name} menu`} onEscape={() => (sub ? closeSub() : close())} onTab={() => close()} onPlaced={() => setPlaced(true)} focusSeq={1} className="dm-menu-root">
          {items.map((it, i) => it.kind === 'check' ? (
            <Row key={i} check checkbox checked={it.checked} label={it.label} onActivate={it.onToggle} onHover={() => { if (sub) later(() => setSub(null)); }} onLeaveRow={() => intent.clear()} />
          ) : (
            <Row key={i} sub expanded={sub?.at === i} label={it.label} onActivate={(r) => open(i, r, true)} onOpen={(r) => open(i, r, true)}
              onHover={(r) => { if (sub?.at === i) intent.clear(); else if (!sub) open(i, r, false); else later(() => open(i, r, false)); }} onLeaveRow={() => intent.clear()} />
          ))}
        </Panel>
      )}
      {anchor && placed && sub && picked?.kind === 'radio' && (
        <Panel anchor={sub.row} mode="beside" role="menu" label={picked.label} onEscape={closeSub} onLeave={closeSub} onTab={() => close()} focusSeq={sub.seq}>
          {picked.options.map((o) => <Row key={o.value} check checked={o.value === picked.value} label={o.label} onActivate={() => { picked.onPick(o.value); close(); }} />)}
        </Panel>
      )}
    </span>
  );
}
