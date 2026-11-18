import { Tooltip, TipLines } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';
import type { Point } from './Sparkline';

export type Series = { name: string; color: string; points: Point[] };

const PLOT_H = 240;
const ROW_H = 20;
const GAP = 2;
const RADIUS = 4;
const TOP = 8;
const AXIS_H = 24;
const CHAR_W = 6;

/** Stacked bars. Sizes are ratios of the largest stacked total, for drawing only; every shown value is the caller's text. */
export function BarChart({ series, orientation, ariaLabel, formatTick }: { series: Series[]; orientation: 'vertical' | 'horizontal'; ariaLabel: string; formatTick: (n: number) => string }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const xs = series[0]?.points ?? [];
  const totals = xs.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.points[i]?.y ?? 0), 0));
  const max = Math.max(0, ...totals);
  const ticks = [0, 1, 2, 3].map((t) => (t / 3) * max);
  const vertical = orientation === 'vertical';
  const labelW = Math.min(160, Math.max(...xs.map((p) => p.label.length), 0) * CHAR_W + 12);
  const left = vertical ? Math.max(32, Math.max(...ticks.map((t) => formatTick(t).length)) * CHAR_W + 12) : labelW;
  const plotW = Math.max(20, width - left - 8);
  const band = vertical ? plotW / Math.max(1, xs.length) : ROW_H;
  const height = vertical ? TOP + PLOT_H + AXIS_H : TOP + xs.length * ROW_H + AXIS_H;
  // Keep every k-th bucket label so none overlap.
  const labelStep = vertical ? Math.max(1, Math.ceil((Math.max(...xs.map((p) => p.label.length), 0) * CHAR_W + 8) / band)) : 1;
  const scale = (n: number) => (max > 0 ? n / max : 0) * (vertical ? PLOT_H : plotW);

  const marks = xs.flatMap((_, i) => {
    let offset = 0;
    const live = series.filter((s) => s.points[i]?.y != null && s.points[i].y! > 0);
    return live.map((s, k) => {
      const p = s.points[i]!;
      const size = scale(p.y!);
      const seg = Math.max(0.5, size - (k === live.length - 1 ? 0 : GAP)); // the surface gap sits below each lower segment
      const at = offset;
      offset += size;
      const round = k === live.length - 1; // only the data end is rounded
      const common = { 'data-series': s.name, fill: s.color, style: { pointerEvents: 'none' as const, ...(round ? { clipPath: `inset(0 round ${vertical ? `${RADIUS}px ${RADIUS}px 0 0` : `0 ${RADIUS}px ${RADIUS}px 0`})` } : {}) } };
      const rect = vertical
        ? <rect {...common} x={left + i * band + GAP / 2} y={TOP + PLOT_H - at - seg} width={Math.max(1, band - GAP)} height={seg} />
        : <rect {...common} x={left + at} y={TOP + i * ROW_H + GAP / 2} width={seg} height={ROW_H - GAP} />;
      return rect;
    });
  });

  // One hover band per bucket, the full column (or row): a hairline segment would be unhittable. It sits behind the
  // segments, which ignore the pointer. The share is a drawing ratio of the bucket's positive stack; the texts are as returned.
  const bands = xs.map((p, i) => {
    const rows = series.filter((s) => s.points[i]?.y != null);
    const sum = totals[i] ?? 0;
    const content = (
      <TipLines lines={[p.label, ...rows.map((s) => (
        <span key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} /> {s.name}: {s.points[i]!.valueText}{sum > 0 && s.points[i]!.y! > 0 ? ` (${Math.round((s.points[i]!.y! / sum) * 100)}%)` : ''}</span>
      ))]} />
    );
    const geom = vertical ? { x: left + i * band, y: TOP, width: band, height: PLOT_H } : { x: left, y: TOP + i * ROW_H, width: plotW, height: ROW_H };
    return <Tooltip key={p.x} content={content}><rect data-bucket={p.x} fill="transparent" {...geom} /></Tooltip>;
  });

  return (
    <div ref={ref} className="dm-bar-chart">
      <svg role="img" aria-label={ariaLabel} data-orientation={orientation} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => {
          const pos = vertical ? TOP + PLOT_H - scale(t) : left + scale(t);
          return (
            <g key={k} className="dm-chart-tick">
              {vertical ? <line className="dm-chart-grid" x1={left} x2={left + plotW} y1={pos} y2={pos} /> : <line className="dm-chart-grid" x1={pos} x2={pos} y1={TOP} y2={TOP + xs.length * ROW_H} />}
              {vertical
                ? <text className="dm-chart-text" x={left - 6} y={pos} textAnchor="end" dominantBaseline="middle">{formatTick(t)}</text>
                : <text className="dm-chart-text" x={pos} y={TOP + xs.length * ROW_H + 14} textAnchor="middle">{formatTick(t)}</text>}
            </g>
          );
        })}
        {xs.map((p, i) => (i % labelStep === 0 ? (
          vertical
            ? <text key={p.x} className="dm-chart-text" x={left + i * band + band / 2} y={TOP + PLOT_H + 16} textAnchor="middle">{p.label}</text>
            : <text key={p.x} className="dm-chart-text" x={left - 6} y={TOP + i * ROW_H + ROW_H / 2} textAnchor="end" dominantBaseline="middle">{p.label}</text>
        ) : null))}
        {bands}
        {marks}
      </svg>
      {series.length > 1 && (
        <ul className="dm-chart-legend">
          {series.map((s) => <li key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} />{s.name}</li>)}
        </ul>
      )}
      <table className="sr-only">
        <thead><tr><th>Bucket</th>{series.map((s) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((p, i) => <tr key={p.x}><th scope="row">{p.label}</th>{series.map((s) => <td key={s.name}>{s.points[i]?.valueText ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
