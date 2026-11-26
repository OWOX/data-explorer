import { Copy } from 'lucide-react';
import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ErrorBox } from '../ui/ErrorBox';
import { emptyText } from '../ui/format';
import { Skeleton } from '../ui/Skeleton';
import { Toast } from '../ui/Toast';
import { Hint } from '../ui/Tooltip';
import { ChartMenu, type MenuItem } from './ChartMenu';
import { copyChart } from './copyImage';
import { CELL, ChartFrameContext, FillContext, panelWidth, type ChartSize } from './resize';
import { ResizeHandles } from './ResizeHandles';

/** A body height that makes the whole panel a whole number of cells: the content's height, rounded up. The panel's head and padding count. */
function snapped(inner: HTMLElement): number {
  const body = inner.parentElement;
  const panel = inner.closest<HTMLElement>('section');
  if (!body || !panel) return inner.offsetHeight;
  const chrome = panel.offsetHeight - body.offsetHeight;
  return Math.ceil((inner.offsetHeight + chrome) / CELL) * CELL - chrome;
}

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
      setHeight(snapped(el));
      setMoving(true);
      clearTimeout(timer);
      timer = setTimeout(() => setMoving(false), 250);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, []);
  return { inner, height, moving };
}

/** One chart's frame: title, its ⋮ menu (none before the saved settings load, so `ready` gates `items`) and the width its content needs, on whole cells. A size the member dragged it to wins. */
export function ChartPanel({ title, name, items, ready, width, loading, failed, empty, hasFilters, note, children }: {
  title: string; name: string; items: MenuItem[]; ready: boolean; width: string;
  loading: boolean; failed?: { error: unknown; retry: () => void } | null;
  /** True shows the standard empty text for `hasFilters`; a string shows that text. */
  empty?: boolean | string; hasFilters: boolean; note?: string; children: ReactNode;
}) {
  const menu = ready ? items : null;
  const error = failed?.error;
  const emptyNote = empty === true ? emptyText(hasFilters) : empty || null;
  const { inner, height, moving } = useMeasuredHeight();
  const frame = useContext(ChartFrameContext);
  // The size under the pointer while a handle is dragged; it is saved on release.
  const [draft, setDraft] = useState<ChartSize | null>(null);
  const size = draft ?? frame?.size ?? {};
  const fill = size.rows !== undefined;
  const [section, setSection] = useState<HTMLElement | null>(null);
  const [toast, setToast] = useState<{ text: string; tone: 'success' | 'info' | 'error'; at: number } | null>(null);
  const say = (text: string, tone: 'success' | 'info' | 'error') => setToast((t) => ({ text, tone, at: (t?.at ?? 0) + 1 }));
  const copy: MenuItem = { kind: 'action', label: 'Copy to clipboard', icon: Copy, onPick: () => {
    if (!section || loading || error || emptyNote) { say('Nothing to copy yet', 'info'); return; }
    copyChart(section, title).then(
      (how) => how === 'copied' ? say('Chart copied', 'success')
        : how === 'downloaded' ? say('Clipboard is blocked here, the chart was downloaded as PNG', 'info')
        : say('Nothing to copy yet', 'info'),
      () => say("The chart couldn't be copied", 'error'),
    );
  } };
  const at = menu ? menu.findLastIndex((i) => i.kind === 'action' && i.label === 'Hide') : -1;
  const withCopy = menu ? (at >= 0 ? [...menu.slice(0, at), copy, ...menu.slice(at)] : [...menu, copy]) : null;
  return (
    <section ref={setSection} className="dm-chart" data-chart-kind={name} data-fill={fill || undefined} data-dragging={!!draft || undefined} style={{ width: frame ? panelWidth(size, width) : width, ...(fill ? { height: size.rows! * CELL } : {}) }}>
      <header className="dm-chart-head">
        <div className="dm-chart-titlegroup">
          <h3 className="dm-chart-title">{title}</h3>
          {note && <Hint text={note} label={`About ${title}`} />}
        </div>
        {menu && <div className="dm-chart-actions"><ChartMenu name={name} items={withCopy ?? menu} /></div>}
      </header>
      <div className="dm-chart-body" data-moving={moving || undefined} style={height === null || fill ? undefined : { height }}>
        <div ref={inner} className="dm-chart-fit">
          {failed ? <ErrorBox error={error} onRetry={failed.retry} />
            : loading ? <Skeleton rows={4} />
            : emptyNote ? <p className="dm-muted dm-chart-empty">{emptyNote}</p>
            : <FillContext value={fill}>{children}</FillContext>}
        </div>
      </div>
      {frame?.resizing && section && <ResizeHandles title={title} section={section} frame={frame} onDraft={setDraft} />}
      {toast && <Toast tone={toast.tone} stamp={toast.at} onDismiss={() => setToast(null)}>{toast.text}</Toast>}
    </section>
  );
}
