import { Box, FileSpreadsheet, Loader2, Sparkles } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';
import type { Context, Model } from '../../model/types';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from './picked';
import type { Row } from './useSmartSearch';

export const optionId = (listId: string, i: number) => `${listId}-opt-${i}`;

function MartName({ martId, model }: { martId: string; model: Model }) {
  const mart = model.marts.get(martId);
  return <span className="dm-sr-chip"><PickedIcon icon={mart?.icon} fallback={Box} size={14} /><span className="dm-sr-name">{mart?.title ?? martId}</span></span>;
}

function RowBody({ row, model }: { row: Row; model: Model }): ReactNode {
  if (row.kind === 'report') {
    return (
      <>
        <FileSpreadsheet size={14} aria-hidden="true" />
        <span className="dm-sr-name dm-sr-title">{row.title}</span>
        <span className="dm-sr-muted">of</span>
        <MartName martId={row.martId} model={model} />
      </>
    );
  }
  if (row.kind === 'mart') return <MartName martId={row.martId} model={model} />;
  return (
    <>
      <Sparkles size={14} aria-hidden="true" />
      {row.reason ? (
        <span className="dm-sr-muted">{row.reason}</span>
      ) : (
        <>
          <span className="dm-sr-title-fixed">Ad-hoc report "{row.query}"</span>
          {row.pending && <Loader2 size={14} className="animate-spin" aria-label="Searching" />}
        </>
      )}
    </>
  );
}

type Smart = {
  rows: Row[]; highlighted: number | null; model: Model; setHighlighted: (i: number | null) => void; pick: (row?: Row) => void;
  contexts: Context[]; activeContextIds: string[]; toggleContext: (id: string) => void;
};

/**
 * The dropdown under the open search box: the contexts of the found marts as toggles on top, then the ad-hoc row, report rows and
 * data mart rows, as a listbox the input drives.
 */
export function SearchResults({ smart, id }: { smart: Smart; id: string }) {
  const { rows, highlighted, model, contexts, activeContextIds } = smart;
  // The arrows can land on a row below the fold; Enter picks it, so it has to be seen.
  useEffect(() => {
    if (highlighted !== null) document.getElementById(optionId(id, highlighted))?.scrollIntoView?.({ block: 'nearest' });
  }, [highlighted, id]);
  return (
    <div className="dm-search-results">
      {contexts.length > 0 && (
        <div className="dm-search-contexts" role="group" aria-label="Filter by context">
          {contexts.map((c) => (
            <button
              key={c.id}
              type="button"
              // Out of the Tab order: a click leaves the focus in the input, and Escape there closes the list without losing it.
              tabIndex={-1}
              aria-pressed={activeContextIds.includes(c.id)}
              className="dm-badge dm-badge-toggle"
              // The press must not take focus from the input, so the arrows and Enter keep working.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => smart.toggleContext(c.id)}
            >
              <PickedIcon icon={c.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />{c.name}
            </button>
          ))}
        </div>
      )}
      <ul className="dm-search-list" role="listbox" id={id} aria-label="Search results">
        {rows.map((row, i) => {
          const disabled = row.kind === 'adhoc' && row.disabled;
          return (
            <li
              key={row.kind === 'report' ? `r:${row.id}` : row.kind === 'mart' ? `m:${row.martId}` : 'adhoc'}
              id={optionId(id, i)}
              role="option"
              aria-selected={highlighted === i}
              aria-disabled={disabled || undefined}
              className={`dm-search-row${highlighted === i ? ' is-active' : ''}${disabled ? ' is-disabled' : ''}`}
              onMouseEnter={() => { if (!disabled) smart.setHighlighted(i); }}
              // The mouse down is the pick, and it must not take focus from the input.
              onMouseDown={(e) => { e.preventDefault(); if (!disabled) smart.pick(row); }}
            >
              <RowBody row={row} model={model} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
