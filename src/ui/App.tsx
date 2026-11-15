import { useMemo } from 'react';
import { martAppUrl } from '../config';
import { computeVisible } from '../graph/visible';
import { useServices, useStore } from '../state/store';
import { ARC_ROOM, Canvas } from './canvas/Canvas';
import { CARD_SIZE, type CardData } from './canvas/MartCard';
import { ErrorBox } from './ErrorBox';
import { Explorer } from './explorer/Explorer';
import { Header } from './header/Header';
import { Skeleton } from './Skeleton';
import { TooltipProvider } from './Tooltip';
import { useCardStatus, useModel } from './useModelData';

export function App() {
  return <TooltipProvider><AppBody /></TooltipProvider>;
}

function AppBody() {
  const [state, dispatch] = useStore();
  const { ctx, schemas } = useServices();
  const { model, error, reload, schemaTick } = useModel();
  // schemaTick re-runs a search as schemas arrive. With no search it must not: each prefetched
  // schema would otherwise refit the canvas and undo the user's pan and zoom.
  const searching = state.search.trim() !== '';
  const tick = searching ? schemaTick : 0;
  const visible = useMemo(
    () => (model ? computeVisible({ model, selectedId: state.selectedId, search: state.search, contextIds: state.contextIds, schemas: (id) => schemas.peek(id) }) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, state.selectedId, state.search, state.contextIds, schemas, tick],
  );
  const { dq, counts, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);
  const exploring = state.tabs.length > 0;

  // A failed refresh keeps the loaded model on screen; the error shows in the header.
  if (error && !model) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) return <Skeleton rows={6} />;

  const cards = new Map<string, CardData>(visible.ids.map((id) => [id, {
    mart: model.marts.get(id)!,
    count: counts.get(id) ?? { state: 'loading' },
    dq: dq.get(id),
    fieldHit: visible.fieldHits.get(id),
    selected: state.selectedId === id,
    onOpenApp: () => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id)),
    onRetryCount: () => recount(id),
  }]));

  return (
    <div className="flex h-full flex-col">
      <Header contexts={model.contexts} failedStorages={model.failedStorages} error={error} onRetry={reload} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 border-r" style={exploring ? { width: CARD_SIZE.width + ARC_ROOM + 40, flex: 'none' } : { flex: 1 }}>
          {visible.mode === 'empty' ? (
            <p className="p-6 text-sm text-muted-foreground">No data marts match.</p>
          ) : (
            <Canvas
              ids={visible.ids}
              edges={model.edges}
              cards={cards}
              direction={exploring ? 'TB' : 'LR'}
              selectedId={state.selectedId}
              onSelect={(id) => (model.marts.get(id)?.accessible ? dispatch({ type: 'openMart', martId: id }) : dispatch({ type: 'select', id }))}
              onClear={() => { if (!exploring) dispatch({ type: 'select', id: null }); }}
            />
          )}
          {visible.hiddenMatches > 0 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs shadow-sm">{visible.mode === 'levels' ? `+${visible.hiddenMatches} more connected data marts` : `+${visible.hiddenMatches} more. Refine the search to see them.`}</div>
          )}
        </div>
        {exploring && <div data-testid="explorer" className="min-w-0 flex-1"><Explorer model={model} /></div>}
      </div>
    </div>
  );
}
