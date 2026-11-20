import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { withJoined } from '../../api/blendable';
import { PAGE_SIZE } from '../../config';
import type { Context, Mart, Model } from '../../model/types';
import { pickModels } from '../../search/ai';
import { MIN_QUERY, queryProblem, searchEndpoint, type SearchHits } from '../../search/endpoint';
import { reportSkippedMessage, reportToGrid, type ReportDto } from '../../search/report-load';
import { buildAdhocView, findAdhocMart } from '../../search/run';
import { deepEqual, sourceOfModel, useServices, useStore, type GridState } from '../../state/store';
import { defaultColumns } from '../explorer/useMartRows';

/** How long typing must pause before the search runs. */
export const SEARCH_DEBOUNCE_MS = 300;
const MAX_CONTEXTS = 3;
const SHORT_REASON = 'Type at least 2 characters';
const NO_MART_REASON = 'No data mart found';

export type Row =
  | { kind: 'report'; id: string; title: string; martId: string }
  | { kind: 'mart'; martId: string }
  | { kind: 'adhoc'; martId: string | null; pending: boolean; disabled: boolean; reason?: string };

/** The first three of a mart's contexts that the model holds, in the mart's order. */
export function contextsOf(mart: Mart | undefined, model: Model): Context[] {
  if (!mart) return [];
  const known = new Map(model.contexts.map((c) => [c.id, c]));
  return mart.contextIds.flatMap((id) => { const c = known.get(id); return c ? [c] : []; }).slice(0, MAX_CONTEXTS);
}

type Found = { query: string; hits: SearchHits; martId: string | null; pending: boolean };
type Entry = { query: string; ctl: AbortController; done: Promise<{ hits: SearchHits; martId: string | null } | null> };
const NO_HITS: SearchHits = { reports: [], marts: [] };

/**
 * The Data Marts band's search: the box's open and typed state, the dropdown that fills while the member types, and what a pick
 * does. Once typing pauses, OWOX's search runs (and one AI question that names the ad-hoc report's mart, when the project has a
 * model). The list shows reports, then data marts, then the ad-hoc row. Nothing is applied before a pick; the AI's view of an
 * ad-hoc report is asked for only after the member picks that row.
 */
export function useSmartSearch(model: Model) {
  const [state, dispatch] = useStore();
  const { ctx, schemas, blendable, preferences, aiTimeoutMs } = useServices();
  const applied = state.search.trim();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [listShown, setListShown] = useState(false);
  const [found, setFound] = useState<Found | null>(null);
  const [searching, setSearching] = useState(false);
  const [building, setBuilding] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Hidden until the stored choice has been read, so a member who dismissed it never sees it flash.
  const [hintDismissed, setHintDismissed] = useState(true);
  const aiConfigured = useMemo(() => pickModels(ctx) !== null, [ctx]);
  const latest = useRef({ selection: state.selection, grids: state.grids, history: state.history, model });
  useEffect(() => { latest.current = { selection: state.selection, grids: state.grids, history: state.history, model }; });
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
  const stopPick = useCallback(() => { picking.current?.ctl.abort(); picking.current = null; setBuilding(false); }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); entry.current?.ctl.abort(); picking.current?.ctl.abort(); }, []);

  /** Starts the search for a query, or joins the one already running for it. The answer is null when a newer query took over. */
  const fetchFor = useCallback((query: string): Entry => {
    if (entry.current && entry.current.query === query && !entry.current.ctl.signal.aborted) return entry.current;
    entry.current?.ctl.abort();
    const ctl = new AbortController();
    const onHostAbort = () => ctl.abort();
    ctx.signal.addEventListener('abort', onHostAbort, { once: true });
    setSearching(true);
    const deps = { ctx, model: latest.current.model, signal: ctl.signal, timeoutMs: aiTimeoutMs };
    const done = (async () => {
      try {
        const hits = await searchEndpoint(ctx, query, deps.model, ctl.signal);
        if (ctl.signal.aborted) return null;
        const fallback = hits.marts[0] ?? hits.reports[0]?.martId ?? null;
        setFound({ query, hits, martId: aiConfigured ? null : fallback, pending: aiConfigured });
        if (!aiConfigured) return { hits, martId: fallback };
        const adhoc = await findAdhocMart(deps, query, hits);
        if (ctl.signal.aborted) return null;
        setFound((f) => (f && f.query === query ? { ...f, martId: adhoc.martId, pending: false } : f));
        return { hits, martId: adhoc.martId };
      } finally {
        ctx.signal.removeEventListener('abort', onHostAbort);
        if (entry.current?.ctl === ctl) setSearching(false);
      }
    })();
    const next: Entry = { query, ctl, done };
    entry.current = next;
    return next;
  }, [ctx, aiConfigured, aiTimeoutMs]);

  const trimmed = draft.trim();
  const rows = useMemo<Row[]>(() => {
    if (!trimmed) return [];
    if (trimmed.length < MIN_QUERY) return [{ kind: 'adhoc', martId: null, pending: false, disabled: true, reason: SHORT_REASON }];
    // The previous query's reports and marts stay while a new one is in flight; only the ad-hoc row waits.
    if (!found) return [{ kind: 'adhoc', martId: null, pending: true, disabled: true }];
    const stale = found.query !== trimmed;
    const out: Row[] = [
      ...found.hits.reports.map((r): Row => ({ kind: 'report', id: r.id, title: r.title, martId: r.martId })),
      ...found.hits.marts.map((martId): Row => ({ kind: 'mart', martId })),
    ];
    out.push(found.pending || stale
      ? { kind: 'adhoc', martId: null, pending: true, disabled: true }
      : found.martId
        ? { kind: 'adhoc', martId: found.martId, pending: false, disabled: false }
        : { kind: 'adhoc', martId: null, pending: false, disabled: true, reason: NO_MART_REASON });
    return out;
  }, [trimmed, found]);

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

  const pickAdhoc = async (query: string, martId: string, hits: SearchHits, ctl: AbortController) => {
    try {
      const native = await schemas.get(martId);
      if (ctl.signal.aborted) return;
      const first: GridState = { columns: defaultColumns(native), filters: {}, sorts: null, limit: PAGE_SIZE };
      dispatch({ type: 'smartFound', query, ids: idsWith(hits, martId) });
      const selection = { sourceKey: keepSource(martId), martId, record: null };
      // A mart that is already open in its default view makes the setMarts below a no-op with no history entry. Then the AI's
      // grid is the step Undo has to take back, so it goes in as an edit.
      const lastBefore = latest.current.history.at(-1);
      dispatch({ type: 'setMarts', selection, grids: { [martId]: first } });
      if (!aiConfigured) return;
      setBuilding(true);
      const view = await buildAdhocView({ ctx, model: latest.current.model, schemas, signal: ctl.signal, timeoutMs: aiTimeoutMs }, query, martId);
      if (ctl.signal.aborted) return;
      if (view.grid) {
        // A member who edited the grid, or moved elsewhere, meanwhile keeps what they did.
        const { grids, selection } = latest.current;
        // No history entry since the pick means setMarts changed nothing, so the AI grid is the step Undo takes back.
        const unchanged = latest.current.history.at(-1) === lastBefore;
        if (deepEqual(grids[martId] ?? null, first) && selection.martId === martId) dispatch({ type: unchanged ? 'editGrid' : 'saveGrid', martId, grid: view.grid });
      } else if (view.ai === 'unavailable') setNotice("AI couldn't set up the view. Showing the default view.");
    } finally { finishPick(ctl); }
  };

  const pick = (row?: Row) => {
    setListShown(false);
    setHighlighted(null);
    const query = draftRef.current.trim();
    if (queryProblem(query)) return;
    // A row came from the list on screen, which may be the previous query's; the ad-hoc run fetches its own.
    const current = found ? found.hits : NO_HITS;
    if (row?.kind === 'report') { void pickReport(row, query, current); return; }
    if (row?.kind === 'mart') { pickMart(row.martId, query, current); return; }
    if (row?.disabled && row.kind === 'adhoc' && !row.pending) { stopPick(); dispatch({ type: 'search', q: query }); return; }
    if (query.length < MIN_QUERY) { stopPick(); dispatch({ type: 'search', q: query }); return; }
    // The ad-hoc row: wait for the search for this query, which may still be running.
    if (picking.current?.kind === 'adhoc' && picking.current.query === query) return;
    const ctl = newPick(query, 'adhoc');
    setBuilding(true);
    void (async () => {
      try {
        const answer = await fetchFor(query).done;
        if (ctl.signal.aborted || !answer) return;
        if (!answer.martId) { dispatch({ type: 'search', q: query }); return; }
        await pickAdhoc(query, answer.martId, answer.hits, ctl);
      } catch { /* A failed search or schema read leaves the page as it was. */ }
      finally { finishPick(ctl); }
    })();
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
    setFound(null); setHighlighted(null); setNotice(null); setListShown(false);
    if (state.search || state.found.length) dispatch({ type: 'search', q: '' });
  };

  return {
    model,
    /** The query on screen as a result: set while a search is applied, whichever way it was answered. */
    applied,
    open,
    busy: building || searching,
    draft,
    setDraft: typed,
    problem: queryProblem(draft),
    openBox: () => { setDraft(applied); draftRef.current = applied; setOpen(true); },
    closeBox: () => { stopTimer(); stopSearch(); setDraft(applied); draftRef.current = applied; setOpen(false); setListShown(false); setHighlighted(null); },
    submit: () => pick(),
    clear,
    rows, highlighted, setHighlighted, move, pick,
    listOpen,
    closeList: () => { setListShown(false); setHighlighted(null); },
    notice,
    dismissNotice: () => setNotice(null),
    /** The one-line hint that suggests plugging AI in: only while the search is in use, only without a model, until dismissed. */
    hintVisible: (open || applied !== '') && !aiConfigured && !hintDismissed,
    dismissHint: () => { setHintDismissed(true); preferences.dismissAiHint(); },
  };
}
export type SmartSearch = ReturnType<typeof useSmartSearch>;
