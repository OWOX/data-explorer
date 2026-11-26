import { useRef } from 'react';
import type { Row } from '../../sdk/types';
import { formatTemporal, rawText } from '../format';
import { AUTO, formatValue as formatAs, type Format } from '../../format/formats';
import { useServices } from '../../state/store';
import { linkOf } from '../link';
import { Tooltip, OverflowTip } from '../Tooltip';

/**
 * A cell's URL. It opens in a new tab through the host, since the plugin's frame has no popups. A shift-click, the click that ends a drag (the grid cancels it)
 * and the second click of a double click open nothing. In the Row band (`wrap`) the text can be selected by a drag: a click that ends more than 4 px from
 * its press is the end of such a drag and opens nothing. That is decided by the pointer, not by the selection, so an old selection never blocks a click.
 */
function CellLink({ href, text, tabIndex, wrap }: { href: string; text: string; tabIndex?: number; wrap?: boolean }) {
  const { ctx } = useServices();
  const pressed = useRef<{ x: number; y: number } | null>(null);
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={wrap ? 'dm-cell-link dm-cell-link-text' : 'dm-cell-link'} tabIndex={tabIndex} draggable={wrap ? false : undefined}
      onMouseDown={wrap ? (e) => { pressed.current = e.button === 0 ? { x: e.clientX - e.currentTarget.getBoundingClientRect().left, y: e.clientY - e.currentTarget.getBoundingClientRect().top } : null; } : undefined}
      onClick={(e) => {
        const from = pressed.current;
        pressed.current = null;
        // Relative to the link, so a scroll between press and release counts as movement.
        const box = e.currentTarget.getBoundingClientRect();
        const dragged = wrap && e.detail > 0 && !!from && Math.hypot(e.clientX - box.left - from.x, e.clientY - box.top - from.y) > 4;
        const cancelled = e.defaultPrevented || e.shiftKey || e.detail > 1 || dragged;
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
  const raw = rawText(row[field]);
  const href = linkOf(raw);
  if (href) {
    if (wrap) return <span><CellLink href={href} text={raw} wrap /></span>;
    // The grid is one Tab stop: its links stay out of the Tab order.
    return <OverflowTip text={raw}><span className="block truncate"><CellLink href={href} text={raw} tabIndex={-1} /></span></OverflowTip>;
  }
  const shown = formatAs(row[field], type ?? '', format ?? AUTO);
  // A temporal value in the default look shows the viewer's format, with the stored value as the tooltip.
  const temporal = type && !(format && format.kind !== 'auto') && formatTemporal(row[field], type) !== null;
  // The Row band has the room to show a value whole: it wraps there instead of clipping.
  if (temporal) return <Tooltip content={raw}>{wrap ? <span>{shown}</span> : <span className="block truncate">{shown}</span>}</Tooltip>;
  return wrap ? <span>{shown}</span> : <OverflowTip text={shown}><span className="block truncate">{shown}</span></OverflowTip>;
}
