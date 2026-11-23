const CHAR_W = 6;
/** The width a rotated axis title takes beside its tick labels. */
export const Y_TITLE_W = 16;

/** A vertical axis title (rotated -90°), centred on `mid`, cut to `length` with the full text in a hover title. */
export function YTitle({ x, mid, length, text }: { x: number; mid: number; length: number; text: string }) {
  const room = Math.max(4, Math.floor(length / CHAR_W));
  const shown = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  return <text className="dm-chart-axis-title" data-y-title x={x} y={mid} textAnchor="middle" transform={`rotate(-90 ${x} ${mid})`}><title>{text}</title>{shown}</text>;
}

/** A horizontal axis title centred on `x`, cut to `width` with the full text in a hover title. */
export function XTitle({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const room = Math.max(4, Math.floor(width / CHAR_W));
  const shown = text.length > room ? `${text.slice(0, room - 1)}…` : text;
  return <text className="dm-chart-axis-title" x={x} y={y} textAnchor="middle"><title>{text}</title>{shown}</text>;
}
