// The Row band: the selected record, and the Back button that steps through the selections before it.
import { ArrowLeft, Rows3 } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Model } from '../../model/types';
import { recordTabId } from '../../records/relationships';
import { useStore } from '../../state/store';
import { RecordView } from '../explorer/RecordView';
import { Band } from './Band';
import { Tooltip } from '../Tooltip';
import { PickedIcon } from './picked';

export function RowBand({ model, folded, onFold }: { model: Model; folded: boolean; onFold: () => void }) {
  const [{ selection, history }, dispatch] = useStore();
  const { record } = selection;
  // Like the Data band: a folded band mounts no new record, so nothing hidden is fetched.
  const [shownRecord, setShownRecord] = useState(record);
  if (!folded && shownRecord !== record) setShownRecord(record);
  const shown = folded ? shownRecord : record;
  const canGoBack = history.length > 0;
  const back = () => dispatch({ type: 'back', known: (sel) => (!sel.martId || model.marts.has(sel.martId)) && (!sel.sourceKey || model.sources.some((x) => x.key === sel.sourceKey)) });

  useEffect(() => {
    if (!canGoBack) return;
    const onKey = (e: KeyboardEvent) => {
      // Alt+Left is the word-jump while typing in a field: leave it to the field.
      if (e.target instanceof Element && e.target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return;
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
      icon={<PickedIcon icon={record ? mart?.icon : null} fallback={Rows3} size={18} />}
      title={title}
      hint="One row of the selected data mart. Related titles open the mart they point at."
      folded={folded}
      onFold={onFold}
      grid={false}
      toolbar={
        <Tooltip content="Back (Alt+Left)">
          <button type="button" disabled={!canGoBack} onClick={back} className="inline-flex h-8 items-center gap-1 rounded-md border px-2.5 text-sm hover:bg-accent disabled:opacity-50">
            <ArrowLeft className="size-4" />Back
          </button>
        </Tooltip>
      }
    >
      {shown ? <RecordView key={recordTabId(shown.martId, shown.pk)} martId={shown.martId} pk={shown.pk} model={model} /> : <p className="dm-muted p-2 text-sm">Select a row.</p>}
    </Band>
  );
}
