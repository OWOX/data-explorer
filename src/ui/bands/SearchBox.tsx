import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';
import { MAX_QUERY } from '../../search/endpoint';
import { ActionForm } from '../ActionForm';
import { Tooltip } from '../Tooltip';
import { optionId, SearchResults } from './SearchResults';
import type { SmartSearch } from './useSmartSearch';

/**
 * The search in a band's toolbar: an icon button that opens an input with a go button at its end. Typing fills a dropdown of
 * reports, data marts and an ad-hoc row; the arrows move through it, Enter picks the highlighted row (or runs the ad-hoc row), and
 * Escape closes the dropdown first, then the box. A query that is applied stays on screen with an x that clears it.
 */
export function SearchBox({ smart, label }: { smart: SmartSearch; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { open, applied, busy, draft, listOpen, rows, highlighted } = smart;
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
    <ActionForm className="dm-search dm-search-open" role="search" aria-busy={busy} onAction={() => { if (!smart.problem) smart.pick(highlighted === null ? undefined : rows[highlighted]); }}>
      <Search size={14} />
      <input
        ref={input}
        type="text"
        value={draft}
        maxLength={MAX_QUERY}
        placeholder="Describe the data you need"
        aria-label={label}
        autoComplete="off"
        role="combobox"
        aria-expanded={listOpen}
        aria-controls={listOpen ? listId : undefined}
        aria-activedescendant={listOpen && highlighted !== null ? optionId(listId, highlighted) : undefined}
        aria-autocomplete="list"
        onChange={(e) => smart.setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); smart.move(e.key === 'ArrowDown' ? 1 : -1); }
          else if (e.key === 'Escape') {
            e.preventDefault(); e.stopPropagation();
            if (listOpen) smart.closeList(); else smart.closeBox();
          }
        }}
      />
      {(draft || applied) && <button type="button" className="dm-search-x" aria-label="Clear search" onClick={() => { smart.clear(); input.current?.focus(); }}><X size={14} /></button>}
      <Tooltip content={smart.problem ?? 'Search'}>
        <span className="dm-search-go">
          <button type="button" aria-label="Search" onClick={() => smart.submit()} disabled={!!smart.problem}>{busy ? <Loader2 size={14} className="animate-spin" /> : <ArrowRight size={14} />}</button>
        </span>
      </Tooltip>
      {listOpen && <SearchResults smart={smart} id={listId} />}
    </ActionForm>
  );
}

/** What a pick left to say: a report that was partly shown or would not open, a view the AI could not set up. */
export function SearchNotice({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <p className="dm-search-hint" role="status" aria-label="Search notice">
      <span>{text}</span>
      <button type="button" aria-label="Dismiss the notice" onClick={onDismiss}><X size={12} /></button>
    </p>
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
