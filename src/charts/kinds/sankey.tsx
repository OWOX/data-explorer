import { Waypoints } from 'lucide-react';
import { useMemo } from 'react';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { Row } from '../../sdk/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { dimensionFilter } from '../clickFilters';
import { pieMeasures } from '../fields';
import { sankeyColumnQuery, sankeyFlowQuery, SANKEY_FLOW_LIMIT, type Measure } from '../queries';
import { foldSankey } from '../sankeyFold';
import { measureLabel, measureOptions, measureText } from '../Scorecards';
import { measureId, pickMeasure, SANKEY_MAX, SANKEY_MIN } from '../settings';
import { Sankey } from '../svg/Sankey';
import { useChartQuery } from '../useChartQuery';
import { carry, type ChartKindDef, type PanelProps } from './types';

export const NEGATIVE_NOTE = 'Sankey needs values of 0 or more; this metric has negative values.';
export const cappedNote = (n: number): string => `Showing the largest ${n.toLocaleString('en-US')} combinations; smaller flows are left out.`;

export type SankeyR = { dims: Field[]; measure: Measure };

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
  for (const d of all) if (next.length < count && !next.includes(d.name)) next.push(d.name);
  return next;
};

function SankeyPanel({ martId, cf, r, filter, version, idle, hasFilters, formatOf, ready, tail, onChange, onFilter }: PanelProps<SankeyR>) {
  const { dims, measure } = r;
  const n = dims.length;
  // One flow read and one total read per column: always 1 + 5 hooks, the unused ones get a null query.
  const flow = useChartQuery(martId, idle ? null : sankeyFlowQuery(dims, measure, filter, cf.counter), version);
  const useCol = (i: number) => useChartQuery(martId, idle || i >= n ? null : sankeyColumnQuery(dims[i]!, measure, filter, cf.counter), version);
  const all = [useCol(0), useCol(1), useCol(2), useCol(3), useCol(4)];
  const cols = all.slice(0, n);
  const failed = [flow, ...cols].find((q) => q.error);
  const settled = !idle && !!flow.rows && cols.every((q) => !!q.rows);
  const data = useMemo(() => {
    const columnRows = all.slice(0, n).map((q) => q.rows);
    return flow.rows && columnRows.every((x) => x !== null) ? foldSankey({ flowRows: flow.rows, columnRows: columnRows as Row[][], dims, measure }) : null;
    // `all` is rebuilt each render; its five row sets are the dependencies.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.rows, all[0]!.rows, all[1]!.rows, all[2]!.rows, all[3]!.rows, all[4]!.rows, n, dims, measure]);
  const empty = settled && !!data && (data.negative || data.empty);
  const loading = !empty && !failed && !data;
  const names = dims.map((d) => d.name);
  const maxColumns = Math.min(SANKEY_MAX, cf.dimensions.length);
  const dimOptions = cf.dimensions.map((d) => ({ value: d.name, label: columnTitle(d) }));
  const items: MenuItem[] = [
    { kind: 'radio', label: 'Columns', value: String(n), options: Array.from({ length: maxColumns - SANKEY_MIN + 1 }, (_, i) => ({ value: String(SANKEY_MIN + i), label: String(SANKEY_MIN + i) })),
      onPick: (v) => onChange({ dimensions: withColumns(names, Number(v), cf.dimensions) }) },
    ...dims.map((d, i): MenuItem => ({ kind: 'radio', label: `Column ${i + 1}`, value: d.name, options: dimOptions, onPick: (v) => onChange({ dimensions: setColumn(names, i, v) }) })),
    { kind: 'radio', label: 'Metric', value: measureId(measure), options: measureOptions(cf, pieMeasures(cf)), onPick: (v) => onChange({ measure: v }) },
    ...tail,
  ];
  const title = sankey.title(r, cf);
  return (
    <ChartPanel title={title} name="Sankey" items={ready ? items : null} width={sankeyWidth(n)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? (data!.negative ? NEGATIVE_NOTE : emptyText(hasFilters)) : null}
      note={data?.capped && !data.negative ? cappedNote(SANKEY_FLOW_LIMIT) : undefined}>
      {data && <Sankey titles={dims.map(columnTitle)} columns={data.columns} flows={data.flows} ariaLabel={title} text={(v) => measureText(measure, v, formatOf)}
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
    const measure = pickMeasure(pieMeasures(cf), spec.measure);
    const count = Math.min(Math.max(spec.dimensions?.length ?? SANKEY_MIN, SANKEY_MIN), SANKEY_MAX, cf.dimensions.length);
    if (!measure || count < SANKEY_MIN) return null;
    // Each column keeps its saved dimension when it is shown and not held by an earlier column, else takes the next unused one.
    const dims: Field[] = [];
    for (let i = 0; i < count; i++) {
      const saved = cf.dimensions.find((d) => d.name === spec.dimensions?.[i] && !dims.includes(d));
      const next = saved ?? cf.dimensions.find((d) => !dims.includes(d));
      if (next) dims.push(next);
    }
    return { dims, measure };
  },
  title: (r, cf) => `${measureLabel(cf, r.measure)} by ${r.dims.map(fieldLabel).join(' → ')}`,
  Panel: SankeyPanel,
};
