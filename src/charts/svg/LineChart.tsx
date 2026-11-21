import type { KeyboardEvent } from 'react';
import { Tooltip, TipLines } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';
import type { Series } from './BarChart';

const PLOT_H = 240;
const TOP = 8;
const AXIS_H = 24;
const TITLE_H = 18;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** Lines (and optional area fills) over buckets; a second measure on its own right axis. Positions are ratios for drawing only; every shown value is the caller's text. */
export function LineChart({ left, right = null, area, ariaLabel, formatLeft, formatRight = formatLeft, onPick, canPick, xTitle }: {
  left: Series[]; right?: Series | null; area: boolean; ariaLabel: string; formatLeft: (n: number) => string; formatRight?: (n: number) => string;
  onPick?: (x: string, seriesIndex?: number) => void; canPick?: (x: string) => boolean; xTitle?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const xs = left[0]?.points ?? [];
  const maxOf = (ss: Series[]) => Math.max(0, ...ss.flatMap((s) => s.points.map((p) => p.y ?? 0)));
  const maxL = maxOf(left);
  const maxR = right ? maxOf([right]) : 0;
  const ticks = [0, 1, 2, 3].map((t) => t / 3);
  const leftW = Math.max(32, Math.max(...ticks.map((t) => formatLeft(t * maxL).length)) * CHAR_W + 12);
  const rightW = right ? Math.max(32, Math.max(...ticks.map((t) => formatRight(t * maxR).length)) * CHAR_W + 12) : 8;
  const plotW = Math.max(20, width - leftW - rightW);
  const step = xs.length > 1 ? plotW / (xs.length - 1) : 0;
  const px = (i: number) => leftW + (xs.length > 1 ? i * step : plotW / 2);
  const py = (y: number, max: number) => TOP + PLOT_H - (max > 0 ? y / max : 0) * PLOT_H;
  const height = TOP + PLOT_H + AXIS_H + (xTitle ? TITLE_H : 0);
  const pathOf = (s: Series, max: number) => {
    let d = ''; let open = false;
    s.points.forEach((p, i) => {
      if (p.y === null) { open = false; return; }
      d += `${open ? ' L' : `${d ? ' ' : ''}M`}${px(i).toFixed(1)} ${py(p.y, max).toFixed(1)}`;
      open = true;
    });
    return d;
  };
  const areaOf = (s: Series, max: number) => {
    // One closed shape per unbroken run, down to the zero line.
    const runs: number[][] = []; let run: number[] = [];
    s.points.forEach((p, i) => { if (p.y === null) { if (run.length) runs.push(run); run = []; } else run.push(i); });
    if (run.length) runs.push(run);
    return runs.map((r) => `M${px(r[0]!).toFixed(1)} ${TOP + PLOT_H} ${r.map((i) => `L${px(i).toFixed(1)} ${py(s.points[i]!.y!, max).toFixed(1)}`).join(' ')} L${px(r.at(-1)!).toFixed(1)} ${TOP + PLOT_H} Z`).join(' ');
  };
  const all = right ? [...left.map((s) => ({ s, max: maxL })), { s: right, max: maxR }] : left.map((s) => ({ s, max: maxL }));
  const pickable = (x: string) => !!onPick && (canPick?.(x) ?? true);
  const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((p) => p.label.length), 0) * CHAR_W + 8) / Math.max(1, step || plotW)));
  const band = xs.length > 1 ? step : plotW;
  return (
    <div ref={ref} className="dm-line-chart">
      <svg role={xs.some((p) => pickable(p.x)) ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line className="dm-chart-grid" x1={leftW} x2={leftW + plotW} y1={py(t * maxL, maxL)} y2={py(t * maxL, maxL)} />
            <text className="dm-chart-text" x={leftW - 6} y={py(t * maxL, maxL)} textAnchor="end" dominantBaseline="middle">{formatLeft(t * maxL)}</text>
            {right && <text data-axis="right" className="dm-chart-text" x={leftW + plotW + 6} y={py(t * maxR, maxR)} dominantBaseline="middle">{formatRight(t * maxR)}</text>}
          </g>
        ))}
        {xs.map((p, i) => (i % labelStep === 0 ? <text key={p.x} className="dm-chart-text" x={px(i)} y={TOP + PLOT_H + 16} textAnchor="middle">{p.label}</text> : null))}
        {xTitle && <text className="dm-chart-axis-title" x={leftW + plotW / 2} y={TOP + PLOT_H + AXIS_H + 10} textAnchor="middle">{xTitle}</text>}
        {area && all.map(({ s, max }) => <path key={`a-${s.name}`} data-area={s.name} d={areaOf(s, max)} fill={s.color} fillOpacity={0.18} stroke="none" />)}
        {all.map(({ s, max }, k) => <path key={s.name} data-line={s.name} d={pathOf(s, max)} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={right && k === all.length - 1 ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {xs.map((p, i) => {
          const content = <TipLines lines={[p.label, ...all.filter(({ s }) => s.points[i]?.y != null).map(({ s }) => <span key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} /> {s.name}: {s.points[i]!.valueText}</span>)]} />;
          const pick = pickable(p.x) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${p.label}`, style: { cursor: 'pointer' }, onClick: () => onPick!(p.x), onKeyDown: press(() => onPick!(p.x)) } : {};
          return <Tooltip key={p.x} content={content}><rect data-bucket={p.x} fill="transparent" x={px(i) - band / 2} y={TOP} width={band} height={PLOT_H} {...pick} /></Tooltip>;
        })}
      </svg>
      {all.length > 1 && (
        <ul className="dm-chart-legend">
          {all.map(({ s }, k) => <li key={s.name}><span className="dm-chart-swatch" style={{ background: s.color }} />{s.name}{right && k === all.length - 1 ? ' (right axis)' : ''}</li>)}
        </ul>
      )}
      <table className="sr-only">
        <thead><tr><th>{xTitle ?? 'Bucket'}</th>{all.map(({ s }) => <th key={s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((p, i) => <tr key={p.x}><th scope="row">{p.label}</th>{all.map(({ s }) => <td key={s.name}>{s.points[i]?.valueText ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
