import { useEffect, useRef, useState, type RefObject } from 'react';
import { PointerTip } from '../Tooltip';

/**
 * The tip over a line of `canvas`. It keeps its own state, so a pointer move re-renders this layer and not every card in the bands.
 * A plain tip follows the pointer. One with a description stays where it opened, and stays open a moment after the pointer leaves the line,
 * so the pointer can reach its "More" link.
 */
export function WireTipLayer({ canvas }: { canvas: RefObject<HTMLElement | null> }) {
  const [tip, setTip] = useState<{ line: string; text: string; more?: string; x: number; y: number } | null>(null);
  // The tip as the handlers last set it: they run outside render, so they read it here and not from a stale closure.
  const tipRef = useRef(tip);
  const put = (next: typeof tip) => { tipRef.current = next; setTip(next); };
  const hideTimer = useRef<number | undefined>(undefined);
  const keep = () => { window.clearTimeout(hideTimer.current); hideTimer.current = undefined; };
  const hideSoon = () => { if (hideTimer.current === undefined) hideTimer.current = window.setTimeout(() => { hideTimer.current = undefined; put(null); }, 300); };
  useEffect(() => {
    const root = canvas.current;
    if (!root) return;
    const off = () => { if (tipRef.current?.more) hideSoon(); else { keep(); if (tipRef.current) put(null); } };
    // One listener on the document: the bubble is drawn on the body, outside the canvas, and the pointer on it keeps it open.
    const move = (e: PointerEvent) => {
      const at = e.target instanceof Element ? e.target : null;
      if (at?.closest('.dm-tip-interactive')) { keep(); return; }
      // A pressed pointer is dragging a card: a bubble in its way would take the drop.
      if (e.buttons) { keep(); if (tipRef.current) put(null); return; }
      const el = at && root.contains(at) ? at.closest<SVGElement>('#wires :is(path, circle), #tree-wires :is(path, circle)') : null;
      const text = el?.dataset.tip;
      if (!el || !text) { off(); return; }
      keep();
      // A line is its two cards, not its element: the path and its dot are one line, and a redrawn path is the same line.
      const line = el.dataset.line ?? text;
      const cur = tipRef.current;
      if (cur?.line === line && cur.more) return;
      const more = el.dataset.more;
      put({ line, text, ...(more ? { more } : {}), x: e.clientX, y: e.clientY });
    };
    document.addEventListener('pointermove', move);
    root.addEventListener('pointerleave', off);
    document.documentElement.addEventListener('pointerleave', off);
    return () => { document.removeEventListener('pointermove', move); root.removeEventListener('pointerleave', off); document.documentElement.removeEventListener('pointerleave', off); keep(); };
  // `put`, `keep` and `hideSoon` touch only refs and the state setter: the listeners need not be swapped when they are made again.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);
  return tip && <PointerTip key={tip.line} text={tip.text} more={tip.more} x={tip.x} y={tip.y} />;
}
