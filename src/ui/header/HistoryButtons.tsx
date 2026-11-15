// Undo and Redo for the selection, right after the page title. Undo is what Back was: it returns to the previous
// selection (source, mart, filters, record); Redo re-applies the one undone last.
import { Redo2, Undo2 } from 'lucide-react';
import { useEffect } from 'react';
import type { Model } from '../../model/types';
import { useStore } from '../../state/store';
import { Tooltip } from '../Tooltip';

export function HistoryButtons({ model }: { model: Model }) {
  const [{ history, future }, dispatch] = useStore();
  const canUndo = history.length > 0;
  const canRedo = future.length > 0;
  const known = (sel: { martId: string | null; sourceKey: string | null }) =>
    (!sel.martId || model.marts.has(sel.martId)) && (!sel.sourceKey || model.sources.some((x) => x.key === sel.sourceKey));
  const undo = () => dispatch({ type: 'undo', known });
  const redo = () => dispatch({ type: 'redo', known });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Alt+Arrow and Ctrl/Cmd+Z are the word-jump and the text undo while typing in a field: leave them to the field.
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      let act: 'undo' | 'redo' | null = null;
      if (e.altKey && !mod && e.key === 'ArrowLeft') act = 'undo';
      else if (e.altKey && !mod && e.key === 'ArrowRight') act = 'redo';
      else if (mod && !e.altKey && key === 'z') act = e.shiftKey ? 'redo' : 'undo';
      if (!act) return;
      if (act === 'undo' ? !canUndo : !canRedo) return;
      e.preventDefault();
      (act === 'undo' ? undo : redo)();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canUndo, canRedo, dispatch, model]);

  const button = 'inline-flex size-8 items-center justify-center rounded-md border hover:bg-accent disabled:opacity-50 disabled:hover:bg-transparent';
  return (
    <div className="dm-page-history" role="group" aria-label="History">
      <Tooltip content="Undo (Alt+Left)">
        <button type="button" aria-label="Undo" disabled={!canUndo} onClick={undo} className={button}><Undo2 className="size-4" /></button>
      </Tooltip>
      <Tooltip content="Redo (Alt+Right)">
        <button type="button" aria-label="Redo" disabled={!canRedo} onClick={redo} className={button}><Redo2 className="size-4" /></button>
      </Tooltip>
    </div>
  );
}
