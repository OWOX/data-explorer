import { AlertTriangle, RefreshCw, Search, X } from 'lucide-react';
import type { Context } from '../../model/types';
import { useStore } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { DEFAULT_CONTEXT_ICON, PickedIcon } from '../bands/picked';
import { Tooltip } from '../Tooltip';

type Failed = { id: string; title: string; message: string };

export function Header({ contexts, error, onRetry, failedStorages = [] }: { contexts: Context[]; error?: unknown; onRetry?: () => void; failedStorages?: Failed[] }) {
  const [state, dispatch] = useStore();
  return (
    <header className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
      <div className="relative w-72">
        <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          aria-label="Search data marts"
          placeholder="Search title, context or field"
          value={state.search}
          onChange={(e) => dispatch({ type: 'search', q: e.target.value })}
          className="h-8 w-full rounded-md border bg-background pl-8 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        {state.search && (
          <button type="button" aria-label="Clear search" onClick={() => dispatch({ type: 'search', q: '' })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-3.5" /></button>
        )}
      </div>
      <div className="flex flex-1 flex-wrap gap-1" role="group" aria-label="Contexts">
        {contexts.map((c) => {
          const on = state.contextIds.includes(c.id);
          return (
            <button key={c.id} type="button" aria-pressed={on} onClick={() => dispatch({ type: 'toggleContext', id: c.id })}
              className={`inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-xs ${on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-accent'}`}>
              <PickedIcon icon={c.icon} fallback={DEFAULT_CONTEXT_ICON} size={12} />{c.name}
            </button>
          );
        })}
      </div>
      {failedStorages.length > 0 && (
        <div className="inline-flex items-center gap-1 text-xs text-destructive">
          <Tooltip content={<ul>{failedStorages.map((f) => <li key={f.id}>{f.title}: {f.message}</li>)}</ul>}>
            <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5" />{failedStorages.length} {failedStorages.length === 1 ? 'storage' : 'storages'} failed to load</span>
          </Tooltip>
          <button type="button" onClick={() => dispatch({ type: 'refreshModel' })} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
        </div>
      )}
      <button type="button" aria-label="Refresh model" onClick={() => dispatch({ type: 'refreshModel' })} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent">
        <RefreshCw className="size-4" />Refresh
      </button>
      {error != null && onRetry && <div className="w-full"><ErrorBox error={error} onRetry={onRetry} compact /></div>}
    </header>
  );
}
