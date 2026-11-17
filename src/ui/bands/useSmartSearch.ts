import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Model } from '../../model/types';
import { pickModel } from '../../search/ai';
import { queryProblem } from '../../search/endpoint';
import { smartSearch } from '../../search/run';
import { sourceOfModel, useServices, useStore } from '../../state/store';

/**
 * The Data Marts band's search: the box's open and typed state, and what a run does with the answer. A run asks OWOX's search
 * (and the AI model when the project has one), shows what was found, and makes the best mart the main one in one Undo step.
 * Nothing found falls back to the title match; a failing model never shows an error.
 */
export function useSmartSearch(model: Model) {
  const [state, dispatch] = useStore();
  const { ctx, schemas, preferences } = useServices();
  const applied = state.search.trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  // Hidden until the stored choice has been read, so a member who dismissed it never sees it flash.
  const [hintDismissed, setHintDismissed] = useState(true);
  const aiConfigured = useMemo(() => pickModel(ctx) !== null, [ctx]);
  const latest = useRef({ selection: state.selection, model });
  useEffect(() => { latest.current = { selection: state.selection, model }; });
  const running = useRef<AbortController | null>(null);

  useEffect(() => {
    let live = true;
    preferences.loadAiHintDismissed().then((d) => { if (live) setHintDismissed(d); });
    return () => { live = false; };
  }, [preferences]);
  useEffect(() => () => running.current?.abort(), []);

  const cancel = useCallback(() => { running.current?.abort(); running.current = null; setBusy(false); }, []);

  const run = useCallback(async (raw: string) => {
    const query = raw.trim();
    if (queryProblem(query)) return;
    running.current?.abort();
    const ctl = new AbortController();
    running.current = ctl;
    ctx.signal.addEventListener('abort', () => ctl.abort(), { once: true });
    setBusy(true);
    try {
      const out = await smartSearch({ ctx, model: latest.current.model, schemas, signal: ctl.signal }, query);
      if (ctl.signal.aborted) return;
      const best = out.ids[0];
      if (!best) {
        // Nothing matched: the plain title match is all that is left.
        dispatch({ type: 'search', q: query });
        return;
      }
      dispatch({ type: 'smartFound', query, ids: out.ids });
      const { selection, model: current } = latest.current;
      const sourceKey = selection.sourceKey && current.marts.get(best)?.sourceKey === selection.sourceKey ? selection.sourceKey : null;
      // The main mart and the grid it opens with change in one store step, so one Undo takes both back.
      if (out.grid) dispatch({ type: 'setMarts', selection: { sourceKey, martId: best, record: null }, grids: { [best]: out.grid } });
      else dispatch({ type: 'selectMart', id: best, sourceOf: sourceOfModel(current) });
    } finally {
      if (running.current === ctl) { running.current = null; setBusy(false); }
    }
  }, [ctx, schemas, dispatch]);

  return {
    /** The query on screen as a result: set while a search is applied, whichever way it was answered. */
    applied,
    open,
    busy,
    draft,
    setDraft,
    problem: queryProblem(draft),
    openBox: () => { setDraft(applied); setOpen(true); },
    closeBox: () => { setDraft(applied); setOpen(false); },
    submit: () => { if (!busy && !queryProblem(draft)) void run(draft); },
    clear: () => { cancel(); setDraft(''); if (state.search || state.found.length) dispatch({ type: 'search', q: '' }); },
    /** The one-line hint that suggests plugging AI in: only while the search is in use, only without a model, until dismissed. */
    hintVisible: (open || applied !== '') && !aiConfigured && !hintDismissed,
    dismissHint: () => { setHintDismissed(true); preferences.dismissAiHint(); },
  };
}
export type SmartSearch = ReturnType<typeof useSmartSearch>;
