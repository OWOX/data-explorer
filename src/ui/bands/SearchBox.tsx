import { ArrowRight, Loader2, Search, X } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import type { Model } from '../../model/types';
import { MAX_QUERY } from '../../search/endpoint';
import type { Progress } from '../../search/pipeline';
import { ActionForm } from '../ActionForm';
import { Tooltip } from '../Tooltip';
import { optionId, SearchResults } from './SearchResults';
import type { SmartSearch } from './useSmartSearch';
import { useOutsidePress } from '../outsidePress';

/**
 * The search in a band's toolbar: an icon button that opens an input with a go button at its end. Typing fills a dropdown of
 * reports, data marts and an ad-hoc row; the arrows move through it, Enter picks the highlighted row (or runs the ad-hoc row), and
 * Escape closes the dropdown first, then the box. A query that is applied stays on screen with an x that clears it.
 */
export function SearchBox({ smart, label }: { smart: SmartSearch; label: string }) {
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const { open, applied, busy, draft, listOpen, rows, highlighted } = smart;
  // A layout effect, so the input has focus in the same commit as the click that opened it.
  useLayoutEffect(() => { if (open) input.current?.focus(); }, [open]);
  const { closeList } = smart;
  useEffect(() => {
    if (!listOpen) return;
    // While the dropdown shows, Escape closes it wherever the focus is. The capture phase and stopPropagation keep the input's own
    // handler and the page's other Escape handlers (the full-screen exit) from also acting on the same press, so the next Escape is the box's.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault(); e.stopPropagation();
      closeList();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [listOpen, closeList]);
  // A press outside the search closes only the dropdown, so the typed query stays. A press inside it (a result row too) is left alone.
  useOutsidePress(listOpen, (t) => !!t.closest('.dm-search-open'), closeList);

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
    <ActionForm
      className="dm-search dm-search-open"
      role="search"
      aria-busy={busy}
      // A press on the box's own icon or padding would blur the input; it puts the focus back instead.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest('input, button, .dm-search-results')) return;
        e.preventDefault();
        input.current?.focus();
      }}
      onAction={() => { if (!smart.problem) smart.pick(highlighted === null ? undefined : rows[highlighted]); }}>
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

const STEP_LABELS: Record<Progress, string> = { main: 'Choosing data mart', path: 'Joining', fields: 'Picking fields', filters: 'Filters', charts: 'Charts' };
const STEPS: Progress[] = ['main', 'path', 'fields', 'filters', 'charts'];

/** The ad-hoc report's steps while they run; the current one spins. */
export function SearchProgress({ step }: { step: Progress }) {
  return (
    <p className="dm-search-hint" role="status" aria-label="Ad-hoc report progress">
      {STEPS.map((s, i) => (
        <span key={s} aria-current={s === step ? 'step' : undefined} className={STEPS.indexOf(step) > i ? 'dm-step-done' : s === step ? 'dm-step-now' : 'dm-step-next'}>
          {s === step && <Loader2 size={12} className="animate-spin" aria-hidden="true" />}{STEP_LABELS[s]}
        </span>
      ))}
    </p>
  );
}

/** Other marts the AI was nearly as sure of; a click rebuilds the report on that one. */
export function SearchAlternatives({ ids, model, onPick }: { ids: string[]; model: Model; onPick: (id: string) => void }) {
  return (
    <p className="dm-search-hint" aria-label="Also matches">
      <span>Also matches:</span>
      {ids.map((id) => <button key={id} type="button" className="dm-search-chip" onClick={() => onPick(id)}>{model.marts.get(id)?.title ?? id}</button>)}
    </p>
  );
}
