// The Data band: the selected mart's rows, in the grid the Explorer always had.
import { Table2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Model } from '../../model/types';
import { useStore, type GridState } from '../../state/store';
import { MartGrid } from '../explorer/MartGrid';
import { Band } from './Band';
import { PickedIcon } from './picked';

export function DataBand({ model, folded, onFold }: { model: Model; folded: boolean; onFold: () => void }) {
  const [{ selection, grids }, dispatch] = useStore();
  const { martId } = selection;
  const mart = martId ? model.marts.get(martId) : undefined;
  const [rows, setRows] = useState<{ id: string; label: string } | null>(null);
  const showRows = useCallback((label: string | null) => { if (martId) setRows(label === null ? null : { id: martId, label }); }, [martId]);
  const save = useCallback((grid: GridState) => { if (martId) dispatch({ type: 'saveGrid', martId, grid }); }, [dispatch, martId]);

  return (
    <Band id="band-data" icon={<PickedIcon icon={mart?.icon} fallback={Table2} size={18} />} title={mart?.title ?? 'Data'} total={mart && rows?.id === mart.id ? `${rows.label} rows` : undefined} hint="The rows of the selected data mart. Click a row to open it below." folded={folded} onFold={onFold} grid={false}>
      {!mart ? (
        <p className="dm-muted p-2 text-sm">Select a data mart.</p>
      ) : !mart.accessible ? (
        <p className="dm-muted p-2 text-sm">You do not have access to this data mart</p>
      ) : (
        <MartGrid key={mart.id} martId={mart.id} model={model} seed={{ filters: selection.filters, saved: grids[mart.id] }} onChange={save} onRows={showRows} />
      )}
    </Band>
  );
}
