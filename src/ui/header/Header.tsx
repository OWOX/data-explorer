// The page header, as Data Flow draws it: the page title alone on the left, Undo, Redo and the copy-link button on the right. There is no Refresh: the model loads when the plugin opens.
import { AlertTriangle, Link, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useStore } from '../../state/store';
import { ErrorBox } from '../ErrorBox';
import { Tooltip } from '../Tooltip';

type Failed = { id: string; title: string; message: string };

type HeaderProps = {
  error?: unknown;
  onRetry?: () => void;
  failedStorages?: Failed[];
  /** Undo and Redo, drawn in the actions, before the copy-link button. */
  history?: ReactNode;
  /** Copies a link to the current view; no button without it (a host with no page links). */
  onCopyLink?: () => void;
  /** One line under the header: what a link skipped, or why one could not be copied. */
  notice?: string | null;
  onDismissNotice?: () => void;
};

export function Header({ error, onRetry, failedStorages = [], history, onCopyLink, notice, onDismissNotice }: HeaderProps) {
  const [, dispatch] = useStore();
  return (
    <header className="dm-page-header">
      <div className="dm-page-header-lead">
        <h1 className="dm-page-header-title">Data Explorer</h1>
      </div>
      <div className="dm-page-header-actions">
        {failedStorages.length > 0 && (
          <div className="mr-3 inline-flex items-center gap-1 text-xs text-destructive">
            <Tooltip content={<ul>{failedStorages.map((f) => <li key={f.id}>{f.title}: {f.message}</li>)}</ul>}>
              <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5" />{failedStorages.length} {failedStorages.length === 1 ? 'storage' : 'storages'} failed to load</span>
            </Tooltip>
            <button type="button" onClick={() => dispatch({ type: 'refreshModel' })} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
          </div>
        )}
        {history}
        {onCopyLink && (
          <Tooltip content="Copy link to this view">
            <button type="button" aria-label="Copy link to this view" onClick={onCopyLink} className="inline-flex size-8 items-center justify-center rounded-md border hover:bg-accent"><Link className="size-4" /></button>
          </Tooltip>
        )}
      </div>
      {notice && (
        <div role="status" className="flex w-full items-center justify-between gap-2 rounded-md border bg-muted px-3 py-1.5 text-sm">
          <span>{notice}</span>
          <button type="button" aria-label="Dismiss" onClick={onDismissNotice} className="inline-flex size-6 items-center justify-center rounded hover:bg-accent"><X className="size-4" /></button>
        </div>
      )}
      {error != null && onRetry && <div className="w-full"><ErrorBox error={error} onRetry={onRetry} compact /></div>}
    </header>
  );
}
