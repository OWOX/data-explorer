import { useEffect, useMemo, useState } from 'react';
import { martAppUrl } from '../config';
import { tickedStorages } from '../graph/storages';
import { computeVisible } from '../graph/visible';
import { sourceOfModel, useServices, useStore } from '../state/store';
import { CardBands } from './bands/CardBands';
import { DataBand } from './bands/DataBand';
import { RowBand } from './bands/RowBand';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { HistoryButtons } from './header/HistoryButtons';
import { Skeleton } from './Skeleton';
import { TooltipProvider } from './Tooltip';
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
  const { model, error, reload } = useModel();
  // Folding is per band and lives here. A band the reader has not touched follows its default:
  // Data Sources is folded while there is nothing in it.
  const [folds, setFolds] = useState<Partial<Record<Fold, boolean>>>({});
  // The member's saved choices arrive once; a band they have already clicked meanwhile keeps that click.
  useEffect(() => {
    let live = true;
    preferences.loadFolded().then((saved) => {
      if (!live) return;
      const known = Object.fromEntries((Object.keys(DEFAULT_FOLDED) as Fold[]).flatMap((b) => (typeof saved[bandId(b)] === 'boolean' ? [[b, saved[bandId(b)]!]] : [])));
      setFolds((own) => ({ ...known, ...own }));
    });
    return () => { live = false; };
  }, [preferences]);
  const folded = (band: Fold) => folds[band] ?? DEFAULT_FOLDED[band];
  const toggle = (band: Fold) => {
    const next = { ...folds, [band]: !folded(band) };
    setFolds(next);
    preferences.saveFolded(Object.fromEntries((Object.keys(next) as Fold[]).map((b) => [bandId(b), next[b]!])));
  };
  const storageIds = useMemo(() => (model ? tickedStorages(model, state.storageIds) : null), [model, state.storageIds]);
  const visible = useMemo(
    () => (model ? computeVisible({ model, selection: state.selection, search: state.search, contextIds: state.contextIds, storageIds }) : null),
    [model, state.selection, state.search, state.contextIds, storageIds],
  );
  const { dq, counts, request, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);

  // There is always a selected mart after load: the first load picks the focus mart, and a mart or
  // source a refresh took away is dropped from the selection (no history entry, so Back is not trapped).
  // A selected source with no mart is a choice, not a gap.
  const focusId = visible?.focusId ?? null;
  const { martId, sourceKey } = state.selection;
  useEffect(() => {
    if (!model) return;
    // Nothing to fall back to (every ticked storage is empty): a selected mart that is gone leaves an empty selection.
    if (!focusId) {
      if (martId && !model.marts.has(martId)) dispatch({ type: 'replace', selection: { sourceKey: null, martId: null, record: null } });
      return;
    }
    if (!martId && !sourceKey) { dispatch({ type: 'init', focusId }); return; }
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
  }, [model, focusId, martId, sourceKey, state.selection, dispatch]);

  // A failed refresh keeps the loaded model on screen; the error shows in the header.
  if (error && !model) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) return <Skeleton rows={6} />;

  return (
    <div className="dm-page">
      <Header failedStorages={model.failedStorages} error={error} onRetry={reload} history={<HistoryButtons model={model} />} />
      <main className="dm-page-content">
        <CardBands
          model={model}
          visible={visible}
          storageIds={storageIds}
          counts={counts}
          dq={dq}
          foldedSources={folded('sources')}
          foldedMarts={folded('marts')}
          onFoldSources={() => toggle('sources')}
          onFoldMarts={() => toggle('marts')}
          onRetryCount={(id) => void recount(id)}
          onRequestCount={request}
          onOpenApp={(id) => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id))}
        >
          <DataBand model={model} folded={folded('data')} onFold={() => toggle('data')} />
          <RowBand model={model} folded={folded('row')} onFold={() => toggle('row')} />
        </CardBands>
      </main>
    </div>
  );
}
