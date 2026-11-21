import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type Dot = { key: string; label: string; x: number; y: number; xText: string; yText: string };
const PLOT_H = 220;
const TOP = 8;
const AXIS_H = 40;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** One dot per point; positions are ratios of each axis's range from zero, for drawing only. */
export function Scatter({ points, ariaLabel, xTitle, yTitle, formatX, formatY, onPick }: {
  points: Dot[]; ariaLabel: string; xTitle: string; yTitle: string; formatX: (n: number) => string; formatY: (n: number) => string; onPick?: (key: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const lo = (v: number[]) => Math.min(0, ...v);
  const hi = (v: number[]) => Math.max(0, ...v);
  const [x0, x1, y0, y1] = [lo(points.map((p) => p.x)), hi(points.map((p) => p.x)), lo(points.map((p) => p.y)), hi(points.map((p) => p.y))];
  const ticks = [0, 1, 2, 3].map((t) => t / 3);
  const left = Math.max(32, Math.max(...ticks.map((t) => formatY(y0 + t * (y1 - y0)).length)) * CHAR_W + 12);
  const plotW = Math.max(20, width - left - 12);
  const px = (x: number) => left + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * plotW;
  const py = (y: number) => TOP + PLOT_H - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * PLOT_H;
  const height = TOP + PLOT_H + AXIS_H;
  return (
    <div ref={ref} className="dm-scatter">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => {
          const yv = y0 + t * (y1 - y0); const xv = x0 + t * (x1 - x0);
          return (
            <g key={k}>
              <line className="dm-chart-grid" x1={left} x2={left + plotW} y1={py(yv)} y2={py(yv)} />
              <text className="dm-chart-text" x={left - 6} y={py(yv)} textAnchor="end" dominantBaseline="middle">{formatY(yv)}</text>
              <text className="dm-chart-text" x={px(xv)} y={TOP + PLOT_H + 14} textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}>{formatX(xv)}</text>
            </g>
          );
        })}
        <text className="dm-chart-axis-title" x={left + plotW / 2} y={TOP + PLOT_H + 32} textAnchor="middle">{xTitle}</text>
        <text className="dm-chart-axis-title" x={10} y={TOP + PLOT_H / 2} textAnchor="middle" transform={`rotate(-90 10 ${TOP + PLOT_H / 2})`}>{yTitle}</text>
        {points.map((p) => {
          const pick = onPick ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${p.label}`, style: { cursor: 'pointer' }, onClick: () => onPick(p.key), onKeyDown: press(() => onPick(p.key)) } : {};
          return <Tooltip key={p.key} content={`${p.label}: ${xTitle} ${p.xText}, ${yTitle} ${p.yText}`}><circle data-dot={p.key} cx={px(p.x)} cy={py(p.y)} r={4} fill="var(--dm-series-1)" fillOpacity={0.75} {...pick} /></Tooltip>;
        })}
      </svg>
      <table className="sr-only">
        <thead><tr><th /><th>{xTitle}</th><th>{yTitle}</th></tr></thead>
        <tbody>{points.map((p) => <tr key={p.key}><th scope="row">{p.label}</th><td>{p.xText}</td><td>{p.yText}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
