import { useState, type ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { Toast } from '../ui/Toast';
import { Hint } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { copyChart } from './copyImage';

/** One chart's frame: title, extra buttons, its ⋮ menu (null before the saved settings load) and the width its content needs. */
export function ChartPanel({ title, name, items, extra, width, loading, error, onRetry, empty, note, children }: {
  title: string; name: string; items: MenuItem[] | null; extra?: ReactNode; width: string;
  loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode;
}) {
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'info' | 'error'; at: number } | null>(null);
  const say = (text: string, tone: 'success' | 'info' | 'error') => setToast((t) => ({ text, tone, at: (t?.at ?? 0) + 1 }));
  const copy: MenuItem = { kind: 'action', label: 'Copy to clipboard', onPick: () => {
    if (!section || loading || error || empty) { say('Nothing to copy yet', 'info'); return; }
    copyChart(section, title).then(
      (how) => how === 'copied' ? say('Chart copied', 'success')
        : how === 'downloaded' ? say('Clipboard is blocked here, the chart was downloaded as PNG', 'info')
        : say('Nothing to copy yet', 'info'),
      () => say("The chart couldn't be copied", 'error'),
    );
  } };
  const at = items ? items.findLastIndex((i) => i.kind === 'action' && i.label === 'Remove') : -1;
  const withCopy = items ? (at >= 0 ? [...items.slice(0, at), copy, ...items.slice(at)] : [...items, copy]) : null;
  return (
    <section ref={setSection} className="dm-chart" data-chart-kind={name} style={{ width }}>
      <header className="dm-chart-head">
        <div className="dm-chart-titlegroup">
          <h3 className="dm-chart-title">{title}</h3>
          {note && <Hint text={note} label={`About ${title}`} />}
        </div>
        {items && <div className="dm-chart-actions">{extra}<ChartMenu name={name} items={withCopy ?? items} /></div>}
      </header>
      {error ? <ErrorBox error={error} onRetry={onRetry} />
        : loading ? <Skeleton rows={4} />
        : empty ? <p className="dm-muted dm-chart-empty">{empty}</p>
        : children}
      {toast && <Toast tone={toast.tone} stamp={toast.at} onDismiss={() => setToast(null)}>{toast.text}</Toast>}
    </section>
  );
}
