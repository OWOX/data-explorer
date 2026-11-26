import type { JoinedSource } from '../api/blendable';
import type { Aggregation } from '../model/aggregation';
import type { Schema } from '../model/types';
import { chartFields, type ChartFields } from './fields';
import { KINDS } from './kinds';
import { chartsOf, type ChartSettings } from './settings';

/** A data mart as the chart sets list it: a group of the grid, the main mart with no column, or a mart a joined path passes through or the report keeps with none. */
export type SetMart = { path: string; title: string; icon?: string | null };

/**
 * Two field sets. `cf` is the shown columns: the scorecards (Records and one card per shown metric), their sparklines' date default and the match counts use it.
 * `chart` is every field of the report's marts (the main mart always, the joined ones with a column or kept with none, and the marts on their paths): the charts
 * (Add chart's kinds, `resolve`, the defaults, the panels and their menus) use it. `chart.shown` is `cf`.
 */
export function chartSetsOf(schema: Schema, shown: string[], agg: Aggregation, martId: string, groups: SetMart[], reportGroups: SetMart[], pathMarts: SetMart[], sources: JoinedSource[]): { cf: ChartFields; chart: ChartFields } {
  const build = (on: string[], marts: SetMart[], counted: JoinedSource[]) => chartFields(schema, on, agg, martId, marts.map((g) => g.path), new Set(counted.filter((x) => x.uniqueCount).map((x) => x.aliasPath)), Object.fromEntries(marts.map((g) => [g.path, g.title])), Object.fromEntries(sources.map((x) => [x.aliasPath, x.mainGrainCollapse])), Object.fromEntries(marts.map((g) => [g.path, g.icon])));
  // The report's groups come first, so a chart mart keeps its group's index and its Count Unique id. A path mart offers no Count Unique: a mart needs a column to count it.
  const onPath = new Set(pathMarts.map((m) => m.path));
  const own = build(shown, groups, sources);
  return { cf: own, chart: { ...build(schema.map((f) => f.name), [...reportGroups, ...pathMarts], sources.filter((x) => !onPath.has(x.aliasPath))), shown: own } };
}

/**
 * Whether something on screen reads with the HAVING keys rule: a scorecard (the shown columns have a number or a Count Unique) or a visible chart that resolves on the chart set.
 * The settings are the saved ones; until they have loaded nothing is read, as the body itself waits.
 */
export function usesKeys(settings: ChartSettings | undefined, cf: ChartFields, chart: ChartFields): boolean {
  if (!settings) return false;
  if (cf.marts.some((m) => m.metrics.length > 0 || m.hasPk)) return true;
  return chartsOf(settings).some((spec) => !spec.hidden && KINDS[spec.kind].resolve(spec, chart) !== null);
}
