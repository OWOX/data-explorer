// The Row band: the selected record, and the Back button that steps through the selections before it.
import { ArrowLeft, Rows3 } from 'lucide-react';
import { useEffect } from 'react';
import type { Model } from '../../model/types';
import { recordTabId } from '../../records/relationships';
import { useStore } from '../../state/store';
import { RecordView } from '../explorer/RecordView';
import { resolveIcon } from '../icons';
import { Band } from './Band';

export function RowBand({ model, folded, onFold }: { model: Model; folded: boolean; onFold: () => void }) {
  const [{ selection, history }, dispatch] = useStore();
  const { record } = selection;
  const canGoBack = history.length > 0;
  const back = () => dispatch({ type: 'back', known: (sel) => (!sel.martId || model.marts.has(sel.martId)) && (!sel.sourceKey || model.sources.some((x) => x.key === sel.sourceKey)) });

  useEffect(() => {
    if (!canGoBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key === 'ArrowLeft') {
        e.preventDefault();
        back();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canGoBack, dispatch, model]);

  const mart = record ? model.marts.get(record.martId) : undefined;
  const title = record ? `${mart?.title ?? record.martId} · ${Object.values(record.pk).map(String).join(', ')}` : 'Row';

  return (
    <Band
      id="band-row"
      icon={record ? resolveIcon(mart?.icon ?? null, Rows3) : Rows3}
      title={title}
      hint="One row of the selected data mart. Related titles open the mart they point at."
      folded={folded}
      onFold={onFold}
      grid={false}
      toolbar={
        <button type="button" disabled={!canGoBack} onClick={back} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50" title="Back (Alt+Left)">
          <ArrowLeft className="size-4" />Back
        </button>
      }
    >
      {record ? <RecordView key={recordTabId(record.martId, record.pk)} martId={record.martId} pk={record.pk} model={model} /> : <p className="dm-muted p-2 text-sm">Select a row.</p>}
    </Band>
  );
}
