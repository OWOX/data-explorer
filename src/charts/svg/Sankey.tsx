import { useId, useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';
import { HoverableTooltipProvider, Tooltip } from '../../ui/Tooltip';
import { CutLabel } from './CutLabel';
import { BLANK_COLOR, thinColor, labelOf, OTHER_KEY } from '../blank';
import { BlankDefs, blankFill } from './BlankPattern';
import { layoutSankey, NODE_GAP, NODE_W, REST_ORIGIN, type Flow, type NodeSize, type SankeyLink, type Tone } from '../sankeyLayout';
import { OTHER_COLOR } from '../useDateSeries';
import { useWidth } from '../useWidth';

// Sized for the 13px text charts.css gives a Sankey.
const TOP = 28;
/** The room right of the last column for its labels: this share of the width, within these bounds, so a narrow chart keeps its ribbons. */
const LABEL_PAD = { share: 0.3, min: 110, max: 180 };
const labelPad = (width: number): number => Math.min(LABEL_PAD.max, Math.max(LABEL_PAD.min, width * LABEL_PAD.share));
const CHAR_W = 7;
const LINE_H = 15;
/** Room under the plot: the label of a thin last node reaches below it. */
const BOTTOM = 8;
const MIN_PLOT = 80;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
const colorOf = (t: Tone): string => (t.kind === 'blank' ? BLANK_COLOR : t.kind === 'other' ? OTHER_COLOR : t.color);
const nodeName = (key: string): string => (key === OTHER_KEY ? 'Other' : labelOf(key));
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`);

/**
 * Columns of nodes joined by ribbons. `columns[c]` are column c's nodes with their exact totals; `flows[i]` are the flows from column i to i+1
 * (a ribbon takes the colour of its first-column node); `text` formats a value. A node click gives its column and key, a ribbon click its pair and both keys;
 * "Other" is never clickable. Node and cut-label tooltips open on the right, can be entered with the pointer and copied (a corner button); ribbon tooltips are plain ones on top. Hover never re-renders: it sets `data-hot` on the svg and `is-on` / `is-hot` on the lit elements, and charts.css does the dimming. Only nodes are tab stops: ribbons answer the mouse, and the screen-reader table lists them.
 */
export function Sankey({ titles, columns, flows, fit, ribbonShare, text, ariaLabel, onPickNode, onPickLink }: {
  titles: string[]; columns?: NodeSize[][]; flows: Flow[][]; /** Fan-out mode: ribbons that add up to more than their node are scaled to fit it. */ fit?: boolean; /** Per column: false where the column's values overlap (a join repeats a record), so a ribbon that touches it has no percent of its pair's total. Absent shows it. A node's share is of the drawn column's values added up and is always shown. */ ribbonShare?: boolean[]; text: (value: number) => string; ariaLabel: string;
  onPickNode?: (col: number, key: string) => void; onPickLink?: (pair: number, source: string, target: string) => void;
}) {
  const { ref, width, height: room } = useWidth<HTMLDivElement>();
  const root = useRef<SVGSVGElement>(null);
  const blankId = `dm-blank-${useId().replace(/:/g, '')}`;
  // Lights a ribbon (by element) or a node's ribbons (by `col|key`); no argument clears.
  const light = useCallback((link?: Element | null, node?: string) => {
    const svg = root.current;
    if (!svg) return;
    svg.querySelectorAll('.is-on, .is-hot').forEach((e) => e.classList.remove('is-on', 'is-hot'));
    if (!link && !node) { svg.removeAttribute('data-hot'); return; }
    svg.setAttribute('data-hot', '');
    if (link) link.classList.add('is-on');
    if (node) {
      svg.querySelectorAll('.dm-sankey-link').forEach((e) => { if (e.getAttribute('data-from') === node || e.getAttribute('data-to') === node) e.classList.add('is-on'); });
      svg.querySelectorAll('.dm-sankey-node').forEach((e) => { if (e.getAttribute('data-node') === node) e.classList.add('is-hot'); });
    }
  }, []);
  const drawable = width > 0;
  const pad = labelPad(width);
  // A set panel height gives the plot what is left of it; a column of many nodes keeps the room its gaps need, and the plot then scrolls.
  const plot = room === null ? undefined : Math.max(MIN_PLOT, room - TOP - BOTTOM);
  const layout = useMemo(() => layoutSankey({ flows, columns, width: Math.max(120, width), padRight: pad, fit, height: plot }), [flows, columns, width, pad, fit, plot]);
  // A new layout replaces the elements the lit state was set on, so a ribbon the pointer left with the old layout cannot leave the chart dimmed.
  useEffect(() => { light(); }, [layout, light]);
  const height = TOP + layout.height + BOTTOM;
  const step = titles.length > 1 ? Math.max(0, (Math.max(120, width) - pad - NODE_W) / (titles.length - 1)) : 0;
  // A label has the room up to the next column, at most a little over the last column's; the last column has the margin.
  const roomChars = (c: number): number => Math.max(4, Math.floor((c < titles.length - 1 ? Math.min(step - NODE_W - 8, pad + 20) : pad - 4) / CHAR_W));
  // A title starts at the column's left edge, so it also has the node's width.
  const titleChars = (c: number): number => roomChars(c) + 2;
  const originCell = (l: SankeyLink) => (l.origin === undefined ? '' : l.origin === REST_ORIGIN ? 'Other origins' : nodeName(l.origin));
  const colTitle = (c: number) => titles[c] ?? '';
  const linkKey = (l: SankeyLink) => `${l.pair}|${l.source}|${l.target}|${l.origin ?? ''}`;
  const hoverLink = { onMouseEnter: (e: SyntheticEvent) => light(e.currentTarget), onMouseLeave: () => light() };
  const hoverNode = (col: number, key: string) => ({ onMouseEnter: () => light(null, `${col}|${key}`), onMouseLeave: () => light(), onFocus: () => light(null, `${col}|${key}`), onBlur: () => light() });
  // Each column's total, once per layout: the sum of the node values drawn (the ones the tooltips print), so a column's shares add up. A drawn node has a value above 0, so the total is never 0.
  const colTotals = useMemo(() => {
    const sums: number[] = [];
    for (const n of layout.nodes) sums[n.col] = (sums[n.col] ?? 0) + n.value;
    return sums;
  }, [layout]);
  const share = (n: { col: number; value: number }) => ` (${Math.round((n.value / colTotals[n.col]!) * 100)}%)`;
  // The ribbons are built once per layout: hover touches the DOM only (see `light`), so thousands of paths and tooltips are not re-rendered by it.
  const ribbons = useMemo(() => {
    const totals = flows.map((pair) => pair.reduce((sum, f) => (f.value > 0 ? sum + f.value : sum), 0));
    const originName = (o: string) => (o === REST_ORIGIN ? 'other origins' : nodeName(o));
    return layout.links.map((l) => {
      const click = !!onPickLink && l.source !== OTHER_KEY && l.target !== OTHER_KEY;
      const pick = click ? { style: { cursor: 'pointer' }, onClick: () => onPickLink!(l.pair, l.source, l.target) } : {};
      // A ribbon's percent is of its pair's total, which means something only when neither of its columns overlaps.
      const pct = ribbonShare?.[l.pair] === false || ribbonShare?.[l.pair + 1] === false ? '' : ` (${Math.round((l.value / (totals[l.pair] || 1)) * 100)}%)`;
      const tip = `${nodeName(l.source)} → ${nodeName(l.target)}${l.pair > 0 && l.origin !== undefined ? ` (from ${originName(l.origin)})` : ''}: ${text(l.value)}${pct}`;
      return (
        <Tooltip key={linkKey(l)} content={tip}>
          <path className="dm-sankey-link" data-link={`${l.pair}|${l.source}|${l.target}${l.pair > 0 && l.origin !== undefined ? `|${l.origin}` : ''}`} data-from={`${l.pair}|${l.source}`} data-to={`${l.pair + 1}|${l.target}`} d={l.path} fill={thinColor(colorOf(l.tone))} {...hoverLink} {...pick} />
        </Tooltip>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hover handlers are stable (`light` only touches the DOM)
  }, [layout, flows, onPickLink, text, ribbonShare]);
  // Before the width is measured there is nothing to draw on.
  if (!drawable) return <div className="dm-sankey"><div ref={ref} className="dm-chart-plot" /></div>;
  return (
    <HoverableTooltipProvider>
    <div className="dm-sankey">
      <div ref={ref} className="dm-chart-plot">
      <svg ref={root} role={onPickNode || onPickLink ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${Math.max(120, width)} ${height}`}>
        {titles.map((t, c) => <CutLabel key={c} full={t} shown={clip(t, titleChars(c))} className="dm-chart-axis-title" x={c * step} y={14} textAnchor="start" />)}
        <BlankDefs id={blankId} />
        <g transform={`translate(0 ${TOP})`}>
          <g>
            {ribbons}
          </g>
          {layout.nodes.map((n) => {
            const name = nodeName(n.key);
            const label = `${name} ${text(n.value)}`;
            const nodeTip = `${name}: ${text(n.value)}${share(n)}`;
            const labelTip = `${label}${share(n)}`;
            const pickable = !!onPickNode && n.key !== OTHER_KEY;
            const pick = pickable ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${colTitle(n.col)}: ${name}`, style: { cursor: 'pointer' }, onClick: () => onPickNode!(n.col, n.key), onKeyDown: press(() => onPickNode!(n.col, n.key)) } : {};
            return (
              <g key={`${n.col}|${n.key}`}>
                <Tooltip content={nodeTip} copyText={nodeTip} side="right">
                  <rect className="dm-sankey-node" data-node={`${n.col}|${n.key}`} x={n.x} y={n.y} width={n.w} height={Math.max(1, n.h)} fill={blankFill(colorOf(n.tone), blankId)} {...hoverNode(n.col, n.key)} {...pick} />
                </Tooltip>
                {/* A label is centred on its node, so two neighbours are at least the gap plus half of each node apart. */}
                {n.h + NODE_GAP >= LINE_H && (label.length > roomChars(n.col)
                  // A cut label shows its full text on hover; an uncut one stays out of the pointer's way so the ribbons under it stay hoverable.
                  ? <Tooltip content={labelTip} copyText={labelTip} side="right"><text className="dm-chart-text" x={n.x + n.w + 4} y={n.y + n.h / 2} dominantBaseline="middle">{clip(label, roomChars(n.col))}</text></Tooltip>
                  : <text className="dm-chart-text" x={n.x + n.w + 4} y={n.y + n.h / 2} dominantBaseline="middle" pointerEvents="none">{label}</text>)}
              </g>
            );
          })}
        </g>
      </svg>
      </div>
      <table className="sr-only">
        <thead><tr><th>Columns</th><th>From (column 1)</th><th>From</th><th>To</th><th>Value</th></tr></thead>
        <tbody>{layout.links.map((l) => <tr key={linkKey(l)}><td>{colTitle(l.pair)} → {colTitle(l.pair + 1)}</td><td>{originCell(l)}</td><td>{nodeName(l.source)}</td><td>{nodeName(l.target)}</td><td>{text(l.value)}</td></tr>)}</tbody>
      </table>
    </div>
    </HoverableTooltipProvider>
  );
}
