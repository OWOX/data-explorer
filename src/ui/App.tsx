import { useMemo } from 'react';
import { martAppUrl } from '../config';
import { computeVisible } from '../graph/visible';
import { useServices, useStore } from '../state/store';
import { Canvas } from './canvas/Canvas';
import { CARD_SIZE, type CardData } from './canvas/MartCard';
import { ErrorBox } from './ErrorBox';
import { Header } from './header/Header';
import { Skeleton } from './Skeleton';
import { useCardStatus, useModel } from './useModelData';

export function App() {
  const [state, dispatch] = useStore();
  const { ctx, schemas } = useServices();
  const { model, error, reload, schemaTick } = useModel();
  const visible = useMemo(
    () => (model ? computeVisible({ model, selectedId: state.selectedId, search: state.search, contextIds: state.contextIds, schemas: (id) => schemas.peek(id) }) : null),
    // schemaTick re-runs the search as schemas arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [model, state.selectedId, state.search, state.contextIds, schemas, schemaTick],
  );
  const { dq, counts, recount } = useCardStatus(model, visible?.ids ?? [], state.modelVersion);
  const exploring = state.tabs.length > 0;

  if (error) return <div className="p-6"><ErrorBox error={error} onRetry={reload} /></div>;
  if (!model || !visible) return <Skeleton rows={6} />;

  const cards = new Map<string, CardData>(visible.ids.map((id) => [id, {
    mart: model.marts.get(id)!,
    contexts: model.contexts,
    count: counts.get(id) ?? { state: 'loading' },
    dq: dq.get(id),
    fieldHit: visible.fieldHits.get(id),
    selected: state.selectedId === id,
    onOpenApp: () => void ctx.ui.openExternal(martAppUrl(ctx.projectId, id)),
    onRetryCount: () => recount(id),
  }]));

  return (
    <div className="flex h-full flex-col">
      <Header contexts={model.contexts} />
      <div className="flex min-h-0 flex-1">
        <div className="relative min-h-0 border-r" style={exploring ? { width: CARD_SIZE.width + 48, flex: 'none' } : { flex: 1 }}>
          {visible.mode === 'empty' ? (
            <p className="p-6 text-sm text-muted-foreground">No data marts match.</p>
          ) : (
            <Canvas
              ids={visible.ids}
              edges={model.edges}
              cards={cards}
              direction={exploring ? 'TB' : 'LR'}
              onSelect={(id) => (model.marts.get(id)?.accessible ? dispatch({ type: 'openMart', martId: id }) : dispatch({ type: 'select', id }))}
              onClear={() => { if (!exploring) dispatch({ type: 'select', id: null }); }}
            />
          )}
          {visible.hiddenMatches > 0 && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border bg-background px-3 py-1 text-xs shadow-sm">+{visible.hiddenMatches} more. Refine the search to see them.</div>
          )}
        </div>
        {exploring && <div data-testid="explorer" className="min-w-0 flex-1" />}
      </div>
    </div>
  );
}
