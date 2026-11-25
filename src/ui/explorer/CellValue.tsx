import type { Row } from '../../sdk/types';
import { formatNumber, formatTemporal, formatValue, isNumericType } from '../format';
import { formatValue as formatAs, type Format } from '../../format/formats';
import { useServices } from '../../state/store';
import { linkOf } from '../link';
import { Tooltip, OverflowTip } from '../Tooltip';

/** A cell's URL. It opens in a new tab through the host, since the plugin's frame has no popups. A shift-click, the click that ends a drag (the grid cancels it) and the second click of a double click open nothing. */
function CellLink({ href, text, tabIndex }: { href: string; text: string; tabIndex?: number }) {
  const { ctx } = useServices();
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="dm-cell-link" tabIndex={tabIndex} onClick={(e) => {
      const cancelled = e.defaultPrevented || e.shiftKey || e.detail > 1;
      e.preventDefault();
      if (!cancelled) void ctx.ui.openExternal(href).catch(() => undefined);
    }}>{text}</a>
  );
}

/**
 * One clipped line of a field's value, exactly as stored (never a looked-up title). A value that is a URL is a link.
 * `type` is the field's warehouse type: DATE, DATETIME and TIMESTAMP values show in the viewer's own
 * format, the stored value in the tooltip. Any other value that does not fit shows in full on hover.
 */
export function CellValue({ row, field, type, wrap = false, format }: { row: Row; field: string; type?: string; wrap?: boolean; /** The column's chosen display format; absent or `auto` keeps the default look. */ format?: Format }) {
  const raw = formatValue(row[field]);
  const href = linkOf(raw);
  if (href) {
    if (wrap) return <span><CellLink href={href} text={raw} /></span>;
    // The grid is one Tab stop: its links stay out of the Tab order.
    return <OverflowTip text={raw}><span className="block truncate"><CellLink href={href} text={raw} tabIndex={-1} /></span></OverflowTip>;
  }
  if (type && format && format.kind !== 'auto') {
    const shown = formatAs(row[field], type, format);
    return wrap ? <span>{shown}</span> : <OverflowTip text={shown}><span className="block truncate">{shown}</span></OverflowTip>;
  }
  const when = type ? formatTemporal(row[field], type) : null;
  // A number shows with thousands separators, as Sheets does; the tooltip (when clipped) shows the same text.
  const num = isNumericType(type) ? formatNumber(row[field]) : null;
  if (num !== null) return wrap ? <span>{num}</span> : <OverflowTip text={num}><span className="block truncate">{num}</span></OverflowTip>;
  // The Row band has the room to show a value whole: it wraps there instead of clipping.
  if (wrap) return when !== null ? <Tooltip content={raw}><span>{when}</span></Tooltip> : <span>{raw}</span>;
  if (when !== null) return <Tooltip content={raw}><span className="block truncate">{when}</span></Tooltip>;
  return <OverflowTip text={raw}><span className="block truncate">{raw}</span></OverflowTip>;
}
