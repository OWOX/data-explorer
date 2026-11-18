// A band: the titled strip a page section sits in, with its count, hint, controls and fold.
import { ChevronDown, Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { num } from '../format';
import { Hint } from '../Tooltip';
import { BandToolsSlot } from './BandTools';
import { LoadBar } from './LoadBar';

/** The body's collapse animation, as CollapsibleCard's duration-200. */
const REVEAL_MS = 200;

export function Band({
  id,
  icon,
  title,
  total,
  countLast,
  hint,
  afterHint,
  toolbar,
  folded,
  onFold,
  grid = true,
  loading = null,
  fullScreen,
  children,
}: {
  id: string;
  /** The glyph drawn at 18px: a lucide element, or a PickedIcon. */
  icon: ReactNode;
  title: string;
  total?: number | string;
  /** Put the count after afterHint (the Data band) instead of right after the title. */
  countLast?: boolean;
  hint: string;
  /** Sits in the title row right after the hint, and wraps with it. */
  afterHint?: ReactNode;
  toolbar?: ReactNode;
  /** Folded by the reader: header only, and its controls go with the content. */
  folded: boolean;
  onFold: () => void;
  /** Cards sit in the responsive grid; the Data and Row bands lay out their own content. */
  grid?: boolean;
  /** While the page is still reading: 0 to 1 draws a load bar in place of the body (the header is already there); null shows the body. */
  loading?: number | null;
  /** An icon in the title row that fills the plugin area with this band. While it is on, the band cannot be folded: the fold control and the header click go. */
  fullScreen?: { on: boolean; onToggle: () => void };
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  // Folding animates the body's height (grid rows 1fr -> 0fr, as OWOX's CollapsibleCard does); the
  // body is only taken out of the page (`hidden`) once that has played, and put back at once on open.
  const [gone, setGone] = useState(folded);
  const [settled, setSettled] = useState(!folded);
  const [seen, setSeen] = useState(folded);
  if (seen !== folded) { setSeen(folded); setGone(false); setSettled(false); }
  useEffect(() => {
    const t = window.setTimeout(() => { setGone(folded); setSettled(!folded); }, REVEAL_MS);
    return () => window.clearTimeout(t);
  }, [folded]);
  const count = total !== undefined && <span className="dm-badge dm-band-count">{typeof total === 'number' ? num(total) : total}</span>;
  const hidden = folded && gone;
  // Taking the body out of the page moves no box the line layer watches, so tell it to look again.
  const section = useRef<HTMLElement>(null);
  useEffect(() => { section.current?.dispatchEvent(new Event('animationend', { bubbles: true })); }, [hidden]);
  return (
    <section ref={section} id={id} data-band="" className={`dm-band${folded ? ' folded' : ''}`}>
      {/* The header is the same box folded and open: only the body below it collapses. */}
      <header
        className="dm-band-head group"
        onClick={(e) => {
          // Everything in here that does its own thing keeps doing it; the space between is the
          // fold. The chevron is a button, so it is skipped here and fires its own handler once.
          if ((e.target as HTMLElement).closest('button, a, input, label, summary, details, .dm-hint')) return;
          if (fullScreen?.on) return;
          onFold();
        }}
      >
        <div className="dm-band-titlegroup">
          <span className="dm-band-icon">{icon}</span>
          <h2 className="dm-band-title" title={title}>{title}</h2>
          {!countLast && count}
          <Hint text={hint} label={`About ${title}`} />
          {afterHint}
          {countLast && count}
        </div>
        <div className="dm-band-actions">
          {/* Filtering what you cannot see answers nothing, so the controls fold with the content. */}
          {!folded && <div className="dm-band-tools">{toolbar}{!grid && <span ref={setSlot} className="contents" />}</div>}
          {fullScreen && !folded && (
            <button
              type="button"
              className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-card hover:bg-accent"
              onClick={fullScreen.onToggle}
              aria-pressed={fullScreen.on}
              aria-label={fullScreen.on ? 'Exit full screen' : 'Full screen'}
              title={fullScreen.on ? 'Exit full screen (Esc)' : 'Full screen'}
            >
              {fullScreen.on ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          )}
          {!fullScreen?.on && (
            <button
              type="button"
              className="dm-band-fold"
              onClick={onFold}
              aria-expanded={!folded}
              aria-label={folded ? `Show ${title}` : `Hide ${title}`}
            >
              <ChevronDown size={16} className={folded ? undefined : 'dm-band-fold-open'} />
            </button>
          )}
        </div>
      </header>
      <div className={`dm-band-reveal${folded ? '' : ' open'}${settled ? ' settled' : ''}`}>
        <div className="dm-band-reveal-in">
          {loading !== null && !folded ? <LoadBar fraction={loading} /> : null}
          {/* Folded content stays mounted, only hidden: unfolding must not remount the grid and ask for its rows again. */}
          {loading !== null ? null : grid ? <div className="dm-band-grid dm-band-body" hidden={hidden}>{children}</div> : <BandToolsSlot.Provider value={slot}><div className="dm-bigcard dm-band-body" hidden={hidden}>{children}</div></BandToolsSlot.Provider>}
        </div>
      </div>
    </section>
  );
}
