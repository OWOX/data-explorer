import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Tooltip } from './Tooltip';
import { copyText } from './explorer/clipboard';
import { buildErrorReport, errorMessage, type ErrorContext } from './errorDetails';

export { errorMessage };
export type { ErrorContext };

export function ErrorBox({ error, onRetry, compact = false, context }: { error: unknown; onRetry: () => void; compact?: boolean; /** The request behind the error, added to the copied details. */ context?: ErrorContext }) {
  const [copied, setCopied] = useState<'ok' | 'failed' | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const copy = async () => {
    const ok = await copyText(buildErrorReport(error, context));
    setCopied(ok ? 'ok' : 'failed');
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  };
  const message = errorMessage(error);
  return (
    <div role="alert" className={`flex items-center gap-2 text-destructive ${compact ? 'text-xs' : 'rounded-md border border-destructive/40 p-3 text-sm'}`}>
      <Tooltip content={message}><span className="min-w-0 flex-1 truncate">{message}</span></Tooltip>
      <Tooltip content="Copy error details">
        <button type="button" aria-label="Copy error details" onClick={() => { void copy(); }} className="inline-flex items-center gap-1 rounded p-0.5 text-foreground hover:bg-accent">
          {copied === 'ok' ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          {copied && <span className="text-xs">{copied === 'ok' ? 'Copied' : 'Copy failed'}</span>}
        </button>
      </Tooltip>
      <button type="button" onClick={onRetry} className="rounded border px-2 py-0.5 text-foreground hover:bg-accent">Retry</button>
    </div>
  );
}
