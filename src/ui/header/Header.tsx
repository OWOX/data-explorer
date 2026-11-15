import { RefreshCw, Search, X } from 'lucide-react';
import type { Context } from '../../model/types';
import { useStore } from '../../state/store';
import { ContextIcon } from '../icons';

export function Header({ contexts }: { contexts: Context[] }) {
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
              <ContextIcon icon={c.icon} />{c.name}
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Refresh model" onClick={() => dispatch({ type: 'refreshModel' })} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent">
        <RefreshCw className="size-4" />Refresh
      </button>
    </header>
  );
}
