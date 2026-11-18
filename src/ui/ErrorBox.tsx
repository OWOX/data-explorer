import { Tooltip } from './Tooltip';

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  // The host bridge may reject with a plain object ({ message } or { error }) rather than an Error.
  if (e && typeof e === 'object') {
    const o = e as { message?: unknown; error?: unknown };
    if (typeof o.message === 'string' && o.message) return o.message;
    if (typeof o.error === 'string' && o.error) return o.error;
    try { return JSON.stringify(e); } catch { return String(e); }
  }
  return String(e);
}

export function ErrorBox({ error, onRetry, compact = false }: { error: unknown; onRetry: () => void; compact?: boolean }) {
  return (
    <div role="alert" className={`flex items-center gap-2 text-destructive ${compact ? 'text-xs' : 'rounded-md border border-destructive/40 p-3 text-sm'}`}>
      <Tooltip content={errorMessage(error)}><span className="min-w-0 flex-1 truncate">{errorMessage(error)}</span></Tooltip>
      <button type="button" onClick={onRetry} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
    </div>
  );
}
