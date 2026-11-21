import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type SpreadRow = { key: string; label: string; p25: number; p50: number; p75: number; min: number | null; max: number | null; text: string };
const ROW_H = 24;
const TOP = 8;
const AXIS_H = 24;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** One horizontal box per row: P25 to P75 with the median, and MIN to MAX whiskers when known. Positions are drawing ratios; the tooltip text is the caller's. */
export function SpreadChart({ rows, ariaLabel, formatTick, onPick }: { rows: SpreadRow[]; ariaLabel: string; formatTick: (n: number) => string; onPick?: (key: string) => void }) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const all = rows.flatMap((r) => [r.p25, r.p75, r.min ?? r.p25, r.max ?? r.p75]);
  const lo = Math.min(0, ...all);
  const hi = Math.max(0, ...all);
  const left = Math.min(160, Math.max(...rows.map((r) => r.label.length), 0) * CHAR_W + 12);
  const plotW = Math.max(20, width - left - 12);
  const px = (v: number) => left + (hi > lo ? (v - lo) / (hi - lo) : 0) * plotW;
  const height = TOP + rows.length * ROW_H + AXIS_H;
  const ticks = [0, 1, 2, 3].map((t) => lo + (t / 3) * (hi - lo));
  return (
    <div ref={ref} className="dm-spread">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticks.map((t, k) => (
          <g key={k}>
            <line className="dm-chart-grid" x1={px(t)} x2={px(t)} y1={TOP} y2={TOP + rows.length * ROW_H} />
            <text className="dm-chart-text" x={px(t)} y={TOP + rows.length * ROW_H + 14} textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}>{formatTick(t)}</text>
          </g>
        ))}
        {rows.map((r, i) => {
          const mid = TOP + i * ROW_H + ROW_H / 2;
          const pick = onPick ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${r.label}`, style: { cursor: 'pointer' }, onClick: () => onPick(r.key), onKeyDown: press(() => onPick(r.key)) } : {};
          return (
            <Tooltip key={r.key} content={`${r.label}: ${r.text}`}>
              <g {...pick}>
                <text className="dm-chart-text" x={left - 6} y={mid} textAnchor="end" dominantBaseline="middle">{r.label}</text>
                {r.min !== null && r.max !== null && <line data-whisker={r.key} x1={px(r.min)} x2={px(r.max)} y1={mid} y2={mid} stroke="var(--dm-series-1)" strokeWidth={1.5} />}
                <rect data-box={r.key} x={px(r.p25)} y={mid - 7} width={Math.max(1, px(r.p75) - px(r.p25))} height={14} fill="var(--dm-series-1)" fillOpacity={0.35} stroke="var(--dm-series-1)" />
                <line data-median={r.key} x1={px(r.p50)} x2={px(r.p50)} y1={mid - 8} y2={mid + 8} stroke="var(--foreground)" strokeWidth={2} />
              </g>
            </Tooltip>
          );
        })}
      </svg>
      <table className="sr-only"><tbody>{rows.map((r) => <tr key={r.key}><th scope="row">{r.label}</th><td>{r.text}</td></tr>)}</tbody></table>
    </div>
  );
}
