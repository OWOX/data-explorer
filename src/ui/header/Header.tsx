// The page header, as Data Flow draws it: the page title on the left, Undo and Redo after it. There is no Refresh: the model loads when the plugin opens.
import { AlertTriangle } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Tooltip } from '../Tooltip';

type Failed = { id: string; title: string; message: string };

export function Header({ error, onRetry, failedStorages = [], history }: { error?: unknown; onRetry?: () => void; failedStorages?: Failed[]; /** Undo and Redo, drawn right after the title. */ history?: ReactNode }) {
  const [, dispatch] = useStore();
  return (
    <header className="dm-page-header">
      <div className="dm-page-header-lead">
        <h1 className="dm-page-header-title">Data Explorer</h1>
        {history}
      </div>
      <div className="dm-page-header-actions">
        {failedStorages.length > 0 && (
          <div className="inline-flex items-center gap-1 text-xs text-destructive">
            <Tooltip content={<ul>{failedStorages.map((f) => <li key={f.id}>{f.title}: {f.message}</li>)}</ul>}>
              <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5" />{failedStorages.length} {failedStorages.length === 1 ? 'storage' : 'storages'} failed to load</span>
            </Tooltip>
            <button type="button" onClick={() => dispatch({ type: 'refreshModel' })} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
          </div>
        )}
      </div>
      {error != null && onRetry && <div className="w-full"><ErrorBox error={error} onRetry={onRetry} compact /></div>}
    </header>
  );
}
