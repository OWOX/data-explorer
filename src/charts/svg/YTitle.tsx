import { fitText } from './fitText';
import { CutLabel } from './CutLabel';

const MIN_ROOM = 24;
/** The width a rotated axis title takes beside its tick labels. */
export const Y_TITLE_W = 16;

/** A vertical axis title (rotated -90°), centred on `mid`, cut to `length` with the full text in the app tooltip. */
export function YTitle({ x, mid, length, text }: { x: number; mid: number; length: number; text: string }) {
  const shown = fitText(text, Math.max(MIN_ROOM, length));
  return <CutLabel full={text} shown={shown} className="dm-chart-axis-title" data-y-title x={x} y={mid} textAnchor="middle" transform={`rotate(-90 ${x} ${mid})`} />;
}

/** A horizontal axis title centred on `x`, cut to `width` with the full text in the app tooltip. */
export function XTitle({ x, y, width, text }: { x: number; y: number; width: number; text: string }) {
  const shown = fitText(text, Math.max(MIN_ROOM, width));
  return <CutLabel full={text} shown={shown} className="dm-chart-axis-title" x={x} y={y} textAnchor="middle" />;
}
