import type { Row } from '../../sdk/types';
import { formatTemporal } from '../format';
import { Tooltip } from '../Tooltip';

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** `type` is the field's warehouse type: DATE, DATETIME and TIMESTAMP values show in the viewer's own format, the stored value in the tooltip. */
export function CellValue({ row, field, type, title, onOpen }: { row: Row; field: string; type?: string; title?: string; onOpen?: () => void }) {
  const raw = formatValue(row[field]);
  const when = type ? formatTemporal(row[field], type) : null;
  if (when !== null && !onOpen) return <Tooltip content={raw}><span className="truncate">{when}</span></Tooltip>;
  if (!onOpen || raw.trim() === '') return <span className="truncate">{when ?? raw}</span>;
  const link = (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="truncate text-left text-primary hover:underline">
      {title ?? when ?? raw}
    </button>
  );
  return title || when !== null ? <Tooltip content={raw}>{link}</Tooltip> : link;
}
