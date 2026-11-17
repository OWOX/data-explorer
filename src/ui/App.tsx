import { useEffect, useMemo, useRef, useState } from 'react';
import { LOADED_HOLD_MS, martAppUrl } from '../config';
import { tickedStorages } from '../graph/storages';
import { computeVisible } from '../graph/visible';
import { joinedMartIds } from '../state/join-plan';
import { sourceOfModel, useServices, useStore } from '../state/store';
import { CardBands } from './bands/CardBands';
import { DataBand } from './bands/DataBand';
import { RowBand } from './bands/RowBand';
import { LoadingBands } from './bands/LoadingBands';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { HistoryButtons } from './header/HistoryButtons';
import { HeaderSearch, HeaderSearchHint, SmartSearchScope } from './bands/SmartSearchScope';
import { TooltipProvider } from './Tooltip';
import { useJoinSources } from './useJoinSources';
import { useViewLink } from './useViewLink';
import { useCardStatus, useModel } from './useModelData';

export function App() {
  return <TooltipProvider><AppBody /></TooltipProvider>;
}

type Fold = 'sources' | 'marts' | 'data' | 'row';
/** Only the Data Sources band starts folded; the member's saved choice, when there is one, replaces this. */
const DEFAULT_FOLDED: Record<Fold, boolean> = { sources: true, marts: false, data: false, row: false };
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
  const clicked = useRef<Partial<Record<Fold, boolean>>>({});
  const write = (changes: Partial<Record<Fold, boolean>>) => {
    saved.current = { ...saved.current, ...Object.fromEntries((Object.keys(changes) as Fold[]).map((b) => [bandId(b), changes[b]!])) };
    preferences.saveFolded(saved.current);
  };
  useEffect(() => {
    let live = true;
    preferences.loadFolded().then((stored) => {
      if (!live) return;
      saved.current = stored;
      const known = Object.fromEntries((Object.keys(DEFAULT_FOLDED) as Fold[]).flatMap((b) => (typeof stored[bandId(b)] === 'boolean' ? [[b, stored[bandId(b)]!]] : [])));
      setFolds((own) => ({ ...known, ...own }));
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
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (!full || held) return;
    const t = setTimeout(() => setHeld(true), LOADED_HOLD_MS);
    return () => clearTimeout(t);
  }, [full, held]);
  const opened = held;
  // The total grows once the storages are known, so the raw fraction can dip: the bar never moves back.
  const raw = Math.min(1, done / total);
  const [peak, setPeak] = useState(0);
  if (raw > peak) setPeak(raw);
  const loading = opened ? null : Math.max(raw, peak);
  const toggle = (band: Fold) => {
    const now = !folded(band);
    setFolds((f) => ({ ...f, [band]: now }));
    setTouched((t) => ({ ...t, [band]: now }));
    if (prefsReady) write({ [band]: now });
    else clicked.current = { ...clicked.current, [band]: now };
  };
  const storageIds = useMemo(() => (model ? tickedStorages(model, state.storageIds) : null), [model, state.storageIds]);
  // The joined data marts are those with a field among the main grid's columns; which marts the main one can join is read when it becomes main.
  const mainId = state.selection.martId;
  const joinSources = useJoinSources(model && mainId && model.marts.get(mainId)?.accessible ? mainId : null);
  const mainColumns = mainId ? state.grids[mainId]?.columns : undefined;
  const joined = useMemo(() => (joinSources && mainColumns ? joinedMartIds(mainColumns, joinSources) : []), [joinSources, mainColumns]);
  // Marts whose fields carry a filter (applied or parked) are shown too, whether or not a column of theirs is on the grid.
  const mainFilters = mainId ? state.grids[mainId]?.filters : undefined;
  const filtered = useMemo(() => (joinSources && mainFilters ? joinedMartIds(Object.keys(mainFilters), joinSources) : []), [joinSources, mainFilters]);
  const visible = useMemo(
    () => (model ? computeVisible({ model, selection: state.selection, search: state.search, contextIds: state.contextIds, storageIds, joined, filtered, found: state.found }) : null),
    [model, state.selection, state.search, state.found, state.contextIds, storageIds, joined, filtered],
  );
  const { dq, counts, request, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);

  // There is always a selected mart after load: the first load picks the focus mart, and a mart or
  // source a refresh took away is dropped from the selection (no history entry, so Back is not trapped).
  // A selected source with no mart is a choice, not a gap.
  const focusId = visible?.focusId ?? null;
  const { martId, sourceKey } = state.selection;
  useEffect(() => {
    if (!model || link.pending) return;
    // Nothing to fall back to (every ticked storage is empty): a selected mart that is gone leaves an empty selection.
    if (!focusId) {
      if (martId && !model.marts.has(martId)) dispatch({ type: 'replace', selection: { sourceKey: null, martId: null, record: null } });
      return;
    }
    // Nothing selected on purpose (the last selected mart was clicked off) stays that way.
    if (!martId && !sourceKey) { if (!state.selection.cleared) dispatch({ type: 'init', focusId }); return; }
    const martGone = !!martId && !model.marts.has(martId);
    const sourceGone = !!sourceKey && !model.sources.some((x) => x.key === sourceKey);
    if (!martGone && !sourceGone) return;
    const keep = sourceGone ? null : sourceKey;
    dispatch({
      type: 'replace',
      selection: martGone
        ? { sourceKey: keep && sourceOfModel(model)(focusId) === keep ? keep : null, martId: focusId, record: null }
        : { ...state.selection, sourceKey: null },
    });
  }, [model, link.pending, focusId, martId, sourceKey, state.selection, dispatch]);

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
        search={<HeaderSearch />}
        hint={<HeaderSearchHint />}
        failedStorages={model.failedStorages}
        error={error}
        onRetry={reload}
        history={<HistoryButtons model={model} />}
        onCopyLink={ctx.route !== undefined && ctx.ui.copyLink ? () => void link.copy() : undefined}
        notice={link.notice}
        onDismissNotice={link.dismiss}
      />
      <main className="dm-page-content">
        <CardBands
          model={model}
          visible={visible}
          storageIds={storageIds}
          joined={joined}
          counts={counts}
          dq={dq}
          foldedSources={folded('sources')}
          foldedMarts={folded('marts')}
          onFoldSources={() => toggle('sources')}
          onFoldMarts={() => toggle('marts')}
          onRetryCount={(id) => void recount(id)}
          onRequestCount={request}
          onOpenApp={(id) => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id))}
          loading={loading}
        >
          {/* While the bar shows, neither band reads anything: the saved folds are not known yet, and one saved as folded must not read rows first. */}
          <DataBand model={model} folded={folded('data')} onFold={() => toggle('data')} loading={loading} fullScreen={{ on: fs, onToggle: () => setFs((f) => !f) }} />
          <RowBand model={model} folded={folded('row')} onFold={() => toggle('row')} loading={loading} />
        </CardBands>
      </main>
    </div>
    </SmartSearchScope>
  );
}
