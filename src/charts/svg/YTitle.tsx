import { fitText } from './fitText';

const MIN_ROOM = 24;
/** The width a rotated axis title takes beside its tick labels. */
export const Y_TITLE_W = 16;

/** A vertical axis title (rotated -90°), centred on `mid`, cut to `length` with the full text in a hover title. */
export function YTitle({ x, mid, length, text }: { x: number; mid: number; length: number; text: string }) {
  const shown = fitText(text, Math.max(MIN_ROOM, length));
  return <text className="dm-chart-axis-title" data-y-title x={x} y={mid} textAnchor="middle" transform={`rotate(-90 ${x} ${mid})`}><title>{text}</title>{shown}</text>;
}

/** A horizontal axis title centred on `x`, cut to `width` with the full text in a hover title. */
export function XTitle({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const shown = fitText(text, Math.max(MIN_ROOM, width));
  return <text className="dm-chart-axis-title" x={x} y={y} textAnchor="middle"><title>{text}</title>{shown}</text>;
}
