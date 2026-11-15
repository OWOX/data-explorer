import { X } from 'lucide-react';
import type { Model } from '../../model/types';
import { useStore } from '../../state/store';
import { MartIcon } from '../icons';

export function TabBar({ model }: { model: Model }) {
  const [state, dispatch] = useStore();
  return (
    <div role="tablist" className="flex overflow-x-auto border-b bg-muted/40">
      {state.tabs.map((t) => {
        const mart = model.marts.get(t.martId);
        const label = t.kind === 'mart' ? mart?.title ?? t.martId : `${mart?.title ?? t.martId}: ${Object.values(t.pk).map(String).join(', ')}`;
        const active = t.id === state.activeTabId;
        return (
          <div key={t.id} role="tab" aria-selected={active} onClick={() => dispatch({ type: 'activate', tabId: t.id })}
            className={`group relative flex max-w-56 shrink-0 cursor-pointer items-center gap-1.5 border-r py-2 pl-3 pr-7 text-sm ${active ? 'bg-background font-medium' : 'text-muted-foreground hover:bg-background/60'}`}>
            <MartIcon icon={mart?.icon ?? null} className="size-3.5 shrink-0" />
            <span className="truncate">{label}</span>
            <button type="button" aria-label={`Close ${label}`} onClick={(e) => { e.stopPropagation(); dispatch({ type: 'close', tabId: t.id }); }}
              className="absolute right-1.5 top-1.5 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"><X className="size-3.5" /></button>
          </div>
        );
      })}
    </div>
  );
}
