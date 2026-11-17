import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { MAX_QUERY } from '../../search/endpoint';
import { Tooltip } from '../Tooltip';
import type { SmartSearch } from './useSmartSearch';

/**
 * The search in a band's toolbar: an icon button that opens an input with a go button at its end. Enter or go runs the search,
 * Escape closes the box and leaves what is applied alone, and a query that is applied stays on screen with an x that clears it.
 */
export function SearchBox({ smart, label }: { smart: SmartSearch; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const { open, applied, busy, draft } = smart;
  useEffect(() => { if (open) input.current?.focus(); }, [open]);

  if (!open && !applied) {
    return (
      <Tooltip content={label}>
        <button type="button" className="dm-search-btn" aria-label={label} onClick={smart.openBox}><Search size={14} /></button>
      </Tooltip>
    );
  }
  if (!open) {
    return (
      <span className="dm-search dm-search-applied">
        <Search size={14} />
        <button type="button" className="dm-search-query" aria-label={`${label}: ${applied}`} onClick={smart.openBox}>{applied}</button>
        <button type="button" className="dm-search-x" aria-label="Clear search" onClick={smart.clear}><X size={14} /></button>
      </span>
    );
  }
  return (
    <form className="dm-search dm-search-open" role="search" aria-busy={busy} onSubmit={(e) => { e.preventDefault(); smart.submit(); }}>
      <Search size={14} />
      <input
        ref={input}
        type="text"
        value={draft}
        maxLength={MAX_QUERY}
        placeholder="Describe the data you need"
        aria-label={label}
        autoComplete="off"
        onChange={(e) => smart.setDraft(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); smart.closeBox(); } }}
      />
      {(draft || applied) && <button type="button" className="dm-search-x" aria-label="Clear search" onClick={() => { smart.clear(); input.current?.focus(); }}><X size={14} /></button>}
      <Tooltip content={smart.problem ?? 'Search'}>
        <span className="dm-search-go">
          <button type="submit" aria-label="Search" disabled={!!smart.problem}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}</button>
        </span>
      </Tooltip>
    </form>
  );
}

/** The quiet line under the search that suggests plugging AI in. Dismissing it is remembered. */
export function AiHint({ onDismiss }: { onDismiss: () => void }) {
  return (
    <p className="dm-search-hint" role="note" aria-label="AI search hint">
      <span>Connect AI in this plugin's settings to also find data marts by meaning and apply filters.</span>
      <button type="button" aria-label="Dismiss the AI hint" onClick={onDismiss}><X size={12} /></button>
    </p>
  );
}
