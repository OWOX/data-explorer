import { useMemo } from 'react';
import { Tooltip, TipLines } from '../../ui/Tooltip';
import { BLANK_KEY, BLANK_STROKE, swatchStyle, thinColor } from '../blank';
import { plotHeight } from '../plotSize';
import { useWidth } from '../useWidth';
import type { Series } from './BarChart';
import { BlankDefs, blankLines, useBlankId } from './BlankPattern';
import { pickProps } from './pick';
import { textWidth } from './fitText';
import { niceTicks } from './ticks';
import { XTitle, Y_TITLE_W, YTitle } from './YTitle';

const PLOT_H = 240;
const TOP = 8;
const AXIS_H = 24;
const TITLE_H = 26;
/** The space between the tick labels and the axis title. */
const TITLE_GAP = 8;

/** Lines (and optional area fills) over buckets; a second measure on its own right axis. Positions are ratios for drawing only; every shown value is the caller's text. */
export function LineChart({ left, right = null, area, ariaLabel, formatLeft, formatRight = formatLeft, onPick, xTitle, yTitle, yTitleRight, integerLeft = false, integerRight = false }: {
  left: Series[]; right?: Series | null; area: boolean; ariaLabel: string; formatLeft: (n: number) => string; formatRight?: (n: number) => string;
  onPick?: (x: string) => void; xTitle?: string;
  /** The left measure's name, and the right one's when there is a right axis, rotated beside the tick labels. */
  yTitle?: string; yTitleRight?: string;
  /** The axis counts whole things: its steps are whole numbers. */
  integerLeft?: boolean; integerRight?: boolean;
}) {
  const { ref, width, height: room } = useWidth<HTMLDivElement>();
  const plotH = plotHeight(room, TOP + AXIS_H + (xTitle ? TITLE_H : 0), PLOT_H);
  const blankId = useBlankId();
  // Buckets are the sorted union of every series' x, so a value is always placed under its own bucket (the two reads may differ).
  const seen = new Map<string, string>();
  for (const s of [...left, ...(right ? [right] : [])]) for (const p of s.points) if (!seen.has(p.x)) seen.set(p.x, p.label);
  const xs = [...seen].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([x, label]) => ({ x, label }));
  const byX = useMemo(() => new Map([...left, ...(right ? [right] : [])].map((s) => [s, new Map(s.points.map((p) => [p.x, p]))] as const)), [left, right]);
  const at = (s: Series, x: string) => byX.get(s)?.get(x);
  const maxOf = (ss: Series[]) => Math.max(0, ...ss.flatMap((s) => s.points.map((p) => p.y ?? 0)));
  const maxL = maxOf(left);
  const maxR = right ? maxOf([right]) : 0;
  const tl = niceTicks(maxL, { integer: integerLeft });
  const tr = niceTicks(maxR, { integer: integerRight });
  const leftW = Math.max(32, Math.max(...tl.ticks.map((t) => textWidth(formatLeft(t)))) + 12) + (yTitle ? Y_TITLE_W : 0);
  const rightW = (right ? Math.max(32, Math.max(...tr.ticks.map((t) => textWidth(formatRight(t)))) + 12) : Math.max(8, Math.ceil(textWidth(xs.at(-1)?.label ?? '') / 2) + 2)) + (right && yTitleRight ? Y_TITLE_W : 0);
  const plotW = Math.max(20, width - leftW - rightW);
  const step = xs.length > 1 ? plotW / (xs.length - 1) : 0;
  const px = (i: number) => leftW + (xs.length > 1 ? i * step : plotW / 2);
  const py = (y: number, max: number) => TOP + plotH - (max > 0 ? y / max : 0) * plotH;
  const height = TOP + plotH + AXIS_H + (xTitle ? TITLE_H : 0);
  const pathOf = (s: Series, max: number) => {
    let d = ''; let open = false;
    xs.forEach((b, i) => {
      const p = at(s, b.x);
      if (!p || p.y === null) { open = false; return; }
      d += `${open ? ' L' : `${d ? ' ' : ''}M`}${px(i).toFixed(1)} ${py(p.y, max).toFixed(1)}`;
      open = b.x !== BLANK_KEY; // the blank bucket is no step in time: the line starts after it
    });
    return d;
  };
  const areaOf = (s: Series, max: number) => {
    // One closed shape per unbroken run, down to the zero line.
    const runs: number[][] = []; let run: number[] = [];
    xs.forEach((b, i) => { if (at(s, b.x)?.y == null || b.x === BLANK_KEY) { if (run.length) runs.push(run); run = []; } else run.push(i); });
    if (run.length) runs.push(run);
    return runs.map((r) => `M${px(r[0]!).toFixed(1)} ${TOP + plotH} ${r.map((i) => `L${px(i).toFixed(1)} ${py(at(s, xs[i]!.x)!.y!, max).toFixed(1)}`).join(' ')} L${px(r.at(-1)!).toFixed(1)} ${TOP + plotH} Z`).join(' ');
  };
  const all = right ? [...left.map((s) => ({ s, max: tl.top })), { s: right, max: tr.top }] : left.map((s) => ({ s, max: tl.top }));
    const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((p) => textWidth(p.label)), 0) + 8) / Math.max(1, step || plotW)));
  const band = xs.length > 1 ? step : plotW;
  return (
    <div className="dm-line-chart">
      <div ref={ref} className="dm-chart-plot">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <BlankDefs id={blankId} lines />
        {tl.ticks.map((t) => (
          <g key={t}>
            <line className="dm-chart-grid" x1={leftW} x2={leftW + plotW} y1={py(t, tl.top)} y2={py(t, tl.top)} />
            <text className="dm-chart-text" x={leftW - 6} y={py(t, tl.top)} textAnchor="end" dominantBaseline="middle">{formatLeft(t)}</text>
          </g>
        ))}
        {right && tr.ticks.map((t) => <text key={t} data-axis="right" className="dm-chart-text" x={leftW + plotW + 6} y={py(t, tr.top)} dominantBaseline="middle">{formatRight(t)}</text>)}
        {yTitle && <YTitle x={8} mid={TOP + plotH / 2} length={plotH} text={yTitle} />}
        {right && yTitleRight && <YTitle x={leftW + plotW + rightW - 8} mid={TOP + plotH / 2} length={plotH} text={yTitleRight} />}
        {xs.map((p, i) => (i % labelStep === 0 ? <text key={p.x} className="dm-chart-text" x={px(i)} y={TOP + plotH + 16} textAnchor="middle">{p.label}</text> : null))}
        {xTitle && <XTitle x={leftW + plotW / 2} y={TOP + plotH + AXIS_H + 10 + TITLE_GAP} width={plotW} text={xTitle} />}
        {xs.map((p, i) => (p.x === BLANK_KEY ? <rect key="blank-band" data-blank-hatch={p.x} x={Math.max(leftW, px(i) - band / 2)} y={TOP} width={Math.min(leftW + plotW, px(i) + band / 2) - Math.max(leftW, px(i) - band / 2)} height={plotH} fill={blankLines(blankId)} style={{ pointerEvents: 'none' }} /> : null))}
        {area && all.map(({ s, max }) => <path key={`a-${s.key ?? s.name}`} data-area={s.name} d={areaOf(s, max)} fill={thinColor(s.color)} fillOpacity={0.18} stroke="none" />)}
        {xs.flatMap((p, i) => (p.x === BLANK_KEY ? all.filter(({ s }) => at(s, p.x)?.y != null).map(({ s, max }) => <circle key={`blank-dot-${s.key ?? s.name}`} data-blank-dot={s.name} cx={px(i)} cy={py(at(s, p.x)!.y!, max)} r={3} fill={BLANK_STROKE} style={{ pointerEvents: 'none' }} />) : []))}
        {all.map(({ s, max }, k) => <path key={s.key ?? s.name} data-line={s.name} d={pathOf(s, max)} fill="none" stroke={thinColor(s.color)} strokeWidth={2} strokeDasharray={right && k === all.length - 1 ? '5 3' : undefined} strokeLinejoin="round" strokeLinecap="round" />)}
        {xs.map((p, i) => {
          const content = <TipLines lines={[p.label, ...all.filter(({ s }) => at(s, p.x)?.y != null).map(({ s }) => <span key={s.key ?? s.name}><span className="dm-chart-swatch" style={swatchStyle(thinColor(s.color))} /> {s.name}: {at(s, p.x)!.valueText}</span>)]} />;
          const pick = onPick ? pickProps(`Filter to ${p.label}`, () => onPick(p.x)) : {};
          return <Tooltip key={p.x} content={content}><rect data-bucket={p.x} fill="transparent" x={px(i) - band / 2} y={TOP} width={band} height={plotH} {...pick} /></Tooltip>;
        })}
      </svg>
      </div>
      {all.length > 1 && (
        <ul className="dm-chart-legend">
          {all.map(({ s }, k) => <li key={s.key ?? s.name}><span className="dm-chart-swatch" style={swatchStyle(thinColor(s.color))} />{s.name}{right && k === all.length - 1 ? ' (right axis)' : ''}</li>)}
        </ul>
      )}
      <table className="sr-only">
        <thead><tr><th>{xTitle ?? 'Bucket'}</th>{all.map(({ s }) => <th key={s.key ?? s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((p) => <tr key={p.x}><th scope="row">{p.label}</th>{all.map(({ s }) => <td key={s.key ?? s.name}>{at(s, p.x)?.valueText ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
