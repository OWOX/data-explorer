import type { Schema } from '../model/types';
import type { TraverseFilter } from '../sdk/types';

/** One card's own rules: the main card's at path '', a joined card's at its alias path. */
export type CardRules = { martId: string; rules: TraverseFilter[]; /** A rule on this card's mart could not be counted on the mart alone. */ partial: boolean };

/** What the grid tells the page: `awaitGrid` is set on the main card's entry while the grid's own read will answer it (not part of any cache key). */
export type GridRules = CardRules & { awaitGrid?: boolean };

/**
 * The rules each card counts, by alias path. `schema` is the grid's blended schema (main fields plus joined ones), `filters` the grid's
 * traverse filters (`toTraverseFilters` output), `mainId` the main mart. A path with no rule and nothing partial is absent.
 */
export function cardRules(schema: Schema, filters: readonly TraverseFilter[], mainId: string): Map<string, CardRules> {
  const out = new Map<string, CardRules>();
  const entry = (path: string, martId: string) => {
    let e = out.get(path);
    if (!e) out.set(path, (e = { martId, rules: [], partial: false }));
    return e;
  };
  for (const f of filters) {
    if (f.function) continue;
    const field = schema.find((x) => x.name === f.column);
    if (f.placement === 'pre-join') {
      const joined = field?.joined;
      if (!joined) continue;
      const e = entry(joined.aliasPath, joined.martId);
      if (joined.originalName) {
        const rule: Partial<TraverseFilter> = { ...f, column: joined.originalName };
        delete rule.placement;
        e.rules.push(rule as TraverseFilter);
      } else e.partial = true;
    } else if (field && !field.joined) {
      const e = entry('', mainId);
      if (field.isCalculated) e.partial = true;
      else e.rules.push(f);
    }
  }
  return out;
}

/** True when every post-join rule of `filters` is a main-card rule: the grid's plain total is then the main card's number. */
export function mainOnly(schema: Schema, filters: readonly TraverseFilter[]): boolean {
  return filters.every((f) => {
    if (f.function || f.placement === 'pre-join') return true;
    const field = schema.find((x) => x.name === f.column);
    return !!field && !field.joined && !field.isCalculated;
  });
}
