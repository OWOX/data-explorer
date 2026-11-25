import { fieldLabel } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { MenuGroup, MenuOption } from './ChartMenu';
import { menuOf, type ChartFields } from './fields';
import type { Measure } from './queries';
import { metricLabel } from './Scorecards';
import { measureId } from './settings';

const pathOfField = (f: Field): string => f.joined?.aliasPath ?? '';
const pathOfMeasure = (m: Measure): string => (m.kind === 'records' ? m.aliasPath : pathOfField(m.metric.field));

/** A field's description as an option's hint; none when it is blank. */
export const hintOf = (f: Field): { hint?: string } => { const hint = f.description?.trim(); return hint ? { hint } : {}; };

/** Options under their data mart's header, in the grid's group order (main mart first). A mart with none of them has no header. */
export function groupByMart<T>(cf: ChartFields, items: T[], pathOf: (item: T) => string, option: (item: T) => MenuOption): MenuGroup[] {
  return cf.marts.flatMap((m) => {
    const own = items.filter((x) => pathOf(x) === m.aliasPath);
    return own.length === 0 ? [] : [{ title: m.title || 'Data mart', icon: m.icon, options: own.map(option) }];
  });
}

/** Fields (dimensions, dates) under their data mart: a field shows its own label, the header says whose it is. */
export const fieldGroups = (cf: ChartFields, fields: Field[]): MenuGroup[] => groupByMart(cf, fields, pathOfField, (f) => ({ value: f.name, label: fieldLabel(f), ...hintOf(f) }));

/** Measures under their data mart, each under the id it is saved as. A Count Unique row is just "Count Unique" in its mart's group. */
export const measureGroups = (cf: ChartFields, list: Measure[]): MenuGroup[] => groupByMart(cf, list, pathOfMeasure, (m) => ({
  value: measureId(m),
  label: m.kind === 'records' ? 'Count Unique' : metricLabel(m.metric),
  ...(m.kind === 'records' ? {} : hintOf(m.metric.field)),
}));

/** The title the chart menus give a data mart's group (the grid tab's title); the main mart's has `aliasPath` ''. */
export const martTitleOf = (cf: ChartFields, aliasPath: string): string => menuOf(cf).marts.find((m) => m.aliasPath === aliasPath)?.title || '';

const withMart = (name: string, title: string): string => (title ? `${name} | ${title}` : name);

/** A chart axis or Sankey column title for a field: "{Field Name} | {Data Mart Name}". The field part is its own label, never prefixed with the mart. */
export const axisTitle = (cf: ChartFields, f: Field): string => withMart(fieldLabel(f), martTitleOf(cf, pathOfField(f)));

/** A chart axis title for a measure: its label and the data mart it counts or sums over, named once (a Count Unique is plain "Count Unique" here: the suffix says whose it is). */
export const measureAxisTitle = (cf: ChartFields, m: Measure): string => withMart(m.kind === 'records' ? 'Count Unique' : metricLabel(m.metric), martTitleOf(cf, pathOfMeasure(m)));
