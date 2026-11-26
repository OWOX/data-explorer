import { Tag } from 'lucide-react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { Context } from '../../model/types';
import { useMenuDismiss } from '../explorer/ColumnMenu';
import { Panel } from '../explorer/MenuParts';
import { fitBadges } from './fitBadges';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from './picked';

const GAP = 4;
/** The badges wrap onto this many lines before the rest goes behind the chip. */
const LINES = 2;

/**
 * A badge per context, on at most two lines: the ones that fit stay, the rest go behind a "+N (tag) more" chip that
 * opens a list of them. A hidden badge still toggles its context, and a selected one lights the chip.
 */
export function ContextBadges({ contexts, selectedIds, onToggle }: { contexts: Context[]; selectedIds: string[]; onToggle: (id: string) => void }) {
  const sorted = [...contexts].sort((a, b) => a.name.localeCompare(b.name));
  const box = useRef<HTMLDivElement>(null);
  const probe = useRef<HTMLDivElement>(null);
  const [kept, setKept] = useState(sorted.length);
  const key = sorted.map((c) => `${c.id}\u0000${c.name}\u0000${c.icon ?? ''}`).join('\u0001');

  useLayoutEffect(() => {
    const measure = () => {
      if (!box.current || !probe.current) return;
      const parts = [...probe.current.children] as HTMLElement[];
      const chip = parts.pop();
      if (!chip) return;
      setKept(fitBadges(parts.map((p) => p.getBoundingClientRect().width), chip.getBoundingClientRect().width, box.current.clientWidth, GAP, LINES));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (box.current) ro.observe(box.current);
    // The probe's widths change when a web font swaps in, which the box does not notice.
    if (probe.current) ro.observe(probe.current);
    let live = true;
    void document.fonts?.ready.then(() => { if (live) measure(); });
    return () => { live = false; ro.disconnect(); };
    // `key` stands for the contexts: a rename or a new one changes the widths.
  }, [key]);

  const shown = sorted.slice(0, kept);
  const hidden = sorted.slice(kept);
  // The list of hidden badges opens from the chip. With nothing hidden there is no chip, and so nothing to hold the list open.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const chip = useRef<HTMLButtonElement>(null);
  if (anchor && hidden.length === 0) setAnchor(null);
  const close = (refocus = true) => { setAnchor(null); if (refocus) chip.current?.focus(); };
  // A press outside only closes the list, and so does a scroll of anything that holds the chip.
  useMenuDismiss(!!anchor, chip, () => close(false));
  const hiddenOn = hidden.filter((c) => selectedIds.includes(c.id)).length;
  const badge = (c: Context) => (
    <button key={c.id} type="button" aria-pressed={selectedIds.includes(c.id)} className="dm-badge dm-badge-toggle" onClick={() => onToggle(c.id)}>
      <PickedIcon icon={c.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />{c.name}
    </button>
  );
  const chipBody = (n: number) => <>+{n}<Tag size={12} aria-hidden />more</>;
  return (
    <div ref={box} className="dm-context-filter" role="group" aria-label="Contexts">
      {shown.map(badge)}
      {hidden.length > 0 && (
        <>
          <button ref={chip} type="button" data-context-more data-on={hidden.some((c) => selectedIds.includes(c.id)) ? '' : undefined} className="dm-badge dm-badge-toggle" aria-haspopup="dialog" aria-expanded={!!anchor}
            aria-label={`${hidden.length} more contexts${hiddenOn > 0 ? `, ${hiddenOn} selected` : ''}`}
            onClick={(e) => (anchor ? close(false) : setAnchor(e.currentTarget))}>
            {chipBody(hidden.length)}
          </button>
          {anchor && (
            <Panel anchor={anchor} mode="below" role="dialog" label="More contexts" onEscape={() => close()} focusSeq={1} className="dm-context-more">
              <div className="flex flex-col items-start gap-1" role="group" aria-label="Hidden contexts">{hidden.map(badge)}</div>
            </Panel>
          )}
        </>
      )}
      {/* Off screen: the same badges at their natural width, and the widest the chip gets. */}
      <div ref={probe} aria-hidden className="dm-context-probe">
        {sorted.map((c) => (
          <span key={c.id} className="dm-badge dm-badge-toggle"><PickedIcon icon={c.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />{c.name}</span>
        ))}
        <span className="dm-badge dm-badge-toggle">{chipBody(sorted.length)}</span>
      </div>
    </div>
  );
}
