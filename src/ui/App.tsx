import { useEffect, useMemo, useRef, useState } from 'react';
import type { MainMart } from '../api/preferences';
import { LOADED_HOLD_MS, martAppUrl } from '../config';
import { tickedStorages } from '../graph/storages';
import { computeVisible } from '../graph/visible';
import { joinedMartIds } from '../state/join-plan';
import { sourceOfModel, useServices, useStore } from '../state/store';
import { CardBands } from './bands/CardBands';
import { DataBand } from './bands/DataBand';
import type { CardRules } from '../filters/card-rules';
import { RowBand } from './bands/RowBand';
import { LoadingBands } from './bands/LoadingBands';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { HistoryButtons } from './header/HistoryButtons';
import { HeaderSearch, HeaderSearchHint, SmartSearchScope } from './bands/SmartSearchScope';
import { TooltipProvider } from './Tooltip';
import { useJoinSources } from './useJoinSources';
import { useViewLink } from './useViewLink';
import { buildJoinTree, statusIds } from '../state/join-tree';
import { useCardStatus, useModel } from './useModelData';
import { useFilteredCounts } from './useFilteredCounts';

export function App() {
  return <TooltipProvider><AppBody /></TooltipProvider>;
}

type Fold = 'sources' | 'marts' | 'data' | 'row';
/** Only the Data Sources band starts folded; the member's saved choice, when there is one, replaces this. */
const DEFAULT_FOLDED: Record<Fold, boolean> = { sources: true, marts: false, data: false, row: false };
const mainKey = (martId: string, sourceKey: string | null) => `${martId}\n${sourceKey ?? ''}`;
const bandId = (band: Fold) => `band-${band}`;

function AppBody() {
  const [state, dispatch] = useStore();
  const { ctx, preferences } = useServices();
  const { model, error, progress, reload } = useModel();
  // Folding is per band and lives here. A band the reader has not touched follows its default:
  // Data Sources is folded while there is nothing in it.
  const [folds, setFolds] = useState<Partial<Record<Fold, boolean>>>({});
  // The member's saved choices arrive once; a band they have already clicked meanwhile keeps that click.
  // `saved` is the whole stored document, so a write merges into it rather than replacing it, and a click
  // made before the read settles is written once it has (a write before it would overwrite what it is about to read).
  const [prefsReady, setPrefsReady] = useState(false);
  const saved = useRef<Record<string, boolean>>({});
  // The main mart the member had last: read with the folds and used once, by the first load pick. Null when none or the read failed.
  const remembered = useRef<MainMart | null>(null);
  // The last value stored (as far as known), and the selection that was applied for the member (first-load pick, view link, fallback). Only a change away from it is saved.
  const lastWritten = useRef<string | null>(null);
  const applied = useRef<string | null | undefined>(undefined);
  const clicked = useRef<Partial<Record<Fold, boolean>>>({});
  const write = (changes: Partial<Record<Fold, boolean>>) => {
    saved.current = { ...saved.current, ...Object.fromEntries((Object.keys(changes) as Fold[]).map((b) => [bandId(b), changes[b]!])) };
    preferences.saveFolded(saved.current);
  };
  useEffect(() => {
    let live = true;
    Promise.all([preferences.loadFolded(), preferences.loadMainMart()]).then(([stored, main]) => {
      if (!live) return;
      saved.current = stored;
      remembered.current = main ?? null;
      lastWritten.current = main ? mainKey(main.martId, main.sourceKey) : null;
      const known = Object.fromEntries((Object.keys(DEFAULT_FOLDED) as Fold[]).flatMap((b) => (typeof stored[bandId(b)] === 'boolean' ? [[b, stored[bandId(b)]!]] : [])));
      setFolds(known);
      if (Object.keys(clicked.current).length > 0) write(clicked.current);
      clicked.current = {};
      setPrefsReady(true);
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preferences]);
  // Precedence: a band the member clicked, then the view link's fold, then the saved one, then the default.
  // Full screen shows the Data band alone. It is never saved: a page always opens in the normal layout.
  const [fs, setFs] = useState(false);
  // The rules each card of the report counts, told by the grid for the cards. Memory only: no save, no Undo step.
  const [cardRulesOf, setCardRulesOf] = useState<{ martId: string; byPath: ReadonlyMap<string, CardRules> } | null>(null);
  const [touched, setTouched] = useState<Partial<Record<Fold, boolean>>>({});
  const [linkFolds, setLinkFolds] = useState<Partial<Record<Fold, boolean>>>({});
  const folded = (band: Fold) => touched[band] ?? linkFolds[band] ?? folds[band] ?? DEFAULT_FOLDED[band];
  if (fs && folded('data')) setFs(false);
  useEffect(() => {
    if (!fs) return;
    // Bubble phase, after the menus, popovers and editors have had the key: whatever handled it stopped or prevented it.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('[role=menu], [role=dialog], input, textarea, select, [contenteditable=""], [contenteditable=true]')) return;
      if (document.querySelector('[data-column-menu], details[open]')) return;
      setFs(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fs]);
  const link = useViewLink(model, { sources: folded('sources'), marts: folded('marts'), data: folded('data'), row: folded('row') });
  // A page that opens from a view link has one more step: the link's own read. Link folds win over saved ones for this visit and are never written.
  const [hasLink] = useState(link.pending);
  if (link.folded && linkFolds !== link.folded) setLinkFolds(link.folded);
  // Every read is a step of the bar: the model's own, the saved folds and a view link. Once it is full it stays full and green for a moment, then the bodies open.
  const done = progress.done + (prefsReady ? 1 : 0) + (hasLink && !link.pending ? 1 : 0);
  const total = progress.total + 1 + (hasLink ? 1 : 0);
  const full = !!model && prefsReady && !link.pending && done >= total;
  // True once the first load found no main mart to return to and no view link: the search box opens for the member.
  const [firstVisit, setFirstVisit] = useState(false);
  // Settled by the first pick of the page only: a later empty selection (a source toggled off) is not a first visit.
  const firstPick = useRef(true);
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!full || held) return;
    const t = setTimeout(() => setHeld(true), LOADED_HOLD_MS);
    return () => clearTimeout(t);
  }, [full, held]);
  // The total grows once the storages are known, so the raw fraction can dip: the bar never moves back.
  const raw = Math.min(1, done / total);
  const [peak, setPeak] = useState(0);
  if (raw > peak) setPeak(raw);
  const loading = held ? null : Math.max(raw, peak);
  const toggle = (band: Fold) => {
    const now = !folded(band);
    setTouched((t) => ({ ...t, [band]: now }));
    if (prefsReady) write({ [band]: now });
    else clicked.current = { ...clicked.current, [band]: now };
  };
  const storageIds = useMemo(() => (model ? tickedStorages(model, state.storageIds) : null), [model, state.storageIds]);
  // The joined data marts are those with a field among the main grid's columns; which marts the main one can join is read when it becomes main.
  const mainId = state.selection.martId;
  const { sources: joinSources, failed: joinsFailed } = useJoinSources(model && mainId && model.marts.get(mainId)?.accessible ? mainId : null);
  const mainColumns = mainId ? state.grids[mainId]?.columns : undefined;
  const mainEmptyPaths = mainId ? state.grids[mainId]?.emptyPaths : undefined;
  const joined = useMemo(() => (joinSources && mainColumns ? joinedMartIds(mainColumns, joinSources, mainEmptyPaths) : []), [joinSources, mainColumns, mainEmptyPaths]);
  // Marts whose fields carry a filter or a slice (applied or parked) are shown too, whether or not a column of theirs is on the grid.
  const mainFilters = mainId ? state.grids[mainId]?.filters : undefined;
  const mainSlices = mainId ? state.grids[mainId]?.slices : undefined;
  const filtered = useMemo(() => (joinSources && mainFilters ? joinedMartIds([...Object.keys(mainFilters), ...Object.keys(mainSlices ?? {})], joinSources) : []), [joinSources, mainFilters, mainSlices]);
  // A failed read is not "joins nothing": with no answer the band keeps its one-hop fallback and dims nothing.
  const joinable = useMemo(() => (joinSources && !joinsFailed ? [...new Set(joinSources.map((s) => s.martId))] : null), [joinSources, joinsFailed]);
  const visible = useMemo(
    () => (model ? computeVisible({ model, selection: state.selection, search: state.search, contextIds: state.contextIds, storageIds, joined, filtered, found: state.found, joinable }) : null),
    [model, state.selection, state.search, state.found, state.contextIds, storageIds, joined, filtered, joinable],
  );
  // The join tree's marts are counted too: a bare node on the way to a joined mart is on the canvas but not in the band's list.
  const reportTree = useMemo(() => (mainId ? buildJoinTree(mainId, mainColumns ?? [], joinSources ?? [], mainEmptyPaths) : null), [mainId, mainColumns, joinSources, mainEmptyPaths]);
  const statusIdList = useMemo(() => statusIds(visible?.ids ?? [], reportTree), [visible, reportTree]);
  const { dq, counts, request, offer, hold, recount } = useCardStatus(model, statusIdList, state.modelVersion);
  const { filtered: filteredCounts, retry: retryFiltered, seed: seedFiltered, forget: forgetFilteredOf } = useFilteredCounts(model, cardRulesOf?.byPath ?? null);

  // There is always a selected mart after load: the first load picks the focus mart, and a mart or
  // source a refresh took away is dropped from the selection (no history entry, so Back is not trapped).
  // A selected source with no mart is a choice, not a gap.
  const focusId = visible?.focusId ?? null;
  const { martId, sourceKey } = state.selection;
  useEffect(() => {
    if (!model || link.pending) return;
    // Any selection before the first pick (a mart picked while the preferences load) settles the first visit.
    if (martId || sourceKey) firstPick.current = false;
    // Nothing to fall back to (every ticked storage is empty): a selected mart that is gone leaves an empty selection.
    if (!focusId) {
      if (martId && !model.marts.has(martId)) dispatch({ type: 'replace', selection: { sourceKey: null, martId: null, record: null } });
      return;
    }
    // Nothing selected on purpose (the last selected mart was clicked off) stays that way.
    if (!martId && !sourceKey) {
      // The first load waits for the saved preferences: it opens the mart the member had last, or the focus mart when that one is gone or not shown.
      if (state.selection.cleared || !prefsReady) return;
      const last = remembered.current;
      const openable = !!last && !!model.marts.get(last.martId)?.accessible && (storageIds === null || storageIds.includes(model.marts.get(last.martId)!.storageId));
      // The remembered mart serves this pick only; later empty selections (a source toggled off and on) get the focus mart.
      remembered.current = null;
      const first = firstPick.current;
      firstPick.current = false;
      if (!last || !openable) { if (first && !hasLink) setFirstVisit(true); applied.current = mainKey(focusId, null); dispatch({ type: 'init', focusId }); return; }
      const keep = last.sourceKey && model.sources.some((x) => x.key === last.sourceKey) && sourceOfModel(model)(last.martId) === last.sourceKey ? last.sourceKey : null;
      applied.current = mainKey(last.martId, keep);
      dispatch({ type: 'init', focusId: last.martId, sourceKey: keep });
      return;
    }
    const martGone = !!martId && !model.marts.has(martId);
    const sourceGone = !!sourceKey && !model.sources.some((x) => x.key === sourceKey);
    if (!martGone && !sourceGone) return;
    const keep = sourceGone ? null : sourceKey;
    // A fallback is not the member's choice: it is not saved.
    if (!martGone && martId) applied.current = mainKey(martId, null);
    if (martGone) applied.current = mainKey(focusId, keep && sourceOfModel(model)(focusId) === keep ? keep : null);
    dispatch({
      type: 'replace',
      selection: martGone
        ? { sourceKey: keep && sourceOfModel(model)(focusId) === keep ? keep : null, martId: focusId, record: null }
        : { ...state.selection, sourceKey: null },
    });
  }, [model, link.pending, prefsReady, storageIds, focusId, martId, sourceKey, state.selection, hasLink, dispatch]);
  // The member's own selection changes are remembered. The mart the page opened on (remembered, focus fallback or view link) is not: a shared link
  // or a temporary fallback must not replace the saved one. Nothing is written before the saved value is read.
  useEffect(() => {
    if (!prefsReady || link.pending) return;
    if (!martId) {
      // A link that opened on a source alone has no mart to adopt; a mart clicked off is the member's own choice, so the next one is saved.
      // Not cleared on every empty selection: the first-load pick sets `applied` and dispatches in the same commit, while the mart is still empty.
      if ((sourceKey && applied.current === undefined) || state.selection.cleared) { applied.current = null; remembered.current = null; }
      return;
    }
    const key = mainKey(martId, sourceKey);
    if (applied.current === undefined) { applied.current = key; remembered.current = null; return; }
    if (key === applied.current) return;
    applied.current = null;
    if (key === lastWritten.current) return;
    lastWritten.current = key;
    preferences.saveMainMart({ martId, sourceKey });
  }, [prefsReady, link.pending, martId, sourceKey, state.selection.cleared, preferences]);

  // A failed refresh keeps the loaded model on screen; the error shows in the header.
  if (error && !model) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) {
    // The page shell at once: every band's header, and a bar in place of each body.
    return (
      <div className="dm-page">
        <Header notice={link.notice} onDismissNotice={link.dismiss} />
        <main className="dm-page-content">
          <LoadingBands loading={loading ?? 0} folded={{ sources: folded('sources'), marts: folded('marts'), data: folded('data'), row: folded('row') }} onFold={toggle} />
        </main>
      </div>
    );
  }

  return (
    <SmartSearchScope model={model}>
    <div className={`dm-page${fs ? ' dm-full' : ''}`}>
      <Header
        search={<HeaderSearch autoOpen={firstVisit} />}
        hint={<HeaderSearchHint />}
        failedStorages={model.failedStorages}
        error={error}
        onRetry={reload}
        history={<HistoryButtons model={model} />}
        onCopyLink={ctx.route !== undefined ? () => void link.copy() : undefined}
        notice={link.notice}
        onDismissNotice={link.dismiss}
      />
      <main className="dm-page-content">
        <CardBands
          model={model}
          visible={visible}
          storageIds={storageIds}
          joinSources={joinSources}
          mainColumns={mainColumns ?? []}
          mainEmptyPaths={mainEmptyPaths}
          counts={counts}
          filtered={cardRulesOf?.martId === mainId ? filteredCounts : undefined}
          filteredRetry={retryFiltered}
          dq={dq}
          foldedSources={folded('sources')}
          foldedMarts={folded('marts')}
          onFoldSources={() => toggle('sources')}
          onFoldMarts={() => toggle('marts')}
          onRetryCount={(id) => void recount(id)}
          onRequestCount={request}
          onOpenApp={(id) => void ctx.ui.openExternal(martAppUrl(ctx, id))}
          loading={loading}
        >
          {/* While the bar shows, neither band reads anything: the saved folds are not known yet, and one saved as folded must not read rows first. */}
          <DataBand onCardRules={setCardRulesOf} onCount={offer} onFilteredTotal={seedFiltered} onForgetFiltered={forgetFilteredOf} onCardHold={hold} onRecount={(id) => void recount(id)} model={model} folded={folded('data')} onFold={() => toggle('data')} loading={loading} fullScreen={{ on: fs, onToggle: () => setFs((f) => !f) }} />
          <RowBand model={model} folded={folded('row')} onFold={() => toggle('row')} loading={loading} />
        </CardBands>
      </main>
    </div>
    </SmartSearchScope>
  );
}
