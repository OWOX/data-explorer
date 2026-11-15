import type { Row } from '../../sdk/types';
import { Tooltip } from '../Tooltip';

export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function CellValue({ row, field, title, onOpen }: { row: Row; field: string; title?: string; onOpen?: () => void }) {
  const raw = formatValue(row[field]);
  if (!onOpen || raw.trim() === '') return <span className="truncate">{raw}</span>;
  const link = (
    <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(); }} className="truncate text-left text-primary hover:underline">
      {title ?? raw}
    </button>
  );
  return title ? <Tooltip content={raw}>{link}</Tooltip> : link;
}
