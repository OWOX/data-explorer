// A band: the titled strip a page section sits in, with its count, hint, controls and fold.
import { ChevronDown } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { num } from '../format';
import { Hint } from '../Tooltip';
import { BandToolsSlot } from './BandTools';

export function Band({
  id,
  icon,
  title,
  total,
  hint,
  afterHint,
  toolbar,
  folded,
  onFold,
  grid = true,
  children,
}: {
  id: string;
  /** The glyph drawn at 18px: a lucide element, or a PickedIcon. */
  icon: ReactNode;
  title: string;
  total?: number | string;
  hint: string;
  /** Sits in the title row right after the hint, and wraps with it. */
  afterHint?: ReactNode;
  toolbar?: ReactNode;
  /** Folded by the reader: header only, and its controls go with the content. */
  folded: boolean;
  onFold: () => void;
  /** Cards sit in the responsive grid; the Data and Row bands lay out their own content. */
  grid?: boolean;
  children: ReactNode;
}) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <section id={id} data-band="" className={`dm-band${folded ? ' folded' : ''}`}>
      <header
        className="dm-band-head"
        onClick={(e) => {
          // Everything in here that does its own thing keeps doing it; the space between is the
          // fold. The chevron is a button, so it is skipped here and fires its own handler once.
          if ((e.target as HTMLElement).closest('button, a, input, label, summary, details, .dm-hint')) return;
          onFold();
        }}
      >
        <span className="dm-band-icon">{icon}</span>
        <h2 className="dm-band-title">{title}</h2>
        {total !== undefined && <span className="dm-badge dm-band-count">{typeof total === 'number' ? num(total) : total}</span>}
        <Hint text={hint} label={hint} />
        {afterHint}
        {/* Filtering what you cannot see answers nothing, so the controls fold with the content. */}
        {!folded && <div className="dm-band-tools">{toolbar}{!grid && <span ref={setSlot} className="contents" />}</div>}
        <button
          type="button"
          className={`dm-band-fold${folded ? ' dm-band-fold-alone' : ''}`}
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={folded ? `Show ${title}` : `Hide ${title}`}
        >
          <ChevronDown size={16} className={folded ? undefined : 'dm-band-fold-open'} />
        </button>
      </header>
      {/* Folded content stays mounted, only hidden: unfolding must not remount the grid and ask for its rows again. */}
      {grid ? <div className="dm-band-grid" hidden={folded}>{children}</div> : <BandToolsSlot.Provider value={slot}><div className="dm-bigcard" hidden={folded}>{children}</div></BandToolsSlot.Provider>}
    </section>
  );
}
