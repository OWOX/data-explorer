import { Columns3, EllipsisVertical, Waypoints } from 'lucide-react';
import { useMemo } from 'react';
import { fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { Row } from '../../sdk/types';
import type { MenuItem } from '../ChartMenu';
import { axisTitle, fieldGroups, metricItem } from '../menuGroups';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { menuOf, pathOf, pieMeasures, sankeyMeasures } from '../fields';
import { sankeyColumnQuery, sankeyFlowQuery, sankeyLowQuery, SANKEY_COLUMN_LIMIT, SANKEY_FLOW_LIMIT, type Measure } from '../queries';
import { foldSankey } from '../sankeyFold';
import { measureLabel, measureText } from '../Scorecards';
import { measureId, pickMeasure, SANKEY_MAX, SANKEY_MIN } from '../settings';
import { Sankey } from '../svg/Sankey';
import { useChartQuery } from '../useChartQuery';
import { carry, type ChartKindDef, type PanelProps } from './types';

const NEGATIVE_NOTE = 'Sankey needs values of 0 or more; this metric has negative values.';
const MISCONFIGURED_NOTE = 'This Sankey is misconfigured: pick at least 2 columns in its menu.';
const cappedNote = (n: number): string => `Showing the largest ${n.toLocaleString('en-US')} combinations; smaller flows are left out.`;

const columnCappedNote = (n: number): string => `A column has ${n.toLocaleString('en-US')} or more values; its smallest ones are not counted in Other.`;
/** The Sankey's numbers (labels, tooltips, the screen-reader table) drop the fraction above 10: shares and flows are read at a glance, not to the cent. */
const SANKEY_TEXT = { whole: true } as const;
export const FAN_OUT_NOTE = "One record can sit in more than one ribbon here, so ribbons can add up to more than their column total. A node's share is of its column's values added up, not of the metric's total.";

/**
 * `exact` is true when the measure passes `sankeyMeasures` for the columns: no join can repeat a record, so the plugin's sums (one all-columns flow read,
 * Other) are exact. Otherwise it is fan-out mode: flows are read per adjacent pair and the ribbons can overlap (see `foldSankey`).
 */
type SankeyR = { dims: Field[]; measure: Measure; exact: boolean };

/** The panel's width: 20rem per column, at least 20rem, at most the band. */
export const sankeyWidth = (columns: number): string => `clamp(20rem, ${columns * 20}rem, 100%)`;

/**
 * The dimensions after a pick in column `at` (0-based; a column past the end is unused). The saved list never has gaps:
 * - '' (None) takes a used column out and the later ones move up, down to none (a Sankey with fewer than SANKEY_MIN columns shows a notice); on an unused column it changes nothing.
 * - A name in a used column replaces it; a name another column holds swaps the two.
 * - A name in an unused column is appended; one another column holds moves to the end.
 */
export const setColumn = (names: string[], at: number, name: string): string[] => {
  if (name === '') return at < names.length ? names.filter((_, i) => i !== at) : names;
  if (at >= names.length) return [...names.filter((n) => n !== name), name];
  const next = [...names];
  const from = next.indexOf(name);
  if (from >= 0 && from !== at) next[from] = next[at]!;
  next[at] = name;
  return next;
};

/** The columns with the one at `from` moved to place `to`; the same list when either is out of range. */
export const moveColumn = (names: string[], from: number, to: number): string[] => {
  if (from < 0 || to < 0 || from >= names.length || to >= names.length || from === to) return names;
  const next = [...names];
  const [one] = next.splice(from, 1);
  next.splice(to, 0, one!);
  return next;
};

/** `count` columns: the first ones kept, a new one filled with the next dimension no column holds. */
export const withColumns = (names: string[], count: number, all: Field[]): string[] => {
  const next = names.slice(0, count);
  // A new column prefers the first column's data mart: columns from one mart keep a metric available.
  const anchor = all.find((d) => d.name === next[0]);
  const fresh = all.filter((d) => !next.includes(d.name));
  const ordered = anchor ? [...fresh.filter((d) => pathOf(d) === pathOf(anchor)), ...fresh.filter((d) => pathOf(d) !== pathOf(anchor))] : fresh;
  for (const d of ordered) if (next.length < count) next.push(d.name);
  return next;
};

function SankeyPanel({ martId, cf, title, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<SankeyR>) {
  const { dims, measure, exact } = r;
  const n = dims.length;
  // Fewer than two columns draws nothing and reads nothing: the notice says what to pick.
  const short = n < SANKEY_MIN;
  const off = idle || short;
  // Fixed hooks, unused ones get a null query. Exact mode: one flow read on all columns (+ a few-row read when it is capped; a count is never negative).
  // Fan-out mode: one flow read per adjacent pair (up to SANKEY_MAX - 1), each with its own few-row read when capped. Always one total read per column.
  const capped = (rows: Row[] | null) => !!rows && rows.length >= SANKEY_FLOW_LIMIT && measure.kind === 'metric';
  const flow = useChartQuery(martId, off || !exact ? null : sankeyFlowQuery(dims, measure, filter, cf.counter), version);
  const low = useChartQuery(martId, off || !exact || !capped(flow.rows) ? null : sankeyLowQuery(dims, measure, filter, cf.counter), version);
  const pairQuery = (i: number) => (off || exact || i >= n - 1 ? null : [dims[i]!, dims[i + 1]!] as const);
  const usePair = (i: number) => { const p = pairQuery(i); return useChartQuery(martId, p ? sankeyFlowQuery([...p], measure, filter, cf.counter) : null, version); };
  const pairs = [usePair(0), usePair(1), usePair(2), usePair(3)];
  const usePairLow = (i: number) => { const p = pairQuery(i); return useChartQuery(martId, p && capped(pairs[i]!.rows) ? sankeyLowQuery([...p], measure, filter, cf.counter) : null, version); };
  const pairLows = [usePairLow(0), usePairLow(1), usePairLow(2), usePairLow(3)];
  const useCol = (i: number) => useChartQuery(martId, off || i >= n ? null : sankeyColumnQuery(dims[i]!, measure, filter, cf.counter), version);
  const all = [useCol(0), useCol(1), useCol(2), useCol(3), useCol(4)];
  const cols = all.slice(0, n);
  const usedPairs = pairs.slice(0, Math.max(0, n - 1));
  const usedLows = pairLows.slice(0, Math.max(0, n - 1));
  const failed = [flow, low, ...usedPairs, ...usedLows, ...cols].find((q) => q.error);
  const flowsIn = exact ? !!flow.rows && (!capped(flow.rows) || !!low.rows) : usedPairs.every((q, i) => !!q.rows && (!capped(q.rows) || !!usedLows[i]!.rows));
  const settled = !off && flowsIn && cols.every((q) => !!q.rows);
  const data = useMemo(() => {
    const columnRows = all.slice(0, n).map((q) => q.rows);
    if (short || !flowsIn || !columnRows.every((x) => x !== null)) return null;
    if (exact) return foldSankey({ flowRows: flow.rows!, lowRows: low.rows ?? undefined, columnRows: columnRows as Row[][], dims, measure });
    return foldSankey({ pairRows: usedPairs.map((q) => q.rows!), pairLowRows: usedLows.map((q) => q.rows), columnRows: columnRows as Row[][], dims, measure });
    // `all`, `pairs` and `pairLows` are rebuilt each render; their row sets are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowsIn, exact, flow.rows, low.rows, pairs[0]!.rows, pairs[1]!.rows, pairs[2]!.rows, pairs[3]!.rows, pairLows[0]!.rows, pairLows[1]!.rows, pairLows[2]!.rows, pairLows[3]!.rows, all[0]!.rows, all[1]!.rows, all[2]!.rows, all[3]!.rows, all[4]!.rows, n, short, dims, measure]);
  const empty = short || (settled && !!data && (data.negative || data.empty));
  const loading = !empty && !failed && !data;
  const names = dims.map((d) => d.name);
  const dimGroups = fieldGroups(menuOf(cf), menuOf(cf).dimensions);
  // Five columns always, each with None first: a used one takes the column out, an unused one has None checked and picking a dimension appends it.
  const columnItems = Array.from({ length: SANKEY_MAX }, (_, i): MenuItem => {
    const used = i < n;
    return { kind: 'radio', label: `Column ${i + 1}`, icon: EllipsisVertical, value: used ? names[i]! : '', groups: dimGroups,
      options: [{ value: '', label: 'None' }],
      onPick: (v) => { const next = setColumn(names, i, v); if (next.join('\n') !== names.join('\n')) onChange({ dimensions: next }); } };
  });
  const items: MenuItem[] = [
    { kind: 'group', label: 'Columns', icon: Columns3, items: columnItems, draggable: n,
      onReorder: (from, to) => { const next = moveColumn(names, from, to); if (next.join('\n') !== names.join('\n')) onChange({ dimensions: next }); } },
    metricItem(cf, measureId(measure), pieMeasures(menuOf(cf)), onChange),
    ...tail,
  ];
  // Memoised on its inputs so a re-render with the same columns and metric keeps the ribbons.
  const ribbonShare = useMemo(() => dims.map((d) => sankeyMeasures(cf, [d]).some((m) => measureId(m) === measureId(measure))), [cf, dims, measure]);
  return (
    <ChartPanel title={title} name="Sankey" items={items} ready={ready} width={sankeyWidth(n)}
      loading={loading} failed={failed} empty={empty && (short ? MISCONFIGURED_NOTE : data!.negative ? NEGATIVE_NOTE : true)} hasFilters={hasFilters}
      note={data && !data.negative ? [data.capped ? cappedNote(SANKEY_FLOW_LIMIT) : '', data.columnCapped ? columnCappedNote(SANKEY_COLUMN_LIMIT) : '', exact ? '' : FAN_OUT_NOTE].filter(Boolean).join(' ') || undefined : undefined}>
      {data && <Sankey titles={dims.map((d) => axisTitle(cf, d))} columns={data.columns} flows={data.flows} fit={!exact} ribbonShare={ribbonShare} ariaLabel={title} text={(v) => measureText(measure, v, formatOf, SANKEY_TEXT)}
        onPickNode={(col, key) => onFilter([dimensionFilter(dims[col]!, key)])}
        onPickLink={(pair, source, target) => onFilter([dimensionFilter(dims[pair]!, source), dimensionFilter(dims[pair + 1]!, target)])} />}
    </ChartPanel>
  );
}

export const sankey: ChartKindDef<SankeyR> = {
  kind: 'sankey',
  label: 'Sankey',
  icon: Waypoints,
  eligible: (cf) => cf.dimensions.length >= SANKEY_MIN && pieMeasures(cf).length > 0,
  create: (cf, from) => {
    const saved = from?.dimensions ?? [from?.dimension, from?.dimension2, from?.stack].filter((x): x is string => !!x);
    // A Sankey switched to a Sankey keeps its columns as they are, none included.
    if (from?.kind === 'sankey' && from.dimensions) return { kind: 'sankey', ...carry(from, ['measure']), dimensions: [...new Set(from.dimensions)].slice(0, SANKEY_MAX) };
    return { kind: 'sankey', ...carry(from, ['measure']), dimensions: withColumns([...new Set(saved)].slice(0, SANKEY_MAX), Math.max(SANKEY_MIN, Math.min(saved.length, SANKEY_MAX)), cf.dimensions) };
  },
  resolve(spec, cf) {
    const offered = pieMeasures(cf);
    if (offered.length === 0) return null;
    const saved = spec.dimensions;
    // Fewer than two saved columns is the member's choice (None): nothing is filled in, and a saved column that is not shown counts as unused.
    const shownSaved = saved && saved.length < SANKEY_MIN ? [...new Set(saved)].flatMap((n) => cf.dimensions.filter((d) => d.name === n)) : null;
    const count = Math.min(Math.max(saved?.length ?? SANKEY_MIN, SANKEY_MIN), SANKEY_MAX, cf.dimensions.length);
    if (!shownSaved && count < SANKEY_MIN) return null;
    // Each column keeps its saved dimension when it is shown and not held by an earlier column, else takes the next unused one.
    const dims: Field[] = shownSaved ?? [];
    for (let i = 0; i < (shownSaved ? 0 : count); i++) {
      const held = cf.dimensions.find((d) => d.name === spec.dimensions?.[i] && !dims.includes(d));
      const fresh = cf.dimensions.filter((d) => !dims.includes(d));
      const next = held ?? fresh.find((d) => !dims[0] || pathOf(d) === pathOf(dims[0])) ?? fresh[0];
      if (next) dims.push(next);
    }
    // Any additive measure is offered. A saved one is kept; with none saved, one that is exact for the columns comes first (see `SankeyR`).
    const exactList = sankeyMeasures(cf, dims);
    const measure = offered.find((m) => measureId(m) === spec.measure) ?? pickMeasure(exactList.length ? exactList : offered)!;
    return { dims, measure, exact: exactList.some((m) => measureId(m) === measureId(measure)) };
  },
  title: (r, cf) => `${r.dims.length ? `${measureLabel(cf, r.measure)} by ${r.dims.map(fieldLabel).join(' → ')}` : `Sankey · ${measureLabel(cf, r.measure)}`}`,
  Panel: SankeyPanel,
};
