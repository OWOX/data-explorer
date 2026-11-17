// The page before the model has arrived: every band's header, and a load bar where its body will be.
import { Box, Plug, Rows3, Table2 } from 'lucide-react';
import { Band } from './Band';

type Name = 'sources' | 'marts' | 'data' | 'row';

export function LoadingBands({ loading, folded, onFold }: { loading: number; folded: Record<Name, boolean>; onFold: (band: Name) => void }) {
  return (
    <div className="dm-canvas">
      <Band id="band-sources" icon={<Plug size={18} />} title="Data Sources" hint="Connectors that feed data marts. Select one to see the marts it feeds." folded={folded.sources} onFold={() => onFold('sources')} loading={loading}>{null}</Band>
      <Band id="band-marts" icon={<Box size={18} />} title="Data Marts" hint="The selected data mart and every mart joined to it, or what the search and the filters match." folded={folded.marts} onFold={() => onFold('marts')} loading={loading}>{null}</Band>
      <Band id="band-data" icon={<Table2 size={18} />} title="Data" hint="The rows of the selected data mart. Click a row to open it below." folded={folded.data} onFold={() => onFold('data')} grid={false} loading={loading}>{null}</Band>
      <Band id="band-row" icon={<Rows3 size={18} />} title="Row" hint="One row of the selected data mart." folded={folded.row} onFold={() => onFold('row')} grid={false} loading={loading}>{null}</Band>
    </div>
  );
}
