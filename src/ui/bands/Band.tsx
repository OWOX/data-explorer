// A band: the titled strip a page section sits in, with its count, hint, controls and fold.
import { ChevronDown, Info } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { num } from '../format';
import { BandToolsSlot } from './BandTools';

export function Band({
  id,
  icon,
  title,
  total,
  hint,
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
          // A portal's events bubble here through React's tree; what is not in this header is not its fold.
          if (!e.currentTarget.contains(e.target as Node)) return;
          if ((e.target as HTMLElement).closest('button, a, input, label, summary, details, .dm-hint')) return;
          onFold();
        }}
      >
        <span className="dm-band-icon">{icon}</span>
        <h2 className="dm-band-title">{title}</h2>
        {total !== undefined && <span className="dm-badge dm-band-count">{typeof total === 'number' ? num(total) : total}</span>}
        <span className="dm-hint" tabIndex={0} role="note" aria-label={hint}>
          <Info size={14} />
          <span className="dm-hint-body">{hint}</span>
        </span>
        {/* Filtering what you cannot see answers nothing, so the controls fold with the content. */}
        {!folded && <div className="dm-band-tools">{toolbar}<span ref={setSlot} className="contents" /></div>}
        <button
          type="button"
          className={`dm-band-fold${folded ? ' dm-band-fold-alone' : ''}`}
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={folded ? `Show ${title}` : `Hide ${title}`}
          title={folded ? `Show ${title}` : `Hide ${title}`}
        >
          <ChevronDown size={16} className={folded ? undefined : 'dm-band-fold-open'} />
        </button>
      </header>
      {folded ? null : grid ? <div className="dm-band-grid">{children}</div> : <BandToolsSlot.Provider value={slot}><div className="dm-bigcard">{children}</div></BandToolsSlot.Provider>}
    </section>
  );
}
