import { Waypoints } from 'lucide-react';
import { columnTitle, fieldLabel } from '../../model/fieldLabel';
import type { Field } from '../../model/types';
import type { TraverseFilter } from '../../sdk/types';
import { emptyText } from '../../ui/format';
import type { MenuItem } from '../ChartMenu';
import { ChartPanel } from '../ChartPanel';
import { BLANK_KEY, keyOf, OTHER_KEY } from '../blank';
import { dimensionFilter } from '../clickFilters';
import { pieMeasures } from '../fields';
import { measureKey, sankeyPairQuery, type Measure, type SankeySide } from '../queries';
import type { Flow } from '../sankeyLayout';
import { measureLabel, measureOptions, measureText, numberOf } from '../Scorecards';
import { measureId, pickMeasure, SANKEY_MAX, SANKEY_MIN } from '../settings';
import { Sankey } from '../svg/Sankey';
import { useChartQuery } from '../useChartQuery';
import { useTopValues, type TopValues } from '../useTopValues';
import { carry, type ChartKindDef, type PanelProps } from './types';

export type SankeyR = { dims: Field[]; measure: Measure };

/** A column's panel width: 11rem per column, at least 20rem, at most the band. */
export const sankeyWidth = (columns: number): string => `clamp(20rem, ${columns * 11}rem, 100%)`;

/** The three ways a column's rows are read, in the order a pair's slots run: its listed values, its blank value, the values outside the list. Undefined when the column has none of that kind. */
const sidesOf = (top: TopValues): (SankeySide | undefined)[] => [
  top.names?.length ? { kind: 'in', top: top.names } : undefined,
  top.categories?.some((c) => c.key === BLANK_KEY) ? { kind: 'blank' } : undefined,
  top.other != null && top.names ? { kind: 'other', top: top.names } : undefined,
];

/**
 * The flows between two neighbouring columns: one read per (side of a, side of b), so up to 3 x 3 = 9 and usually 1 to 4
 * (the listed values on both sides; then Other / blank where a column has them). A list cannot name NULL, so blank is read apart; Other is `not_in`.
 */
function usePair({ martId, cf, a, b, ta, tb, measure, filter, version, on }: {
  martId: string; cf: PanelProps<SankeyR>['cf']; a: Field | undefined; b: Field | undefined; ta: TopValues; tb: TopValues;
  measure: Measure; filter: TraverseFilter[]; version: number; on: boolean;
}) {
  const A = sidesOf(ta);
  const B = sidesOf(tb);
  const useRead = (slot: number) => {
    const sa = A[Math.floor(slot / 3)];
    const sb = B[slot % 3];
    return { sa, sb, q: useChartQuery(martId, on && a && b && sa && sb ? sankeyPairQuery(a, sa, b, sb, measure, filter, cf.counter) : null, version) };
  };
  const reads = [useRead(0), useRead(1), useRead(2), useRead(3), useRead(4), useRead(5), useRead(6), useRead(7), useRead(8)];
  const failed = reads.map((x) => x.q).find((q) => q.error);
  const settled = on && reads.every((x) => x.q.rows || x.q.loading === false);
  const key = measureKey(measure);
  const sum = new Map<string, Flow>();
  if (a && b) {
    for (const { sa, sb, q } of reads) {
      for (const row of q.rows ?? []) {
        const value = numberOf(row[key]);
        if (!sa || !sb || value === null || value <= 0) continue;
        const source = sa.kind === 'in' ? keyOf(row[a.name]) : sa.kind === 'blank' ? BLANK_KEY : OTHER_KEY;
        const target = sb.kind === 'in' ? keyOf(row[b.name]) : sb.kind === 'blank' ? BLANK_KEY : OTHER_KEY;
        const id = `${source}\u0001${target}`;
        sum.set(id, { source, target, value: (sum.get(id)?.value ?? 0) + value });
      }
    }
  }
  return { flows: [...sum.values()], settled, failed };
}

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
  const useCol = (i: number) => useTopValues({ martId, cf, dim: dims[i] ?? dims[0]!, measure, filter, version, idle: idle || i >= n });
  const tops = [useCol(0), useCol(1), useCol(2), useCol(3), useCol(4)];
  const known = (i: number) => !!tops[i]!.categories && !tops[i]!.loading;
  const usePairOf = (i: number) => usePair({ martId, cf, a: dims[i], b: dims[i + 1], ta: tops[i]!, tb: tops[i + 1]!, measure, filter, version, on: !idle && i + 1 < n && known(i) && known(i + 1) });
  const pairs = [usePairOf(0), usePairOf(1), usePairOf(2), usePairOf(3)].slice(0, n - 1);
  const topsShown = tops.slice(0, n);
  const failed = [...topsShown.map((t) => t.failed), ...pairs.map((p) => p.failed)].find((q) => q && q.error);
  const settled = !idle && pairs.every((p) => p.settled);
  const empty = topsShown.some((t) => t.empty) || (settled && pairs.every((p) => p.flows.length === 0));
  const loading = !empty && !failed && !settled;
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
  const title = `${measureLabel(cf, measure)} by ${dims.map(fieldLabel).join(' → ')}`;
  return (
    <ChartPanel title={title} name="Sankey" items={ready ? items : null} width={sankeyWidth(n)}
      loading={loading} error={failed?.error} onRetry={failed?.retry ?? (() => {})} empty={empty ? emptyText(hasFilters) : null}>
      {settled && <Sankey titles={dims.map(columnTitle)} flows={pairs.map((p) => p.flows)} ariaLabel={title} text={(v) => measureText(measure, v, formatOf)}
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
    const saved = from?.dimensions ?? [from?.dimension, from?.dimension2].filter((x): x is string => !!x);
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
