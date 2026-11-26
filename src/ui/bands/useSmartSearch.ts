import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { withJoined } from '../../api/blendable';
import { PAGE_SIZE } from '../../config';
import type { Context, Mart, Model } from '../../model/types';
import { pickModels, pipelineReady } from '../../search/ai';
import { createDecide } from '../../search/decide';
import type { Intent } from '../../search/intent';
import { runPipeline, type Progress } from '../../search/pipeline';
import { MIN_QUERY, queryProblem, searchEndpoint, type SearchHits } from '../../search/endpoint';
import { reportSkippedMessage, reportToGrid } from '../../search/report-load';
import type { ReportDto } from '../../sdk/types';
import { deepEqual, reducer, sourceOfModel, useServices, useStore, type Action, type GridState, type State } from '../../state/store';
import { defaultColumns } from '../../model/columns';
import { useLatest } from '../useLatest';

/** How long typing must pause before the search runs. */
const SEARCH_DEBOUNCE_MS = 300;
const SHORT_REASON = 'Type at least 2 characters';
const NO_MART_REASON = 'No data mart found';

export type Row =
  | { kind: 'report'; id: string; title: string; martId: string }
  | { kind: 'mart'; martId: string }
  | { kind: 'adhoc'; query: string; pending: boolean; disabled: boolean; reason?: string };

/** The contexts the found marts belong to, in the model's order: the choices of the dropdown's context filter. */
function contextsOfFound(martIds: string[], model: Model): Context[] {
  const ids = new Set(martIds.flatMap((id) => model.marts.get(id)?.contextIds ?? []));
  return model.contexts.filter((c) => ids.has(c.id));
}

const inContexts = (mart: Mart | undefined, ids: string[]) => !!mart && mart.contextIds.some((id) => ids.includes(id));

type Found = { query: string; hits: SearchHits };
type Entry = { query: string; ctl: AbortController; done: Promise<SearchHits | null> };
const NO_HITS: SearchHits = { reports: [], marts: [] };

/**
 * The Data Marts band's search: the box's open and typed state, the dropdown that fills while the member types, and what a pick
 * does. Once typing pauses, OWOX's search runs (no AI while typing). The list shows the ad-hoc row, then reports, then data marts, and a context filter over the found ones. Nothing is applied before a pick; the AI pipeline of an
 * ad-hoc report runs only after the member picks that row.
 */
export function useSmartSearch(model: Model) {
  const [state, dispatch] = useStore();
  const { ctx, schemas, blendable, preferences, chartSettings } = useServices();
  const applied = state.search.trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [listShown, setListShown] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const [building, setBuilding] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [contextIds, setContextIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Hidden until the stored choice has been read, so a member who dismissed it never sees it flash.
  const [hintDismissed, setHintDismissed] = useState(true);
  const models = useMemo(() => pickModels(ctx), [ctx]);
  const aiReady = pipelineReady(models);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [alternatives, setAlternatives] = useState<string[]>([]);
  const lastRun = useRef<{ query: string; hits: SearchHits; intent: Intent } | null>(null);
  const latest = useLatest({ selection: state.selection, model });
  // The store as the pipeline last saw it. A dispatch lands in `state` a render later, so the pipeline's own dispatches are run through the reducer here as well; each render then takes the real state over.
  const mirror = useRef<State>(state);
  useLayoutEffect(() => { mirror.current = state; });
  const send = (action: Action) => { mirror.current = reducer(mirror.current, action); dispatch(action); };
  const entry = useRef<Entry | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const picking = useRef<{ ctl: AbortController; query: string; kind: 'adhoc' | 'other' } | null>(null);
  const draftRef = useRef('');

  useEffect(() => {
    let live = true;
    preferences.loadAiHintDismissed().then((d) => { if (live) setHintDismissed(d); });
    return () => { live = false; };
  }, [preferences]);

  const stopTimer = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  const stopSearch = useCallback(() => { entry.current?.ctl.abort(); entry.current = null; setSearching(false); }, []);
  const stopPick = useCallback(() => { picking.current?.ctl.abort(); picking.current = null; setBuilding(false); setProgress(null); setAlternatives([]); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); entry.current?.ctl.abort(); picking.current?.ctl.abort(); }, []);

  /** Starts the search for a query, or joins the one already running for it. The answer is null when a newer query took over. */
  const fetchFor = useCallback((query: string): Entry => {
    if (entry.current && entry.current.query === query && !entry.current.ctl.signal.aborted) return entry.current;
    entry.current?.ctl.abort();
    const ctl = new AbortController();
    const onHostAbort = () => ctl.abort();
    ctx.signal.addEventListener('abort', onHostAbort, { once: true });
    setSearching(true);
    const done = (async () => {
      try {
        const hits = await searchEndpoint(ctx, query, latest.current.model, ctl.signal);
        if (ctl.signal.aborted) return null;
        setHighlighted(null);
        setFound({ query, hits });
        return hits;
      } finally {
        ctx.signal.removeEventListener('abort', onHostAbort);
        if (entry.current?.ctl === ctl) setSearching(false);
      }
    })();
    const next: Entry = { query, ctl, done };
    entry.current = next;
    return next;
  }, [ctx, latest]);

  const trimmed = draft.trim();
  const allRows = useMemo<Row[]>(() => {
    if (!trimmed) return [];
    if (trimmed.length < MIN_QUERY) return [{ kind: 'adhoc', query: trimmed, pending: false, disabled: true, reason: SHORT_REASON }];
    const stale = !found || found.query !== trimmed;
    const fallback = found && !stale ? found.hits.marts[0] ?? found.hits.reports[0]?.martId ?? null : null;
    // Without a pipeline-ready AI the row waits for the search and opens the first mart it found.
    const adhoc: Row = aiReady
      ? { kind: 'adhoc', query: trimmed, pending: false, disabled: false }
      : stale ? { kind: 'adhoc', query: trimmed, pending: true, disabled: true }
        : fallback ? { kind: 'adhoc', query: trimmed, pending: false, disabled: false }
          : { kind: 'adhoc', query: trimmed, pending: false, disabled: true, reason: NO_MART_REASON };
    if (!found) return [adhoc];
    return [
      adhoc,
      ...found.hits.reports.map((r): Row => ({ kind: 'report', id: r.id, title: r.title, martId: r.martId })),
      ...found.hits.marts.map((martId): Row => ({ kind: 'mart', martId })),
    ];
  }, [trimmed, found, aiReady]);
  /** The filter's choices: the contexts of the marts the rows name. */
  const contexts = useMemo(
    () => contextsOfFound(allRows.flatMap((r) => (r.kind === 'adhoc' ? [] : [r.martId])), model),
    [allRows, model],
  );
  // A picked context that the current rows no longer offer stops filtering, and comes back if a later query offers it again.
  const activeContextIds = useMemo(() => contextIds.filter((id) => contexts.some((c) => c.id === id)), [contextIds, contexts]);
  // The ad-hoc row is never filtered out: the AI picks its mart on its own.
  const rows = useMemo(
    () => (activeContextIds.length
      ? allRows.filter((r) => r.kind === 'adhoc' || inContexts(model.marts.get(r.martId), activeContextIds))
      : allRows),
    [allRows, activeContextIds, model],
  );
  const toggleContext = useCallback((id: string) => {
    setContextIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));
    setHighlighted(null);
  }, []);

  const typed = useCallback((value: string) => {
    setDraft(value);
    draftRef.current = value;
    setHighlighted(null);
    setNotice(null);
    setListShown(true);
    stopTimer();
    stopSearch();
    stopPick();
    const q = value.trim();
    if (q.length < MIN_QUERY) return;
    timer.current = setTimeout(() => { timer.current = null; fetchFor(q); }, SEARCH_DEBOUNCE_MS);
  }, [fetchFor, stopSearch, stopPick]);

  /** The marts the band shows after a pick: what the search found, with the picked mart among them. */
  const idsWith = (hits: SearchHits, martId: string) => (hits.marts.includes(martId) ? hits.marts : [martId, ...hits.marts]);
  const keepSource = (martId: string) => {
    const { selection, model: current } = latest.current;
    return selection.sourceKey && current.marts.get(martId)?.sourceKey === selection.sourceKey ? selection.sourceKey : null;
  };
  const newPick = (query: string, kind: 'adhoc' | 'other' = 'other') => {
    picking.current?.ctl.abort();
    const ctl = new AbortController();
    picking.current = { ctl, query, kind };
    setBuilding(false);
    setProgress(null);
    setAlternatives([]);
    setNotice(null);
    return ctl;
  };
  const finishPick = (ctl: AbortController) => { if (picking.current?.ctl === ctl) { picking.current = null; setBuilding(false); } };

  const pickReport = async (row: Extract<Row, { kind: 'report' }>, query: string, hits: SearchHits) => {
    const ctl = newPick(query);
    try {
      const report = await ctx.owox.getJson<ReportDto>(`/api/reports/${encodeURIComponent(row.id)}`);
      const [native, sources] = await Promise.all([schemas.get(row.martId), blendable.get(row.martId)]);
      const { grid, skipped } = reportToGrid(report, withJoined(native, sources), native);
      if (ctl.signal.aborted) return;
      dispatch({ type: 'smartFound', query, ids: idsWith(hits, row.martId) });
      // The main mart and the report's grid change in one store step, so one Undo takes both back.
      if (grid) dispatch({ type: 'setMarts', selection: { sourceKey: keepSource(row.martId), martId: row.martId, record: null }, grids: { [row.martId]: grid } });
      else dispatch({ type: 'selectMart', id: row.martId, sourceOf: sourceOfModel(latest.current.model) });
      setNotice(reportSkippedMessage(skipped));
    } catch {
      if (!ctl.signal.aborted) setNotice("This report couldn't be opened.");
    } finally { finishPick(ctl); }
  };

  const pickMart = (martId: string, query: string, hits: SearchHits) => {
    stopPick();
    setNotice(null);
    dispatch({ type: 'smartFound', query, ids: idsWith(hits, martId) });
    dispatch({ type: 'selectMart', id: martId, sourceOf: sourceOfModel(latest.current.model) });
  };

  /** Opens a mart in its default columns as one Undo step; the pipeline's fills land on this grid. */
  const openDefault = async (query: string, martId: string, hits: SearchHits, ctl: AbortController): Promise<GridState | null> => {
    const native = await schemas.get(martId);
    if (ctl.signal.aborted) return null;
    const first: GridState = { columns: defaultColumns(native), filters: {}, sorts: null, limit: PAGE_SIZE };
    send({ type: 'smartFound', query, ids: idsWith(hits, martId) });
    // Always a history entry, so one Undo takes back the pick and the pipeline's grid together, even when the mart was already open.
    send({ type: 'setMarts', selection: { sourceKey: keepSource(martId), martId, record: null }, grids: { [martId]: first }, always: true });
    return first;
  };

  const runAdhoc = async (query: string, hits: SearchHits, ctl: AbortController, opts: { intent?: Intent; mainId?: string } = {}) => {
    if (!models || !pipelineReady(models)) {
      const martId = hits.marts[0] ?? hits.reports[0]?.martId;
      if (martId) await openDefault(query, martId, hits, ctl); else dispatch({ type: 'search', q: query });
      return;
    }
    setAlternatives([]);
    const decide = createDecide(models.decision);
    const result = await runPipeline(
      { query, hits, model: latest.current.model, ...opts },
      { ctx, decide, fast: models.fast, signal: ctl.signal, schemas, blendable },
      {
        open: (martId) => openDefault(query, martId, hits, ctl),
        fill: (martId, expect, grid) => { if (!ctl.signal.aborted) send({ type: 'fillGrid', martId, expect, grid }); },
        owns: (martId, grid) => { const s = mirror.current; return s.future.length === 0 && s.selection.martId === martId && deepEqual(s.grids[martId] ?? null, grid); },
        progress: (p) => { if (!ctl.signal.aborted) setProgress(p); },
        alternatives: (ids, intent) => { if (ctl.signal.aborted) return; lastRun.current = { query, hits, intent }; setAlternatives(ids); },
        // The run reads the server's doc (after this tab's own saves) and its write updates the store copy too, with no Undo step.
        chartSettings: { load: chartSettings.load, save: (martId, settings) => { send({ type: 'saveCharts', martId, settings }); return chartSettings.save(martId, settings); } },
      },
    );
    if (ctl.signal.aborted) return;
    lastRun.current = { query, hits, intent: result.intent };
    if (result.status === 'nothing') dispatch({ type: 'search', q: query });
    if (result.status === 'failed') setNotice("AI couldn't finish the report. Showing what it built so far.");
  };

  const pick = (row?: Row) => {
    setListShown(false);
    setHighlighted(null);
    const query = draftRef.current.trim();
    if (queryProblem(query)) return;
    // A row came from the list on screen, which may be the previous query's; the ad-hoc run fetches its own.
    // The query those results belong to, which is the one smartFound should carry for a row picked from them.
    const current = found ? found.hits : NO_HITS;
    const rowQuery = found?.query ?? query;
    if (row?.kind === 'report') { void pickReport(row, rowQuery, current); return; }
    if (row?.kind === 'mart') { pickMart(row.martId, rowQuery, current); return; }
    if (row?.disabled && row.kind === 'adhoc' && !row.pending) { stopPick(); dispatch({ type: 'search', q: query }); return; }
    if (query.length < MIN_QUERY) { stopPick(); dispatch({ type: 'search', q: query }); return; }
    if (picking.current?.kind === 'adhoc' && picking.current.query === query) return;
    const ctl = newPick(query, 'adhoc');
    setBuilding(true);
    void (async () => {
      try {
        const hits = await fetchFor(query).done;
        if (ctl.signal.aborted || !hits) return;
        await runAdhoc(query, hits, ctl);
      } catch { /* A failed search or schema read leaves the page as it was. */ }
      finally { finishPick(ctl); if (picking.current === null) setProgress(null); }
    })();
  };

  const chooseAlternative = (martId: string) => {
    const last = lastRun.current;
    if (!last) return;
    const ctl = newPick(last.query, 'adhoc');
    setBuilding(true);
    setAlternatives([]);
    void runAdhoc(last.query, last.hits, ctl, { intent: last.intent, mainId: martId }).catch(() => undefined).finally(() => { finishPick(ctl); if (picking.current === null) setProgress(null); });
  };

  const listOpen = open && listShown && rows.length > 0;
  const enabled = useMemo(() => rows.flatMap((r, i) => (r.kind === 'adhoc' && r.disabled ? [] : [i])), [rows]);
  const move = (delta: 1 | -1) => {
    if (!listOpen) { if (rows.length) setListShown(true); return; }
    if (!enabled.length) return;
    setHighlighted((h) => {
      const at = h === null ? -1 : enabled.indexOf(h);
      const next = at === -1 ? (delta === 1 ? 0 : enabled.length - 1) : (at + delta + enabled.length) % enabled.length;
      return enabled[next]!;
    });
  };

  const clear = () => {
    stopTimer(); stopSearch(); stopPick();
    setDraft(''); draftRef.current = '';
    setFound(null); setHighlighted(null); setNotice(null); setListShown(false); setContextIds([]); setAlternatives([]);
    if (state.search || state.found.length) dispatch({ type: 'search', q: '' });
  };

  return {
    model,
    /** The query on screen as a result: set while a search is applied, whichever way it was answered. */
    applied,
    /** Whether an AI model is ready to build ad-hoc reports. */
    aiReady,
    open,
    busy: building || searching,
    draft,
    setDraft: typed,
    problem: queryProblem(draft),
    openBox: () => { setDraft(applied); draftRef.current = applied; setOpen(true); },
    closeBox: () => {
      stopTimer();
      // An ad-hoc pick may still be waiting on this search: closing the box must not drop it.
      if (!(picking.current?.kind === 'adhoc' && picking.current.query === entry.current?.query)) stopSearch();
      setDraft(applied); draftRef.current = applied; setOpen(false); setListShown(false); setHighlighted(null);
    },
    submit: () => pick(),
    clear,
    rows, highlighted, setHighlighted, move, pick,
    contexts, activeContextIds, toggleContext,
    listOpen,
    closeList: () => { setListShown(false); setHighlighted(null); },
    notice,
    progress, alternatives, chooseAlternative,
    dismissNotice: () => setNotice(null),
    /** The one-line hint that suggests plugging AI in: only while the search is in use, only without a model, until dismissed. */
    hintVisible: (open || applied !== '') && !aiReady && !hintDismissed,
    dismissHint: () => { setHintDismissed(true); preferences.dismissAiHint(); },
  };
}
export type SmartSearch = ReturnType<typeof useSmartSearch>;
