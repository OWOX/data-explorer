// The Row band: the selected record. Stepping back through selections is Undo, in the page header.
import { Rows3 } from 'lucide-react';
import { useState } from 'react';
import type { Model } from '../../model/types';
import { isGrouped } from '../../model/aggregation';
import { recordTabId } from '../../records/relationships';
import { useStore } from '../../state/store';
import { RecordView } from '../explorer/RecordView';
import { Band } from './Band';
import { PickedIcon } from './picked';

export function RowBand({ model, folded, onFold, loading = null }: { model: Model; folded: boolean; onFold: () => void; loading?: number | null }) {
  const [{ selection, grids }] = useStore();
  const { record } = selection;
  // Like the Data band: a folded band mounts no new record, so nothing hidden is fetched.
  const held = folded || loading !== null;
  const [shownRecord, setShownRecord] = useState(held ? null : record);
  if (!held && shownRecord !== record) setShownRecord(record);
  const shown = held ? shownRecord : record;

  // A grid with a function or a bucket shows groups, which are no single record.
  const grouped = !!selection.martId && isGrouped({ aggregations: grids[selection.martId]?.aggregations ?? [], dateTrunc: grids[selection.martId]?.dateTrunc ?? [], uniqueCount: grids[selection.martId]?.uniqueCount });
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
      loading={loading}
    >
      {shown ? <RecordView key={recordTabId(shown.martId, shown.pk)} martId={shown.martId} pk={shown.pk} model={model} /> : <p className="dm-muted p-2 text-sm">{grouped ? 'Grouped rows have no single record.' : 'Select a row.'}</p>}
    </Band>
  );
}
