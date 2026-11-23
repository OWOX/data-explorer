import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';
import { niceTicks } from './ticks';
import { XTitle, Y_TITLE_W, YTitle } from './YTitle';

export type Dot = { key: string; label: string; x: number; y: number; xText: string; yText: string };
const PLOT_H = 220;
const TOP = 8;
const AXIS_H = 48;
const CHAR_W = 6;
/** The space between the tick labels and the axis title. */
const TITLE_GAP = 8;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** One dot per point; positions are ratios of each axis's range from zero, for drawing only. */
export function Scatter({ points, ariaLabel, xTitle, yTitle, formatX, formatY, onPick, integerX = false, integerY = false }: {
  points: Dot[]; ariaLabel: string; xTitle: string; yTitle: string; formatX: (n: number) => string; formatY: (n: number) => string; onPick?: (key: string) => void;
  /** The axis counts whole things: its steps are whole numbers. */
  integerX?: boolean; integerY?: boolean;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const lo = (v: number[]) => Math.min(0, ...v);
  const hi = (v: number[]) => Math.max(0, ...v);
  const tx = niceTicks(hi(points.map((p) => p.x)), { lo: lo(points.map((p) => p.x)), integer: integerX });
  const ty = niceTicks(hi(points.map((p) => p.y)), { lo: lo(points.map((p) => p.y)), integer: integerY });
  const [x0, x1, y0, y1] = [tx.ticks[0]!, tx.top, ty.ticks[0]!, ty.top];
  const left = Math.max(32, Math.max(...ty.ticks.map((t) => formatY(t).length)) * CHAR_W + 12) + Y_TITLE_W;
  const plotW = Math.max(20, width - left - 12);
  const px = (x: number) => left + (x1 > x0 ? (x - x0) / (x1 - x0) : 0.5) * plotW;
  const py = (y: number) => TOP + PLOT_H - (y1 > y0 ? (y - y0) / (y1 - y0) : 0.5) * PLOT_H;
  const height = TOP + PLOT_H + AXIS_H;
  return (
    <div ref={ref} className="dm-scatter">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ty.ticks.map((t) => (
          <g key={`y${t}`}>
            <line className="dm-chart-grid" x1={left} x2={left + plotW} y1={py(t)} y2={py(t)} />
            <text className="dm-chart-text" x={left - 6} y={py(t)} textAnchor="end" dominantBaseline="middle">{formatY(t)}</text>
          </g>
        ))}
        {tx.ticks.map((t, k) => <text key={`x${t}`} className="dm-chart-text" x={px(t)} y={TOP + PLOT_H + 14} textAnchor={k === 0 ? 'start' : k === tx.ticks.length - 1 ? 'end' : 'middle'}>{formatX(t)}</text>)}
        <XTitle x={left + plotW / 2} y={TOP + PLOT_H + 32 + TITLE_GAP} width={plotW} text={xTitle} />
        <YTitle x={8} mid={TOP + PLOT_H / 2} length={PLOT_H} text={yTitle} />
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
