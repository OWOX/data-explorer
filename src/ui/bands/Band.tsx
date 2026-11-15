// A band: the titled strip a page section sits in, with its count, hint, controls and fold.
import { ChevronDown, Info, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { num } from '../format';

export function Band({
  id,
  icon: Icon,
  title,
  total,
  hint,
  toolbar,
  loading,
  folded,
  onFold,
  grid = true,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: string;
  total?: number;
  hint: string;
  toolbar?: ReactNode;
  /** 0-1 while the band is still being read: it shows a bar instead of its content. */
  loading?: number | null;
  /** Folded by the reader: header only, and its controls go with the content. */
  folded: boolean;
  onFold: () => void;
  /** Cards sit in the responsive grid; the Data and Row bands lay out their own content. */
  grid?: boolean;
  children: ReactNode;
}) {
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
        <span className="dm-band-icon"><Icon size={18} /></span>
        <h2 className="dm-band-title">{title}</h2>
        {total !== undefined && <span className="dm-badge dm-band-count">{num(total)}</span>}
        <span className="dm-hint" tabIndex={0} role="note" aria-label={hint}>
          <Info size={14} />
          <span className="dm-hint-body">{hint}</span>
        </span>
        {/* Filtering what you cannot see answers nothing, so the controls fold with the content. */}
        {toolbar && !folded && <div className="dm-band-tools">{toolbar}</div>}
        <button
          type="button"
          className={`dm-band-fold${toolbar && !folded ? '' : ' dm-band-fold-alone'}`}
          onClick={onFold}
          aria-expanded={!folded}
          aria-label={folded ? `Show ${title}` : `Hide ${title}`}
          title={folded ? `Show ${title}` : `Hide ${title}`}
        >
          <ChevronDown size={16} className={folded ? undefined : 'dm-band-fold-open'} />
        </button>
      </header>
      {folded ? null : loading === null || loading === undefined ? (
        grid ? <div className="dm-band-grid">{children}</div> : children
      ) : (
        <div
          className={`dm-loadbar${loading >= 1 ? ' dm-loadbar-done' : ''}`}
          role="progressbar"
          aria-label="Reading the project"
          aria-valuenow={Math.round(loading * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <span style={{ width: `${Math.round(loading * 100)}%` }} />
        </div>
      )}
    </section>
  );
}
