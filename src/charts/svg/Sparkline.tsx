import { useWidth } from '../useWidth';

export type Point = { x: string; y: number | null; label: string; valueText: string };

const H = 28;
const PAD = 3;

/** A 2px line, no fill, no axes. A null y breaks the line; a lone point is drawn as a dot. */
export function Sparkline({ points, ariaLabel }: { points: Point[]; ariaLabel: string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const ys = points.map((p) => p.y).filter((y): y is number => y !== null);
  const lo = Math.min(...ys);
  const hi = Math.max(...ys);
  const px = (i: number) => (points.length < 2 ? width / 2 : PAD + (i / (points.length - 1)) * (width - 2 * PAD));
  const py = (y: number) => (hi === lo ? H / 2 : H - PAD - ((y - lo) / (hi - lo)) * (H - 2 * PAD));
  let d = '';
  let open = false;
  points.forEach((p, i) => {
    if (p.y === null) { open = false; return; }
    const at = `${px(i).toFixed(1)} ${py(p.y).toFixed(1)}`;
    d += open ? ` L${at}` : `${d ? ' ' : ''}M${at} L${at}`; // the zero-length segment makes a round dot of a lone point
    open = true;
  });
  return (
    <div ref={ref} className="dm-sparkline">
      <svg role="img" aria-label={ariaLabel} width="100%" height={H} viewBox={`0 0 ${width} ${H}`} preserveAspectRatio="none">
        <path d={d} className="dm-spark-line" />
      </svg>
      <table className="sr-only">
        <tbody>{points.map((p) => <tr key={p.x}><th scope="row">{p.label}</th><td>{p.valueText}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
