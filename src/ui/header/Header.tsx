// The page header, as Data Flow draws it: the page title on the left, the page's own Refresh at the right end.
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useStore } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Tooltip } from '../Tooltip';

type Failed = { id: string; title: string; message: string };

export function Header({ error, onRetry, failedStorages = [] }: { error?: unknown; onRetry?: () => void; failedStorages?: Failed[] }) {
  const [, dispatch] = useStore();
  return (
    <header className="dm-page-header">
      <h1 className="dm-page-header-title">Data Explorer</h1>
      <div className="dm-page-header-actions">
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
      </div>
      {error != null && onRetry && <div className="w-full"><ErrorBox error={error} onRetry={onRetry} compact /></div>}
    </header>
  );
}
