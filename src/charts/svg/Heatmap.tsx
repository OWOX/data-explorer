import { useId, type KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { BLANK_KEY } from '../blank';
import { BlankDefs, blankLines } from './BlankPattern';
import { fitText, textWidth } from './fitText';
import { CutLabel } from './CutLabel';
import { rowHeight } from '../plotSize';
import { useWidth } from '../useWidth';
import { XTitle, Y_TITLE_W, YTitle } from './YTitle';

export type Axis = { key: string; label: string };
const ROW_H = 24;
const TOP = 4;
const AXIS_H = 24;
/** The space between the tick labels and the axis title. */
const TITLE_GAP = 8;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

/** A grid of cells, one colour whose strength is the cell's share of the largest value (drawing only); the text is the caller's. */
export function Heatmap({ xs, ys, cell, ariaLabel, onPick, canPickX, xTitle, yTitle }: {
  xs: Axis[]; ys: Axis[]; cell: (x: string, y: string) => { value: number | null; text: string } | undefined; ariaLabel: string;
  onPick?: (x: string, y: string) => void; canPickX?: (x: string) => boolean; xTitle?: string; yTitle?: string;
}) {
  const { ref, width, height: room } = useWidth<HTMLDivElement>();
  const rowH = rowHeight(room, TOP + AXIS_H + (xTitle ? 18 + TITLE_GAP : 0), ys.length, ROW_H);
  const blankId = `dm-blank-${useId().replace(/:/g, '')}`;
  const labelW = Math.min(160, Math.max(...ys.map((y) => textWidth(y.label)), 0) + 12);
  const left = labelW + (yTitle ? Y_TITLE_W : 0);
  const colW = (width - left - 4) / Math.max(1, xs.length);
  const height = TOP + ys.length * rowH + AXIS_H + (xTitle ? 18 + TITLE_GAP : 0);
  const max = Math.max(0, ...xs.flatMap((x) => ys.map((y) => cell(x.key, y.key)?.value ?? 0)));
  const labelStep = Math.max(1, Math.ceil((Math.max(...xs.map((x) => textWidth(x.label)), 0) + 8) / colW));
  const pickable = (x: string) => !!onPick && (canPickX?.(x) ?? true);
  return (
    <div className="dm-heatmap">
      <div ref={ref} className="dm-chart-plot">
      <svg role={onPick ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <BlankDefs id={blankId} lines />
        {yTitle && <YTitle x={8} mid={TOP + (ys.length * rowH) / 2} length={ys.length * rowH} text={yTitle} />}
        {ys.map((y, j) => <CutLabel key={y.key} full={y.label} shown={fitText(y.label, labelW - 10)} className="dm-chart-text" x={left - 6} y={TOP + j * rowH + rowH / 2} textAnchor="end" dominantBaseline="middle" />)}
        {xs.map((x, i) => (i % labelStep === 0 ? <text key={x.key} className="dm-chart-text" x={left + i * colW + colW / 2} y={TOP + ys.length * rowH + 16} textAnchor="middle">{x.label}</text> : null))}
        {xTitle && <XTitle x={left + (xs.length * colW) / 2} y={TOP + ys.length * rowH + AXIS_H + 10 + TITLE_GAP} width={xs.length * colW} text={xTitle} />}
        {xs.flatMap((x, i) => ys.map((y, j) => {
          const c = cell(x.key, y.key);
          if (!c || c.value === null) return null;
          const name = `${x.label}, ${y.label}`;
          const pick = pickable(x.key) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${name}`, style: { cursor: 'pointer' }, onClick: () => onPick!(x.key, y.key), onKeyDown: press(() => onPick!(x.key, y.key)) } : {};
          return (
            <Tooltip key={`${x.key}|${y.key}`} content={`${name}: ${c.text}`}>
              <rect data-cell={`${x.key}|${y.key}`} x={left + i * colW + 1} y={TOP + j * rowH + 1} width={Math.max(1, colW - 2)} height={rowH - 2}
                fill="var(--dm-series-1)" fillOpacity={(0.12 + 0.88 * (max > 0 ? Math.max(0, c.value) / max : 0)).toFixed(3)} {...pick} />
            </Tooltip>
          );
        }))}
        {xs.flatMap((x, i) => ys.map((y, j) => {
          const c = cell(x.key, y.key);
          if (!c || c.value === null || (x.key !== BLANK_KEY && y.key !== BLANK_KEY)) return null;
          return <rect key={`h${x.key}|${y.key}`} data-blank-hatch={`${x.key}|${y.key}`} x={left + i * colW + 1} y={TOP + j * rowH + 1} width={Math.max(1, colW - 2)} height={rowH - 2} fill={blankLines(blankId)} style={{ pointerEvents: 'none' }} />;
        }))}
      </svg>
      </div>
      <table className="sr-only">
        <thead><tr><th>{yTitle ?? ''}</th>{xs.map((x) => <th key={x.key}>{x.label}</th>)}</tr></thead>
        <tbody>{ys.map((y) => <tr key={y.key}><th scope="row">{y.label}</th>{xs.map((x) => <td key={x.key}>{cell(x.key, y.key)?.text ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
