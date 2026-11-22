import { fieldLabel } from '../model/fieldLabel';
import type { Field } from '../model/types';
import type { MenuGroup, MenuOption } from './ChartMenu';
import type { ChartFields } from './fields';
import type { Measure } from './queries';
import { metricLabel } from './Scorecards';
import { measureId } from './settings';

const pathOfField = (f: Field): string => f.joined?.aliasPath ?? '';
const pathOfMeasure = (m: Measure): string => (m.kind === 'records' ? m.aliasPath : pathOfField(m.metric.field));

/** Options under their data mart's header, in the grid's group order (main mart first). A mart with none of them has no header. */
export function groupByMart<T>(cf: ChartFields, items: T[], pathOf: (item: T) => string, option: (item: T) => MenuOption): MenuGroup[] {
  return cf.marts.flatMap((m) => {
    const own = items.filter((x) => pathOf(x) === m.aliasPath);
    return own.length === 0 ? [] : [{ title: m.title || 'Data mart', icon: m.icon, options: own.map(option) }];
  });
}

/** Fields (dimensions, dates) under their data mart: a field shows its own label, the header says whose it is. */
export const fieldGroups = (cf: ChartFields, fields: Field[]): MenuGroup[] => groupByMart(cf, fields, pathOfField, (f) => ({ value: f.name, label: fieldLabel(f) }));

/** Measures under their data mart, each under the id it is saved as. A Count Unique row is just "Count Unique" in its mart's group. */
export const measureGroups = (cf: ChartFields, list: Measure[]): MenuGroup[] => groupByMart(cf, list, pathOfMeasure, (m) => ({
  value: measureId(m),
  label: m.kind === 'records' ? 'Count Unique' : metricLabel(m.metric),
}));
