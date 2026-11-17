import type { Row } from '../../sdk/types';
import { formatNumber, formatTemporal, formatValue, isNumericType } from '../format';
import { Tooltip, OverflowTip } from '../Tooltip';

export { formatValue };

/**
 * One clipped line of a field's value, exactly as stored (never a looked-up title, never a link).
 * `type` is the field's warehouse type: DATE, DATETIME and TIMESTAMP values show in the viewer's own
 * format, the stored value in the tooltip. Any other value that does not fit shows in full on hover.
 */
export function CellValue({ row, field, type, wrap = false }: { row: Row; field: string; type?: string; wrap?: boolean }) {
  const raw = formatValue(row[field]);
  const when = type ? formatTemporal(row[field], type) : null;
  // A number shows with thousands separators, as Sheets does; the value as stored is in the tooltip only when they differ.
  const num = isNumericType(type) ? formatNumber(row[field]) : null;
  if (num !== null) return wrap ? <span>{num}</span> : <OverflowTip text={num}><span className="block truncate">{num}</span></OverflowTip>;
  // The Row band has the room to show a value whole: it wraps there instead of clipping.
  if (wrap) return when !== null ? <Tooltip content={raw}><span>{when}</span></Tooltip> : <span>{raw}</span>;
  if (when !== null) return <Tooltip content={raw}><span className="block truncate">{when}</span></Tooltip>;
  return <OverflowTip text={raw}><span className="block truncate">{raw}</span></OverflowTip>;
}
