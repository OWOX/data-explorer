import { Copy } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { Skeleton } from '../ui/Skeleton';
import { Toast } from '../ui/Toast';
import { Hint } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { copyChart } from './copyImage';

/** Follows the height of its content, so the frame can animate to it (the content's own height is not a length a transition can run between). Null until measured, and where nothing can be observed. */
function useMeasuredHeight() {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  // The frame clips only while its height moves, so content taller than the shrinking frame does not spill over what is below.
  const [moving, setMoving] = useState(false);
  useEffect(() => {
    const el = inner.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver(() => {
      setHeight(el.offsetHeight);
      setMoving(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMoving(false), 250);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);
  return { inner, height, moving };
}

/** One chart's frame: title, extra buttons, its ⋮ menu (null before the saved settings load) and the width its content needs. */
export function ChartPanel({ title, name, items, extra, width, loading, error, onRetry, empty, note, children }: {
  title: string; name: string; items: MenuItem[] | null; extra?: ReactNode; width: string;
  loading: boolean; error: unknown; onRetry: () => void; empty?: string | null; note?: string; children: ReactNode;
}) {
  const { inner, height, moving } = useMeasuredHeight();
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'info' | 'error'; at: number } | null>(null);
  const say = (text: string, tone: 'success' | 'info' | 'error') => setToast((t) => ({ text, tone, at: (t?.at ?? 0) + 1 }));
  const copy: MenuItem = { kind: 'action', label: 'Copy to clipboard', icon: Copy, onPick: () => {
    if (!section || loading || error || empty) { say('Nothing to copy yet', 'info'); return; }
    copyChart(section, title).then(
      (how) => how === 'copied' ? say('Chart copied', 'success')
        : how === 'downloaded' ? say('Clipboard is blocked here, the chart was downloaded as PNG', 'info')
        : say('Nothing to copy yet', 'info'),
      () => say("The chart couldn't be copied", 'error'),
    );
  } };
  const at = items ? items.findLastIndex((i) => i.kind === 'action' && i.label === 'Hide') : -1;
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
      <div className="dm-chart-body" data-moving={moving || undefined} style={height === null ? undefined : { height }}>
        <div ref={inner} className="dm-chart-fit">
          {error ? <ErrorBox error={error} onRetry={onRetry} />
            : loading ? <Skeleton rows={4} />
            : empty ? <p className="dm-muted dm-chart-empty">{empty}</p>
            : children}
        </div>
      </div>
      {toast && <Toast tone={toast.tone} stamp={toast.at} onDismiss={() => setToast(null)}>{toast.text}</Toast>}
    </section>
  );
}
