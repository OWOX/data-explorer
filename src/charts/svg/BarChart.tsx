import { useId, type KeyboardEvent, type MouseEvent } from 'react';
import { Tooltip, TipLines } from '../../ui/Tooltip';
import { CutLabel } from './CutLabel';
import { BLANK_COLOR, BLANK_KEY, swatchStyle } from '../blank';
import { BlankDefs, blankFill, blankLines } from './BlankPattern';
import { fitText, textWidth } from './fitText';
import { plotHeight, rowHeight } from '../plotSize';
import { useWidth } from '../useWidth';
import type { Point } from './Sparkline';
import { niceTicks } from './ticks';
import { XTitle, Y_TITLE_W, YTitle } from './YTitle';

export type Series = { /** The category's key (blank sentinel, a real value, or the Other sentinel), so a real value named "(blank)" or "Other" keeps its own element. */ key?: string; name: string; color: string; points: Point[]; /** The catch-all series: not a value of the stack dimension, so it cannot be filtered to. */ other?: boolean; /** The blank value of the stack dimension: its filter is "is blank", whatever its name. */ blank?: boolean };

const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };

const PLOT_H = 240;
const ROW_H = 20;
const GAP = 2;
/** The white seam between two segments of a stack. */
const SEAM = 1;
const RADIUS = 2;
const TOP = 8;
const AXIS_H = 24;
const TITLE_H = 26;
/** The space between the tick labels and the axis title. */
const TITLE_GAP = 8;
const CHAR_W = 6;

/** Stacked bars. Sizes are ratios of the largest stacked total, for drawing only; every shown value is the caller's text. */
export function BarChart({ series, orientation, ariaLabel, formatTick, onPick, canPick, stacked, xTitle, yTitle, integer = false, categorical = false }: { series: Series[]; orientation: 'vertical' | 'horizontal'; ariaLabel: string; formatTick: (n: number) => string;
  /** A click on a bucket (and, when stacked, on one of its segments: `seriesIndex`). */
  onPick?: (x: string, seriesIndex?: number) => void;
  /** Whether a bucket can be filtered to (a blank bucket has no range); default all. */
  canPick?: (x: string) => boolean;
  /** Whether the series are stacked values of one dimension; default: more than one series. */
  stacked?: boolean;
  /** The bucket (or category) field's display name: under the bucket labels of a vertical chart, beside them on a horizontal one. */
  xTitle?: string;
  /** The measure's name, on the value axis: beside the ticks of a vertical chart, under them on a horizontal one. */
  yTitle?: string;
  /** The measure counts whole things: the axis steps are whole numbers. */
  integer?: boolean;
  /** The buckets are categories, not dates: every label shows, cut with an ellipsis to the width of its column (the whole text is in the label's title), instead of every k-th one. */
  categorical?: boolean }) {
  const { ref, width, height: room } = useWidth<HTMLDivElement>();
  const blankId = `dm-blank-${useId().replace(/:/g, '')}`;
  const xs = series[0]?.points ?? [];
  const totals = xs.map((_, i) => series.reduce((sum, s) => sum + Math.max(0, s.points[i]?.y ?? 0), 0));
  const max = Math.max(0, ...totals);
  const { ticks, top } = niceTicks(max, { integer });
  const vertical = orientation === 'vertical';
  const labelW = Math.min(160, Math.max(...xs.map((p) => textWidth(p.label)), 0) + 12);
  const sideTitle = vertical ? yTitle : xTitle;
  const bottomTitle = vertical ? xTitle : yTitle;
  const left = (vertical ? Math.max(32, Math.max(...ticks.map((t) => textWidth(formatTick(t)))) + 12) : labelW) + (sideTitle ? Y_TITLE_W : 0);
  const plotW = Math.max(20, width - left - 8);
  const titleH = bottomTitle ? TITLE_H : 0;
  const plotH = plotHeight(room, TOP + AXIS_H + titleH, PLOT_H);
  const rowH = rowHeight(room, TOP + AXIS_H + titleH, xs.length, ROW_H);
  const band = vertical ? plotW / Math.max(1, xs.length) : rowH;
  const height = (vertical ? TOP + plotH + AXIS_H : TOP + xs.length * rowH + AXIS_H) + titleH;
  // Keep every k-th bucket label so none overlap.
  const labelStep = vertical && !categorical ? Math.max(1, Math.ceil((Math.max(...xs.map((p) => textWidth(p.label)), 0) + 8) / band)) : 1;
  // A category label that does not fit its column is cut so it never runs into its neighbours or over the value axis.
  const fitted = (label: string) => fitText(label, Math.max(CHAR_W, band - 4));
  /** A row label on the left of a horizontal chart: cut to the label column (the side title's strip lies beyond it). */
  const rowLabel = (label: string) => fitText(label, labelW - 10);
  const scale = (n: number) => (top > 0 ? n / top : 0) * (vertical ? plotH : plotW);

  const isStacked = stacked ?? series.length > 1;
  const pickable = (x: string) => !!onPick && (canPick?.(x) ?? true);
  const anyPick = xs.some((p) => pickable(p.x));
  const liveAt = (i: number) => series.filter((s) => s.points[i]?.y != null && s.points[i].y! > 0);
  /** The series whose segment is under the pointer in bucket `i`, found from where the click landed along the stack. */
  const segmentAt = (i: number, e: MouseEvent<SVGRectElement>): number | undefined => {
    const box = e.currentTarget.ownerSVGElement?.getBoundingClientRect();
    if (!isStacked || !box || box.width === 0 || box.height === 0) return undefined;
    const pos = vertical ? TOP + plotH - (e.clientY - box.top) * (height / box.height) : (e.clientX - box.left) * (width / box.width) - left;
    let end = 0;
    for (const s of liveAt(i)) {
      end += scale(s.points[i]!.y!);
      if (pos <= end) return series.indexOf(s);
    }
    return undefined;
  };

  /** A series' colour in bucket `i`: the blank colour for the blank bucket of an unstacked chart (a stack keeps its series colours, they tell the segments apart). */
  const colorAt = (s: Series, i: number) => (!isStacked && xs[i]?.x === BLANK_KEY ? BLANK_COLOR : s.color);
  const marks = xs.flatMap((_, i) => {
    let offset = 0;
    const live = liveAt(i);
    return live.map((s, k) => {
      const p = s.points[i]!;
      const size = scale(p.y!);
      const seg = Math.max(0.5, size - (k === live.length - 1 ? 0 : SEAM)); // the seam sits below each lower segment
      const at = offset;
      offset += size;
      const round = k === live.length - 1; // only the data end is rounded
      const common = { 'data-series': s.name, fill: blankFill(colorAt(s, i), blankId), style: { pointerEvents: 'none' as const, ...(round ? { clipPath: `inset(0 round ${vertical ? `${RADIUS}px ${RADIUS}px 0 0` : `0 ${RADIUS}px ${RADIUS}px 0`})` } : {}) } };
      const rect = vertical
        ? <rect {...common} x={left + i * band + GAP / 2} y={TOP + plotH - at - seg} width={Math.max(1, band - GAP)} height={seg} />
        : <rect {...common} x={left + at} y={TOP + i * rowH + GAP / 2} width={seg} height={rowH - GAP} />;
      if (!(isStacked && xs[i]?.x === BLANK_KEY)) return rect;
      // A stacked blank bucket keeps its series colours; stripes over each segment mark it as blank.
      const rest = { style: common.style };
      const over = vertical
        ? <rect {...rest} fill={blankLines(blankId)} data-blank-hatch={s.name} x={left + i * band + GAP / 2} y={TOP + plotH - at - seg} width={Math.max(1, band - GAP)} height={seg} />
        : <rect {...rest} fill={blankLines(blankId)} data-blank-hatch={s.name} x={left + at} y={TOP + i * rowH + GAP / 2} width={seg} height={rowH - GAP} />;
      return <g key={`${i}-${k}`}>{rect}{over}</g>;
    });
  });

  // One hover band per bucket, the full column (or row): a hairline segment would be unhittable. It sits behind the
  // segments, which ignore the pointer, so a click on it picks the segment from where it landed. The share is a drawing ratio of the bucket's positive stack; the texts are as returned.
  const bands = xs.map((p, i) => {
    const rows = series.filter((s) => s.points[i]?.y != null);
    const sum = totals[i] ?? 0;
    const content = (
      <TipLines lines={[p.label, ...rows.map((s) => (
        <span key={s.key ?? s.name}><span className="dm-chart-swatch" style={swatchStyle(colorAt(s, i))} /> {s.name}: {s.points[i]!.valueText}{sum > 0 && s.points[i]!.y! > 0 ? ` (${Math.round((s.points[i]!.y! / sum) * 100)}%)` : ''}</span>
      ))]} />
    );
    const geom = vertical ? { x: left + i * band, y: TOP, width: band, height: plotH } : { x: left, y: TOP + i * rowH, width: plotW, height: rowH };
    const pick = pickable(p.x) ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${p.label}`, style: { cursor: 'pointer' }, onKeyDown: press(() => onPick!(p.x)) } : {};
    return <Tooltip key={p.x} content={content}><rect data-bucket={p.x} fill="transparent" {...geom} {...pick} onClick={pickable(p.x) ? (e) => { const k = segmentAt(i, e); if (k !== undefined && series[k]!.other) onPick!(p.x); else onPick!(p.x, k); } : undefined} /></Tooltip>;
  });

  return (
    <div className="dm-bar-chart">
      <div ref={ref} className="dm-chart-plot">
      <svg role={anyPick ? 'group' : 'img'} aria-label={ariaLabel} data-orientation={orientation} width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
        <BlankDefs id={blankId} lines={isStacked} />
        {ticks.map((t, k) => {
          const pos = vertical ? TOP + plotH - scale(t) : left + scale(t);
          return (
            <g key={k} className="dm-chart-tick">
              {vertical ? <line className="dm-chart-grid" x1={left} x2={left + plotW} y1={pos} y2={pos} /> : <line className="dm-chart-grid" x1={pos} x2={pos} y1={TOP} y2={TOP + xs.length * rowH} />}
              {vertical
                ? <text className="dm-chart-text" x={left - 6} y={pos} textAnchor="end" dominantBaseline="middle">{formatTick(t)}</text>
                : <text className="dm-chart-text" x={pos} y={TOP + xs.length * rowH + 14} textAnchor={k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}>{formatTick(t)}</text>}
            </g>
          );
        })}
        {xs.map((p, i) => (i % labelStep === 0 ? (
          vertical
            ? <CutLabel key={p.x} full={p.label} shown={categorical ? fitted(p.label) : p.label} className="dm-chart-text" x={left + i * band + band / 2} y={TOP + plotH + 16} textAnchor="middle" />
            : <CutLabel key={p.x} full={p.label} shown={rowLabel(p.label)} className="dm-chart-text" x={left - 6} y={TOP + i * rowH + rowH / 2} textAnchor="end" dominantBaseline="middle" />
        ) : null))}
        {sideTitle && <YTitle x={8} mid={TOP + (vertical ? plotH : xs.length * rowH) / 2} length={vertical ? plotH : xs.length * rowH} text={sideTitle} />}
        {bottomTitle && <XTitle x={left + plotW / 2} y={(vertical ? TOP + plotH + AXIS_H : TOP + xs.length * rowH + AXIS_H) + 10 + TITLE_GAP} width={plotW} text={bottomTitle} />}
        {bands}
        {marks}
      </svg>
      </div>
      {series.length > 1 && (
        <ul className="dm-chart-legend">
          {series.map((s) => <li key={s.key ?? s.name}><span className="dm-chart-swatch" style={swatchStyle(s.color)} />{s.name}</li>)}
        </ul>
      )}
      <table className="sr-only">
        <thead><tr><th>{xTitle ?? 'Bucket'}</th>{series.map((s) => <th key={s.key ?? s.name}>{s.name}</th>)}</tr></thead>
        <tbody>{xs.map((p, i) => <tr key={p.x}><th scope="row">{p.label}</th>{series.map((s) => <td key={s.key ?? s.name}>{s.points[i]?.valueText ?? ''}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
