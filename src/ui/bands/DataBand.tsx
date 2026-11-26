// The Data band: the selected mart's rows, in the grid the Explorer always had.
import { ChartColumn, Table2, TriangleAlert } from 'lucide-react';
import { useCallback, useState } from 'react';
import type { Model } from '../../model/types';
import { useStore, type GridState } from '../../state/store';
import { groupsLabel, recordsLabel } from '../format';
import { Tooltip } from '../Tooltip';
import { ConfigMenuSlot } from '../../charts/menuSlot';
import { MartGrid, type NoKey } from '../explorer/MartGrid';
import { Band } from './Band';
import type { Matched } from './matched';
import { useFillHeight } from './useFillHeight';
import { ViewSwitch, type SwitchOption } from './ViewSwitch';

/** Shown as the warning's tooltip and at the end of the band's (i). A key hidden for reporting is still a key: no warning. */
const NO_KEY_NOTE = 'Preview only: this data mart has no primary key.';
const DATA_VIEWS: SwitchOption<'table' | 'charts'>[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'charts', label: 'Charts', icon: ChartColumn },
];
const HINT = 'The rows of the selected data mart. Click a row to open it below.';
const HINT_FULL = 'The rows of the selected data mart. Exit full screen to see an opened row.';
/** A key hidden for reporting cannot be filtered on, so a row cannot be opened: the hint does not offer it. */
const HINT_NO_OPEN = 'The rows of the selected data mart.';

export function DataBand({ model, folded, onFold, loading = null, fullScreen, onMatched }: { model: Model; folded: boolean; onFold: () => void; loading?: number | null; fullScreen?: { on: boolean; onToggle: () => void }; /** Told how many records of each data mart of the report the filters and slices keep, for the cards; null when the grid goes away. */ onMatched?: (matched: Matched | null) => void }) {
  useFillHeight('band-data');
  const [{ selection, grids }, dispatch] = useStore();
  const { martId } = selection;
  const mart = martId ? model.marts.get(martId) : undefined;
  // The grid follows the selection only while the band is open: a folded band mounts nothing new, so no hidden query is billed.
  // The same while the load bar shows: nothing is read until the page has finished reading.
  const held = folded || loading !== null;
  const [shownId, setShownId] = useState(held ? null : martId);
  if (!held && shownId !== martId) setShownId(martId);
  const gridId = held ? shownId : martId;
  const gridMart = gridId ? model.marts.get(gridId) : undefined;
  const [rows, setRows] = useState<{ id: string; label: string; grouped: boolean; noKey: NoKey } | null>(null);
  const showRows = useCallback((label: string | null, grouped = false, noKey: NoKey = false) => { if (gridId) setRows(label === null ? null : { id: gridId, label, grouped, noKey }); }, [gridId]);
  const showMatched = useCallback((byPath: ReadonlyMap<string, number> | null) => { if (gridId) onMatched?.(byPath && { martId: gridId, byPath }); }, [gridId, onMatched]);
  const save = useCallback((grid: GridState, edit = false) => { if (gridId) dispatch({ type: edit ? 'editGrid' : 'saveGrid', martId: gridId, grid }); }, [dispatch, gridId]);

  const hold = useCallback(() => { if (gridId) dispatch({ type: 'holdGrid', martId: gridId }); }, [dispatch, gridId]);
  const release = useCallback(() => { if (gridId) dispatch({ type: 'releaseGrid', martId: gridId }); }, [dispatch, gridId]);
  const rebase = useCallback((parts: Partial<GridState>) => { if (gridId) dispatch({ type: 'rebaseGrid', martId: gridId, parts }); }, [dispatch, gridId]);

  // The switch edits the stored grid, so it waits for the grid's first save; absent view is the table.
  const saved = gridId ? grids[gridId] : undefined;
  const setView = (v: 'table' | 'charts') => {
    if (!gridId || !saved) return;
    const rest = { ...saved };
    delete rest.view;
    dispatch({ type: 'editGrid', martId: gridId, grid: v === 'charts' ? { ...rest, view: 'charts' } : rest });
  };

  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const noKey: NoKey = mart && rows?.id === mart.id && gridMart?.accessible ? rows.noKey : false;
  const note = noKey === 'missing' ? NO_KEY_NOTE : null;
  const hint = noKey === 'hidden' ? HINT_NO_OPEN : fullScreen?.on ? HINT_FULL : HINT;
  return (
    <Band id="band-data" icon={<Table2 size={18} />} title="Data" total={mart && rows?.id === mart.id ? (rows.grouped ? groupsLabel : recordsLabel)(rows.label) : undefined} hint={`${hint}${note ? ` ${note}` : ''}`} afterHint={<>{note && <NoKeyWarning note={note} />}{gridMart?.accessible && saved && <><ViewSwitch label="Show data as" options={DATA_VIEWS} value={saved.view === 'charts' ? 'charts' : 'table'} onChange={setView} /><span ref={setSlot} data-chart-list-slot className="inline-flex flex-wrap items-center gap-y-1" /></>}</>} folded={folded} onFold={onFold} grid={false} loading={loading} fullScreen={fullScreen}>
      {!gridMart ? (
        <p className="dm-muted p-2 text-sm">Select a data mart.</p>
      ) : !gridMart.accessible ? (
        <p className="dm-muted p-2 text-sm">You do not have access to this data mart</p>
      ) : (
        <ConfigMenuSlot.Provider value={slot}>
          <MartGrid key={gridMart.id} martId={gridMart.id} model={model} seed={{ filters: selection.filters, saved: grids[gridMart.id] }} onChange={save} onHold={hold} onRebase={rebase} onRelease={release} onRows={showRows} onMatched={showMatched} paused={held} />
        </ConfigMenuSlot.Provider>
      )}
    </Band>
  );
}

/** A small warning next to the (i): the grid is a preview, and rows cannot be opened. */
function NoKeyWarning({ note }: { note: string }) {
  return (
    <Tooltip content={note}>
      <span className="dm-hint dm-hint-warn" tabIndex={0} role="note" aria-label={note}><TriangleAlert size={14} /></span>
    </Tooltip>
  );
}
