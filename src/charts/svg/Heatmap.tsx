import type { KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { useWidth } from '../useWidth';

export type Axis = { key: string; label: string };
const ROW_H = 24;
const TOP = 4;
const AXIS_H = 24;
const CHAR_W = 6;
/** The space between the tick labels and the axis title. */
const TITLE_GAP = 8;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** A grid of cells, one colour whose strength is the cell's share of the largest value (drawing only); the text is the caller's. */
export function Heatmap({ xs, ys, cell, ariaLabel, onPick, canPickX, xTitle, yTitle }: {
  xs: Axis[]; ys: Axis[]; cell: (x: string, y: string) => { value: number | null; text: string } | undefined; ariaLabel: string;
  onPick?: (x: string, y: string) => void; canPickX?: (x: string) => boolean; xTitle?: string; yTitle?: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const left = Math.min(160, Math.max(...ys.map((y) => y.label.length), 0) * CHAR_W + 12);
  const colW = (width - left - 4) / Math.max(1, xs.length);
  const height = TOP + ys.length * ROW_H + AXIS_H + (xTitle ? 18 + TITLE_GAP : 0);
  const max = Math.max(0, ...xs.flatMap((x) => ys.map((y) => cell(x.key, y.key)?.value ?? 0)));
  const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((x) => x.label.length), 0) * CHAR_W + 8) / colW));
  const pickable = (x: string) => !!onPick && (canPickX?.(x) ?? true);
  return (
    <div ref={ref} className="dm-heatmap">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        {ys.map((y, j) => <text key={y.key} className="dm-chart-text" x={left - 6} y={TOP + j * ROW_H + ROW_H / 2} textAnchor="end" dominantBaseline="middle">{y.label}</text>)}
        {xs.map((x, i) => (i % labelStep === 0 ? <text key={x.key} className="dm-chart-text" x={left + i * colW + colW / 2} y={TOP + ys.length * ROW_H + 16} textAnchor="middle">{x.label}</text> : null))}
        {xTitle && <text className="dm-chart-axis-title" x={left + (xs.length * colW) / 2} y={TOP + ys.length * ROW_H + AXIS_H + 10 + TITLE_GAP} textAnchor="middle">{xTitle}</text>}
        {xs.flatMap((x, i) => ys.map((y, j) => {
          const c = cell(x.key, y.key);
          if (!c || c.value === null) return null;
          const name = `${x.label}, ${y.label}`;
          const pick = pickable(x.key) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${name}`, style: { cursor: 'pointer' }, onClick: () => onPick!(x.key, y.key), onKeyDown: press(() => onPick!(x.key, y.key)) } : {};
          return (
            <Tooltip key={`${x.key}|${y.key}`} content={`${name}: ${c.text}`}>
              <rect data-cell={`${x.key}|${y.key}`} x={left + i * colW + 1} y={TOP + j * ROW_H + 1} width={Math.max(1, colW - 2)} height={ROW_H - 2}
                fill="var(--dm-series-1)" fillOpacity={(0.12 + 0.88 * (max > 0 ? Math.max(0, c.value) / max : 0)).toFixed(3)} {...pick} />
            </Tooltip>
          );
        }))}
      </svg>
      <table className="sr-only">
        <thead><tr><th>{yTitle ?? ''}</th>{xs.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{ys.map((y) => <tr key={y.key}><th scope="row">{y.label}</th>{xs.map((x) => <td key={x.key}>{cell(x.key, y.key)?.text ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
