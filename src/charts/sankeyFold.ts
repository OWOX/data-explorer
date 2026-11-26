// The Sankey's one client-side sum (decision 7 in the chart-list spec): one grouped read is folded into each column's top values, (blank) and Other.
// Additive measures only (pieMeasures), so adding rows is the same number the backend would give.
import type { Field } from '../model/types';
import type { Row } from '../sdk/types';
import { BLANK_KEY, keyOf, OTHER_KEY } from './blank';
import { measureKey, SANKEY_COLUMN_LIMIT, SANKEY_FLOW_LIMIT, TOP_N, type Measure } from './queries';
import type { Flow } from './sankeyLayout';
import { numberOf } from './Scorecards';

/** One node of a column: its key (a value, BLANK_KEY or OTHER_KEY) and its exact total. */
export type ColumnNode = { key: string; value: number };

export type SankeyData = {
  /** Per column: the blank node first, then the top values by total, Other last. Zero totals are left out. */
  columns: ColumnNode[][];
  /** `flows[i]` runs from column i to i+1, one per (origin, source, target); `origin` is the node in column 0 the flow came from. */
  flows: Flow[][];
  /** Some value (a column total or a flow) is below 0: a Sankey cannot draw it. */
  negative: boolean;
  /** The flow read filled its row cap, so smaller combinations are missing from `flows`. */
  capped: boolean;
  /** A column's total read filled its cap, so its smallest values were never read and its Other counts only the values read. */
  columnCapped: boolean;
  /** Some column has no rows, or no flow is positive. */
  empty: boolean;
};

/**
 * A column's nodes from its total read. The top TOP_N real values by total are listed; the blank value is its own node; Other is the grand total
 * minus the listed and the blank (summed as the rows beyond the top, which is the same number). If the read hit its cap the smallest values were
 * never returned, so Other counts only the values read.
 */
export function foldColumn(rows: Row[], dim: Field, measure: Measure): { nodes: ColumnNode[]; listed: Set<string>; negative: boolean; capped: boolean } {
  const key = measureKey(measure);
  let negative = false;
  let blank = 0;
  const real: ColumnNode[] = [];
  for (const row of rows) {
    const v = numberOf(row[key]) ?? 0;
    if (v < 0) negative = true;
    const k = keyOf(row[dim.name]);
    if (k === BLANK_KEY) blank += v;
    else real.push({ key: k, value: v });
  }
  real.sort((a, b) => b.value - a.value);
  const top = real.slice(0, TOP_N);
  const other = real.slice(TOP_N).reduce((s, n) => s + n.value, 0);
  const nodes = [{ key: BLANK_KEY, value: blank }, ...top, { key: OTHER_KEY, value: other }].filter((n) => n.value > 0);
  return { nodes, listed: new Set(top.map((n) => n.key)), negative, capped: rows.length >= SANKEY_COLUMN_LIMIT };
}

/** The node a value belongs to in a column: blank, one of the listed values, or Other. */
const nodeOf = (v: unknown, listed: Set<string>): string => { const k = keyOf(v); return k === BLANK_KEY ? k : listed.has(k) ? k : OTHER_KEY; };

/**
 * Flow rows and column rows to nodes and flows. Exact mode (`flowRows`, one read grouped on all columns): each row is mapped column by column,
 * then summed per adjacent pair (and per first-column origin).
 * Fan-out mode (`pairRows`, one read per adjacent pair, `pairLowRows` their few-row ascending reads): a pair's rows are mapped on its two columns and summed
 * per (source, target). A ribbon between two listed values is the backend's exact number; one that takes in Other or the blank value sums rows and can overcount.
 * Flows have no origin past the first pair: there is no single first-column node a joined row belongs to.
 */
export function foldSankey({ flowRows, lowRows, pairRows, pairLowRows, columnRows, dims, measure }: { flowRows?: Row[]; lowRows?: Row[]; pairRows?: Row[][]; pairLowRows?: (Row[] | null | undefined)[]; columnRows: Row[][]; dims: Field[]; measure: Measure }): SankeyData {
  const cols = dims.map((d, i) => foldColumn(columnRows[i]!, d, measure));
  const key = measureKey(measure);
  const sums: Map<string, Flow>[] = dims.slice(1).map(() => new Map());
  // A capped flow read is sorted largest first, so a negative would be among the left-out flows: the few-row ascending read shows it (it filters out NULL sums with a HAVING, so they do not fill it).
  const lows = [...(lowRows ?? []), ...(pairLowRows ?? []).flatMap((r) => r ?? [])];
  let negative = cols.some((c) => c.negative) || lows.some((r) => (numberOf(r[key]) ?? 0) < 0);
  if (pairRows) {
    pairRows.forEach((rows, i) => {
      for (const row of rows) {
        const v = numberOf(row[key]);
        if (v === null || v === 0) continue;
        if (v < 0) { negative = true; continue; }
        const source = nodeOf(row[dims[i]!.name], cols[i]!.listed);
        const target = nodeOf(row[dims[i + 1]!.name], cols[i + 1]!.listed);
        const id = `${source}\u0001${target}`;
        const prev = sums[i]!.get(id);
        // The first pair keeps its source as origin (as in exact mode); later pairs have none.
        sums[i]!.set(id, { source, target, ...(i === 0 ? { origin: source } : {}), value: (prev?.value ?? 0) + v });
      }
    });
  }
  for (const row of flowRows ?? []) {
    const v = numberOf(row[key]);
    if (v === null || v === 0) continue;
    if (v < 0) { negative = true; continue; }
    const path = dims.map((d, i) => nodeOf(row[d.name], cols[i]!.listed));
    sums.forEach((m, i) => {
      const id = `${path[0]}\u0001${path[i]}\u0001${path[i + 1]}`;
      const prev = m.get(id);
      m.set(id, { source: path[i]!, target: path[i + 1]!, origin: path[0]!, value: (prev?.value ?? 0) + v });
    });
  }
  const flows = sums.map((m) => [...m.values()]);
  return {
    columns: cols.map((c) => c.nodes),
    flows,
    negative,
    capped: pairRows ? pairRows.some((r) => r.length >= SANKEY_FLOW_LIMIT) : (flowRows?.length ?? 0) >= SANKEY_FLOW_LIMIT,
    columnCapped: cols.some((c) => c.capped),
    empty: columnRows.some((r) => r.length === 0) || flows.every((p) => p.length === 0),
  };
}
