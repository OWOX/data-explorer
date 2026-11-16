// The Data band: the selected mart's rows, in the grid the Explorer always had.
import { Table2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Model } from '../../model/types';
import { useStore, type GridState } from '../../state/store';
import { recordsLabel } from '../format';
import { MartGrid } from '../explorer/MartGrid';
import { Band } from './Band';
import { PickedIcon } from './picked';

export function DataBand({ model, folded, onFold, loading = null }: { model: Model; folded: boolean; onFold: () => void; loading?: number | null }) {
  const [{ selection, grids }, dispatch] = useStore();
  const { martId } = selection;
  const mart = martId ? model.marts.get(martId) : undefined;
  // The grid follows the selection only while the band is open: a folded band mounts nothing new, so no hidden query is billed.
  // A band that first appears folded mounts nothing, so no hidden query is billed.
  // The same while the load bar shows: nothing is read until the page has finished reading.
  const held = folded || loading !== null;
  const [shownId, setShownId] = useState(held ? null : martId);
  if (!held && shownId !== martId) setShownId(martId);
  const gridId = held ? shownId : martId;
  const gridMart = gridId ? model.marts.get(gridId) : undefined;
  const [rows, setRows] = useState<{ id: string; label: string } | null>(null);
  const showRows = useCallback((label: string | null) => { if (gridId) setRows(label === null ? null : { id: gridId, label }); }, [gridId]);
  const save = useCallback((grid: GridState) => { if (gridId) dispatch({ type: 'saveGrid', martId: gridId, grid }); }, [dispatch, gridId]);

  return (
    <Band id="band-data" icon={<PickedIcon icon={mart?.icon} fallback={Table2} size={18} />} title={mart?.title ?? 'Data'} total={mart && rows?.id === mart.id ? recordsLabel(rows.label) : undefined} hint="The rows of the selected data mart. Click a row to open it below." folded={folded} onFold={onFold} grid={false} loading={loading}>
      {!gridMart ? (
        <p className="dm-muted p-2 text-sm">Select a data mart.</p>
      ) : !gridMart.accessible ? (
        <p className="dm-muted p-2 text-sm">You do not have access to this data mart</p>
      ) : (
        <MartGrid key={gridMart.id} martId={gridMart.id} model={model} seed={{ filters: selection.filters, saved: grids[gridMart.id] }} onChange={save} onRows={showRows} />
      )}
    </Band>
  );
}
