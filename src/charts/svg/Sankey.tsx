import { useId, useCallback, useEffect, useMemo, useRef, type KeyboardEvent, type SyntheticEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { CutLabel } from './CutLabel';
import { BLANK_COLOR, thinColor, labelOf, OTHER_KEY } from '../blank';
import { BlankDefs, blankFill } from './BlankPattern';
import { layoutSankey, REST_ORIGIN, type Flow, type NodeSize, type SankeyLink, type Tone } from '../sankeyLayout';
import { OTHER_COLOR } from '../useDateSeries';
import { useWidth } from '../useWidth';

const TOP = 22;
const LABEL_PAD = 110;
const CHAR_W = 6;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
const colorOf = (t: Tone): string => (t.kind === 'blank' ? BLANK_COLOR : t.kind === 'other' ? OTHER_COLOR : t.color);
const nodeName = (key: string): string => (key === OTHER_KEY ? 'Other' : labelOf(key));
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`);

/**
 * Columns of nodes joined by ribbons. `columns[c]` are column c's nodes with their exact totals; `flows[i]` are the flows from column i to i+1
 * (a ribbon takes the colour of its first-column node); `text` formats a value. A node click gives its column and key, a ribbon click its pair and both keys;
 * "Other" is never clickable. Hover never re-renders: it sets `data-hot` on the svg and `is-on` / `is-hot` on the lit elements, and charts.css does the dimming. Only nodes are tab stops: ribbons answer the mouse, and the screen-reader table lists them.
 */
export function Sankey({ titles, columns, flows, fit, text, ariaLabel, onPickNode, onPickLink }: {
  titles: string[]; columns?: NodeSize[][]; flows: Flow[][]; /** Fan-out mode: ribbons that add up to more than their node are scaled to fit it. */ fit?: boolean; text: (value: number) => string; ariaLabel: string;
  onPickNode?: (col: number, key: string) => void; onPickLink?: (pair: number, source: string, target: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
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
  const layout = useMemo(() => layoutSankey({ flows, columns, width: Math.max(120, width), padRight: LABEL_PAD, fit }), [flows, columns, width, fit]);
  // A new layout replaces the elements the lit state was set on, so a ribbon the pointer left with the old layout cannot leave the chart dimmed.
  useEffect(() => { light(); }, [layout, light]);
  const height = TOP + layout.height + 4;
  const step = titles.length > 1 ? Math.max(0, (Math.max(120, width) - LABEL_PAD - 12) / (titles.length - 1)) : 0;
  const roomChars = Math.max(4, Math.floor((titles.length > 1 ? Math.min(step - 12 - 8, LABEL_PAD + 20) : LABEL_PAD) / CHAR_W));
  const originCell = (l: SankeyLink) => (l.origin === undefined ? '' : l.origin === REST_ORIGIN ? 'Other origins' : nodeName(l.origin));
  const colTitle = (c: number) => titles[c] ?? '';
  const linkKey = (l: SankeyLink) => `${l.pair}|${l.source}|${l.target}|${l.origin ?? ''}`;
  const hoverLink = { onMouseEnter: (e: SyntheticEvent) => light(e.currentTarget), onMouseLeave: () => light(), onFocus: (e: SyntheticEvent) => light(e.currentTarget), onBlur: () => light() };
  const hoverNode = (col: number, key: string) => ({ onMouseEnter: () => light(null, `${col}|${key}`), onMouseLeave: () => light(), onFocus: () => light(null, `${col}|${key}`), onBlur: () => light() });
  // Each column's total, once per layout: the exact total where `columns` gives the node, else what the layout holds. A node's share is of this.
  const colTotals = useMemo(() => {
    const exact = new Map((columns ?? []).flatMap((col, c) => col.filter((n) => n.value > 0).map((n): [string, number] => [`${c}|${n.key}`, n.value])));
    const sums: number[] = [];
    for (const n of layout.nodes) sums[n.col] = (sums[n.col] ?? 0) + (exact.get(`${n.col}|${n.key}`) ?? n.value);
    return sums;
  }, [layout, columns]);
  const share = (n: { col: number; value: number }) => { const t = colTotals[n.col] ?? 0; return t > 0 ? ` (${Math.round((n.value / t) * 100)}%)` : ''; };
  // The ribbons are built once per layout: hover touches the DOM only (see `light`), so thousands of paths and tooltips are not re-rendered by it.
  const ribbons = useMemo(() => {
    const totals = flows.map((pair) => pair.reduce((sum, f) => (f.value > 0 ? sum + f.value : sum), 0));
    const originName = (o: string) => (o === REST_ORIGIN ? 'other origins' : nodeName(o));
    return layout.links.map((l) => {
      const click = !!onPickLink && l.source !== OTHER_KEY && l.target !== OTHER_KEY;
      const pick = click ? { style: { cursor: 'pointer' }, onClick: () => onPickLink!(l.pair, l.source, l.target) } : {};
      const tip = `${nodeName(l.source)} → ${nodeName(l.target)}${l.pair > 0 && l.origin !== undefined ? ` (from ${originName(l.origin)})` : ''}: ${text(l.value)} (${Math.round((l.value / (totals[l.pair] || 1)) * 100)}%)`;
      return (
        <Tooltip key={linkKey(l)} content={tip}>
          <path className="dm-sankey-link" data-link={`${l.pair}|${l.source}|${l.target}${l.pair > 0 && l.origin !== undefined ? `|${l.origin}` : ''}`} data-from={`${l.pair}|${l.source}`} data-to={`${l.pair + 1}|${l.target}`} d={l.path} fill={thinColor(colorOf(l.tone))} {...hoverLink} {...pick} />
        </Tooltip>
      );
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the hover handlers are stable (`light` only touches the DOM)
  }, [layout, flows, onPickLink, text]);
  // Before the width is measured there is nothing to draw on.
  if (!drawable) return <div ref={ref} className="dm-sankey" />;
  return (
    <div ref={ref} className="dm-sankey">
      <svg ref={root} role={onPickNode || onPickLink ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${Math.max(120, width)} ${height}`}>
        {titles.map((t, c) => <CutLabel key={c} full={t} shown={clip(t, roomChars + 6)} className="dm-chart-axis-title" x={c * step} y={12} textAnchor="start" />)}
        <BlankDefs id={blankId} />
        <g transform={`translate(0 ${TOP})`}>
          <g>
            {ribbons}
          </g>
          {layout.nodes.map((n) => {
            const name = nodeName(n.key);
            const label = `${name} ${text(n.value)}`;
            const pickable = !!onPickNode && n.key !== OTHER_KEY;
            const pick = pickable ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${colTitle(n.col)}: ${name}`, style: { cursor: 'pointer' }, onClick: () => onPickNode!(n.col, n.key), onKeyDown: press(() => onPickNode!(n.col, n.key)) } : {};
            return (
              <g key={`${n.col}|${n.key}`}>
                <Tooltip content={`${name}: ${text(n.value)}${share(n)}`}>
                  <rect className="dm-sankey-node" data-node={`${n.col}|${n.key}`} x={n.x} y={n.y} width={n.w} height={Math.max(1, n.h)} fill={blankFill(colorOf(n.tone), blankId)} {...hoverNode(n.col, n.key)} {...pick} />
                </Tooltip>
                {n.h >= 12 && (label.length > roomChars
                  // A cut label shows its full text on hover; an uncut one stays out of the pointer's way so the ribbons under it stay hoverable.
                  ? <Tooltip content={`${label}${share(n)}`}><text className="dm-chart-text" x={n.x + n.w + 4} y={n.y + n.h / 2} dominantBaseline="middle">{clip(label, roomChars)}</text></Tooltip>
                  : <text className="dm-chart-text" x={n.x + n.w + 4} y={n.y + n.h / 2} dominantBaseline="middle" pointerEvents="none">{label}</text>)}
              </g>
            );
          })}
        </g>
      </svg>
      <table className="sr-only">
        <thead><tr><th>Columns</th><th>From (column 1)</th><th>From</th><th>To</th><th>Value</th></tr></thead>
        <tbody>{layout.links.map((l) => <tr key={linkKey(l)}><td>{colTitle(l.pair)} → {colTitle(l.pair + 1)}</td><td>{originCell(l)}</td><td>{nodeName(l.source)}</td><td>{nodeName(l.target)}</td><td>{text(l.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
