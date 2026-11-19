// The Data band: the selected mart's rows, in the grid the Explorer always had.
import { ChartColumn, Table2, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Model } from '../../model/types';
import { useStore, type GridState } from '../../state/store';
import { groupsLabel, recordsLabel } from '../format';
import { Tooltip } from '../Tooltip';
import { MartGrid } from '../explorer/MartGrid';
import { Band } from './Band';
import { ViewSwitch, type SwitchOption } from './ViewSwitch';

/** Shown as the warning's tooltip and at the end of the band's (i). */
export const NO_KEY_NOTE = 'Preview only: this data mart has no primary key.';
const DATA_VIEWS: SwitchOption<'table' | 'charts'>[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'charts', label: 'Charts', icon: ChartColumn },
];
const HINT = 'The rows of the selected data mart. Click a row to open it below.';
const HINT_FULL = 'The rows of the selected data mart. Exit full screen to see an opened row.';

export function DataBand({ model, folded, onFold, loading = null, fullScreen }: { model: Model; folded: boolean; onFold: () => void; loading?: number | null; fullScreen?: { on: boolean; onToggle: () => void } }) {
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
  const [rows, setRows] = useState<{ id: string; label: string; grouped: boolean; noKey: boolean } | null>(null);
  const showRows = useCallback((label: string | null, grouped = false, noKey = false) => { if (gridId) setRows(label === null ? null : { id: gridId, label, grouped, noKey }); }, [gridId]);
  const save = useCallback((grid: GridState, edit = false) => { if (gridId) dispatch({ type: edit ? 'editGrid' : 'saveGrid', martId: gridId, grid }); }, [dispatch, gridId]);

  // The switch edits the stored grid, so it waits for the grid's first save; absent view is the table.
  const saved = gridId ? grids[gridId] : undefined;
  const setView = (v: 'table' | 'charts') => {
    if (!gridId || !saved) return;
    const rest = { ...saved };
    delete rest.view;
    dispatch({ type: 'editGrid', martId: gridId, grid: v === 'charts' ? { ...rest, view: 'charts' } : rest });
  };

  const noKey = !!mart && rows?.id === mart.id && rows.noKey && !!gridMart?.accessible;
  return (
    <Band id="band-data" icon={<Table2 size={18} />} title="Data" total={mart && rows?.id === mart.id ? (rows.grouped ? groupsLabel : recordsLabel)(rows.label) : undefined} hint={`${fullScreen?.on ? HINT_FULL : HINT}${noKey ? ` ${NO_KEY_NOTE}` : ''}`} afterHint={<>{noKey && <NoKeyWarning />}{gridMart?.accessible && saved && <ViewSwitch label="Show data as" options={DATA_VIEWS} value={saved.view === 'charts' ? 'charts' : 'table'} onChange={setView} />}</>} folded={folded} onFold={onFold} grid={false} loading={loading} fullScreen={fullScreen}>
      {!gridMart ? (
        <p className="dm-muted p-2 text-sm">Select a data mart.</p>
      ) : !gridMart.accessible ? (
        <p className="dm-muted p-2 text-sm">You do not have access to this data mart</p>
      ) : (
        <MartGrid key={gridMart.id} martId={gridMart.id} model={model} seed={{ filters: selection.filters, saved: grids[gridMart.id] }} onChange={save} onRows={showRows} paused={held} />
      )}
    </Band>
  );
}

/** A small warning next to the (i): the grid is a preview, and rows cannot be opened. */
function NoKeyWarning() {
  return (
    <Tooltip content={NO_KEY_NOTE}>
      <span className="dm-hint dm-hint-warn" tabIndex={0} role="note" aria-label={NO_KEY_NOTE}><TriangleAlert size={14} /></span>
    </Tooltip>
  );
}
