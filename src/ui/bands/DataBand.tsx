// The Data band: the selected mart's rows, in the grid the Explorer always had.
import { Table2 } from 'lucide-react';
import { useCallback } from 'react';
import type { Model } from '../../model/types';
import { useStore, type GridState } from '../../state/store';
import { MartGrid } from '../explorer/MartGrid';
import { resolveIcon } from '../icons';
import { Band } from './Band';

export function DataBand({ model, folded, onFold }: { model: Model; folded: boolean; onFold: () => void }) {
  const [{ selection, grids }, dispatch] = useStore();
  const { martId } = selection;
  const mart = martId ? model.marts.get(martId) : undefined;
  const save = useCallback((grid: GridState) => { if (martId) dispatch({ type: 'saveGrid', martId, grid }); }, [dispatch, martId]);

  return (
    <Band id="band-data" icon={resolveIcon(mart?.icon ?? null, Table2)} title={mart?.title ?? 'Data'} hint="The rows of the selected data mart. Click a row to open it below." folded={folded} onFold={onFold} grid={false}>
      {!mart ? (
        <p className="dm-muted p-2 text-sm">Select a data mart.</p>
      ) : !mart.accessible ? (
        <p className="dm-muted p-2 text-sm">You do not have access to this data mart</p>
      ) : (
        <MartGrid key={mart.id} martId={mart.id} model={model} seed={{ filters: selection.filters, saved: grids[mart.id] }} onChange={save} />
      )}
    </Band>
  );
}
