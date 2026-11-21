import { Waypoints } from 'lucide-react';
import { useMemo } from 'react';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { Row } from '../../sdk/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { pathOf, pieMeasures, sankeyMeasures } from '../fields';
import { sankeyColumnQuery, sankeyFlowQuery, sankeyLowQuery, SANKEY_COLUMN_LIMIT, SANKEY_FLOW_LIMIT, type Measure } from '../queries';
import { foldSankey } from '../sankeyFold';
import { measureLabel, measureOptions, measureText } from '../Scorecards';
import { measureId, pickMeasure, SANKEY_MAX, SANKEY_MIN } from '../settings';
import { Sankey } from '../svg/Sankey';
import { useChartQuery } from '../useChartQuery';
import { carry, type ChartKindDef, type PanelProps } from './types';

export const NEGATIVE_NOTE = 'Sankey needs values of 0 or more; this metric has negative values.';
export const cappedNote = (n: number): string => `Showing the largest ${n.toLocaleString('en-US')} combinations; smaller flows are left out.`;

export const columnCappedNote = (n: number): string => `A column has ${n.toLocaleString('en-US')} or more values; its smallest ones are not counted in Other.`;
export const NO_MEASURE_NOTE = "Pick columns from one data mart: another mart's metric or count would be counted once per joined row.";

/** `measure` is null when no metric fits the columns (see `sankeyMeasures`): the panel then draws nothing but the note. */
export type SankeyR = { dims: Field[]; measure: Measure | null };

/** A column's panel width: 11rem per column, at least 20rem, at most the band. */
export const sankeyWidth = (columns: number): string => `clamp(20rem, ${columns * 11}rem, 100%)`;

/** The dimensions after a change of one column: picking one that another column holds swaps the two. */
export const setColumn = (names: string[], at: number, name: string): string[] => {
  const next = [...names];
  const from = next.indexOf(name);
  if (from >= 0 && from !== at) next[from] = next[at]!;
  next[at] = name;
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

function SankeyPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<SankeyR>) {
  const { dims, measure } = r;
  const n = dims.length;
  const off = idle || !measure;
  // One flow read and one total read per column: always 1 + 5 hooks, the unused ones get a null query. A sixth, one row, only when the flow read is capped.
  const flow = useChartQuery(martId, off ? null : sankeyFlowQuery(dims, measure, filter, cf.counter), version);
  const capped = !!flow.rows && flow.rows.length >= SANKEY_FLOW_LIMIT;
  const low = useChartQuery(martId, off || !capped ? null : sankeyLowQuery(dims, measure, filter, cf.counter), version);
  const useCol = (i: number) => useChartQuery(martId, off || i >= n ? null : sankeyColumnQuery(dims[i]!, measure, filter, cf.counter), version);
  const all = [useCol(0), useCol(1), useCol(2), useCol(3), useCol(4)];
  const cols = all.slice(0, n);
  const failed = [flow, low, ...cols].find((q) => q.error);
  const settled = !off && !!flow.rows && (!capped || !!low.rows) && cols.every((q) => !!q.rows);
  const data = useMemo(() => {
    const columnRows = all.slice(0, n).map((q) => q.rows);
    return measure && flow.rows && (!capped || low.rows) && columnRows.every((x) => x !== null) ? foldSankey({ flowRows: flow.rows, lowRows: low.rows ?? undefined, columnRows: columnRows as Row[][], dims, measure }) : null;
    // `all` is rebuilt each render; its five row sets are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.rows, low.rows, capped, all[0]!.rows, all[1]!.rows, all[2]!.rows, all[3]!.rows, all[4]!.rows, n, dims, measure]);
  const empty = settled && !!data && (data.negative || data.empty);
  const loading = !!measure && !empty && !failed && !data;
  const names = dims.map((d) => d.name);
  const maxColumns = Math.min(SANKEY_MAX, cf.dimensions.length);
  const dimOptions = cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) }));
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Columns', value: String(n), options: Array.from({ length: maxColumns - SANKEY_MIN + 1 }, (_, i) => ({ value: String(SANKEY_MIN + i), label: String(SANKEY_MIN + i) })),
      onPick: (v) => onChange({ dimensions: withColumns(names, Number(v), cf.dimensions) }) },
    ...dims.map((d, i): MenuItem => ({ kind: 'radio', label: `Column ${i + 1}`, value: d.name, options: dimOptions, onPick: (v) => onChange({ dimensions: setColumn(names, i, v) }) })),
    ...(measure ? [{ kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, sankeyMeasures(cf, dims)), onPick: (v: string) => onChange({ measure: v }) } as MenuItem] : []),
    ...tail,
  ];
  const title = sankey.title(r, cf);
  return (
    <ChartPanel title={title} name="Sankey" items={ready ? items : null} width={sankeyWidth(n)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={!measure ? NO_MEASURE_NOTE : empty ? (data!.negative ? NEGATIVE_NOTE : emptyText(hasFilters)) : null}
      note={data && !data.negative ? [data.capped ? cappedNote(SANKEY_FLOW_LIMIT) : '', data.columnCapped ? columnCappedNote(SANKEY_COLUMN_LIMIT) : ''].filter(Boolean).join(' ') || undefined : undefined}>
      {data && <Sankey titles={dims.map(columnTitle)} columns={data.columns} flows={data.flows} ariaLabel={title} text={(v) => measureText(measure!, v, formatOf)}
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
    return { kind: 'sankey', ...carry(from, ['measure']), dimensions: withColumns([...new Set(saved)].slice(0, SANKEY_MAX), Math.max(SANKEY_MIN, Math.min(saved.length, SANKEY_MAX)), cf.dimensions) };
  },
  resolve(spec, cf) {
    const count = Math.min(Math.max(spec.dimensions?.length ?? SANKEY_MIN, SANKEY_MIN), SANKEY_MAX, cf.dimensions.length);
    if (pieMeasures(cf).length === 0 || count < SANKEY_MIN) return null;
    // Each column keeps its saved dimension when it is shown and not held by an earlier column, else takes the next unused one.
    const dims: Field[] = [];
    for (let i = 0; i < count; i++) {
      const saved = cf.dimensions.find((d) => d.name === spec.dimensions?.[i] && !dims.includes(d));
      const fresh = cf.dimensions.filter((d) => !dims.includes(d));
      const next = saved ?? fresh.find((d) => !dims[0] || pathOf(d) === pathOf(dims[0])) ?? fresh[0];
      if (next) dims.push(next);
    }
    // A saved Count Unique (or any measure) the columns cannot sum falls back to the first that fits for display; the saved choice is not rewritten.
    return { dims, measure: pickMeasure(sankeyMeasures(cf, dims), spec.measure) };
  },
  title: (r, cf) => `${r.measure ? measureLabel(cf, r.measure) : 'Sankey'} by ${r.dims.map(fieldLabel).join(' → ')}`,
  Panel: SankeyPanel,
};
