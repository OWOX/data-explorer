import { useMemo, useState, type KeyboardEvent } from 'react';
import { Tooltip } from '../../ui/Tooltip';
import { BLANK_COLOR, labelOf, OTHER_KEY } from '../blank';
import { layoutSankey, type Flow, type SankeyLink, type SankeyNode, type Tone } from '../sankeyLayout';
import { OTHER_COLOR, seriesColor } from '../useDateSeries';
import { useWidth } from '../useWidth';

const TOP = 22;
const LABEL_PAD = 110;
const CHAR_W = 6;
const SERIES = 8;
const press = (fn: () => void) => (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } };
const colorOf = (t: Tone): string => (t.kind === 'blank' ? BLANK_COLOR : t.kind === 'other' ? OTHER_COLOR : seriesColor(t.index % SERIES));
const nodeName = (key: string): string => (key === OTHER_KEY ? 'Other' : labelOf(key));
const clip = (text: string, max: number): string => (text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`);

type Hot = { kind: 'node'; col: number; key: string } | { kind: 'link'; at: number } | null;

/**
 * Columns of nodes joined by ribbons. `flows[i]` are the flows from column i to i+1 (read apart, so a node is as tall as the larger of its in and out);
 * `text` formats a value. A node click gives its column and key, a ribbon click its pair and both keys; "Other" is never clickable.
 */
export function Sankey({ titles, flows, text, ariaLabel, onPickNode, onPickLink }: {
  titles: string[]; flows: Flow[][]; text: (value: number) => string; ariaLabel: string;
  onPickNode?: (col: number, key: string) => void; onPickLink?: (pair: number, source: string, target: string) => void;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [hot, setHot] = useState<Hot>(null);
  const layout = useMemo(() => layoutSankey({ flows, width: Math.max(120, width), padRight: LABEL_PAD }), [flows, width]);
  const height = TOP + layout.height + 4;
  const step = titles.length > 1 ? (Math.max(120, width) - LABEL_PAD - 12) / (titles.length - 1) : 0;
  const roomChars = Math.max(4, Math.floor((titles.length > 1 ? Math.min(step - 12 - 8, LABEL_PAD + 20) : LABEL_PAD) / CHAR_W));
  const total = (pair: number) => flows[pair]!.reduce((s, f) => (f.value > 0 ? s + f.value : s), 0);
  const related = (l: SankeyLink, i: number): boolean => !hot || (hot.kind === 'link' ? hot.at === i : (hot.col === l.pair && hot.key === l.source) || (hot.col === l.pair + 1 && hot.key === l.target));
  const nodeHot = (n: SankeyNode): boolean => hot?.kind === 'node' && hot.col === n.col && hot.key === n.key;
  const linkLabel = (l: SankeyLink) => `${nodeName(l.source)} → ${nodeName(l.target)}`;
  const hover = (h: Hot) => ({ onMouseEnter: () => setHot(h), onMouseLeave: () => setHot(null), onFocus: () => setHot(h), onBlur: () => setHot(null) });
  return (
    <div ref={ref} className="dm-sankey">
      <svg role={onPickNode || onPickLink ? 'group' : 'img'} aria-label={ariaLabel} width="100%" height={height} viewBox={`0 0 ${Math.max(120, width)} ${height}`}>
        {titles.map((t, c) => <text key={c} className="dm-chart-axis-title" x={c * step} y={12} textAnchor="start">{clip(t, roomChars + 6)}</text>)}
        <g transform={`translate(0 ${TOP})`}>
          <g>
            {layout.links.map((l, i) => {
              const content = `${linkLabel(l)}: ${text(l.value)} (${Math.round((l.value / total(l.pair)) * 100)}%)`;
              const pickable = !!onPickLink && l.source !== OTHER_KEY && l.target !== OTHER_KEY;
              const pick = pickable ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${linkLabel(l)}`, style: { cursor: 'pointer' }, onClick: () => onPickLink!(l.pair, l.source, l.target), onKeyDown: press(() => onPickLink!(l.pair, l.source, l.target)) } : {};
              return (
                <Tooltip key={`${l.pair}|${l.source}|${l.target}`} content={content}>
                  <path className="dm-sankey-link" data-link={`${l.pair}|${l.source}|${l.target}`} d={l.path} fill={colorOf(l.tone)} fillOpacity={hot ? (related(l, i) ? 0.7 : 0.12) : 0.4} {...hover({ kind: 'link', at: i })} {...pick} />
                </Tooltip>
              );
            })}
          </g>
          {layout.nodes.map((n) => {
            const name = nodeName(n.key);
            const label = `${name} ${text(n.value)}`;
            const pickable = !!onPickNode && n.key !== OTHER_KEY;
            const pick = pickable ? { role: 'button', tabIndex: 0, 'aria-label': `Filter to ${name}`, style: { cursor: 'pointer' }, onClick: () => onPickNode!(n.col, n.key), onKeyDown: press(() => onPickNode!(n.col, n.key)) } : {};
            return (
              <g key={`${n.col}|${n.key}`}>
                <Tooltip content={`${name}: ${text(n.value)}`}>
                  <rect className="dm-sankey-node" data-node={`${n.col}|${n.key}`} x={n.x} y={n.y} width={n.w} height={Math.max(1, n.h)} fill={colorOf(n.tone)} stroke={nodeHot(n) ? 'var(--foreground)' : undefined} {...hover({ kind: 'node', col: n.col, key: n.key })} {...pick} />
                </Tooltip>
                {n.h >= 12 && (
                  <text className="dm-chart-text" x={n.x + n.w + 4} y={n.y + n.h / 2} dominantBaseline="middle" pointerEvents="none">
                    <title>{label}</title>
                    {clip(label, roomChars)}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <table className="sr-only">
        <thead><tr><th>From</th><th>To</th><th>Value</th></tr></thead>
        <tbody>{layout.links.map((l) => <tr key={`${l.pair}|${l.source}|${l.target}`}><td>{nodeName(l.source)}</td><td>{nodeName(l.target)}</td><td>{text(l.value)}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
