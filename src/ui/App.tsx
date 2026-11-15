import { useEffect, useMemo, useState } from 'react';
import { martAppUrl } from '../config';
import { computeVisible } from '../graph/visible';
import { sourceOfModel, useServices, useStore } from '../state/store';
import { CardBands } from './bands/CardBands';
import { DataBand } from './bands/DataBand';
import { RowBand } from './bands/RowBand';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { Skeleton } from './Skeleton';
import { TooltipProvider } from './Tooltip';
import { useCardStatus, useModel } from './useModelData';

export function App() {
  return <TooltipProvider><AppBody /></TooltipProvider>;
}

type Fold = 'sources' | 'marts' | 'data' | 'row';

function AppBody() {
  const [state, dispatch] = useStore();
  const { ctx, schemas } = useServices();
  const { model, error, reload, schemaTick } = useModel();
  // Folding is per band and lives here. A band the reader has not touched follows its default:
  // Data Sources is folded while there is nothing in it.
  const [folds, setFolds] = useState<Partial<Record<Fold, boolean>>>({});
  const toggle = (band: Fold, current: boolean) => setFolds((f) => ({ ...f, [band]: !current }));
  // schemaTick re-runs a search as schemas arrive. With no search it must not: the cards would be recomputed for nothing.
  const searching = state.search.trim() !== '';
  const tick = searching ? schemaTick : 0;
  const visible = useMemo(
    () => (model ? computeVisible({ model, selection: state.selection, search: state.search, contextIds: state.contextIds, schemas: (id) => schemas.peek(id) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, state.selection, state.search, state.contextIds, schemas, tick],
  );
  const { dq, counts, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);

  // There is always a selected mart after load: the first load picks the focus mart, and a mart a
  // refresh took away is replaced by it. A selected source with no mart is a choice, not a gap.
  const focusId = visible?.focusId ?? null;
  const { martId, sourceKey } = state.selection;
  useEffect(() => {
    if (!model || !focusId) return;
    if (!martId && !sourceKey) dispatch({ type: 'init', focusId });
    else if (martId && !model.marts.has(martId)) dispatch({ type: 'selectMart', id: focusId, sourceOf: sourceOfModel(model) });
  }, [model, focusId, martId, sourceKey, dispatch]);

  // A failed refresh keeps the loaded model on screen; the error shows in the header.
  if (error && !model) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) return <Skeleton rows={6} />;

  return (
    <div className="flex h-full flex-col">
      <Header contexts={model.contexts} failedStorages={model.failedStorages} error={error} onRetry={reload} />
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <CardBands
          model={model}
          visible={visible}
          counts={counts}
          dq={dq}
          foldedSources={folds.sources ?? model.sources.length === 0}
          foldedMarts={folds.marts ?? false}
          onFoldSources={() => toggle('sources', folds.sources ?? model.sources.length === 0)}
          onFoldMarts={() => toggle('marts', folds.marts ?? false)}
          onRetryCount={(id) => void recount(id)}
          onOpenApp={(id) => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id))}
        >
          <DataBand model={model} folded={folds.data ?? false} onFold={() => toggle('data', folds.data ?? false)} />
          <RowBand model={model} folded={folds.row ?? false} onFold={() => toggle('row', folds.row ?? false)} />
        </CardBands>
      </div>
    </div>
  );
}
