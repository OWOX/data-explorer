import type { Context, Mart, Model } from '../model/types';

/** The option for the marts that belong to no context: without it, a filter with every box ticked would still hide them. */
export const NO_CONTEXT = '__no-context__';

/** The contexts the filter offers, by name. Empty when the project has none: "Without context" alone asks nothing. */
export function contextOptions(model: Model): Context[] {
  return [...model.contexts].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The contexts the Data Marts band is narrowed to, or null for no narrowing. Unticking narrows (every
 * box starts ticked); a ticked context a refresh removed drops out silently, and when every ticked
 * one is gone the reader made no choice, so it falls back to all. An empty set the reader chose stays empty.
 */
export function tickedContexts(model: Model, contextIds: string[] | null): string[] | null {
  const offered = [...contextOptions(model).map((c) => c.id), NO_CONTEXT];
  if (offered.length < 2 || contextIds === null) return null;
  const still = contextIds.filter((id) => offered.includes(id));
  if (still.length === offered.length) return null;
  return still.length === 0 && contextIds.length > 0 ? null : still;
}

/** A mart passes when one of its contexts is ticked, or it has none and "Without context" is. */
export function matchesContexts(mart: Mart, ticked: string[] | null): boolean {
  if (ticked === null) return true;
  if (mart.contextIds.length === 0) return ticked.includes(NO_CONTEXT);
  return mart.contextIds.some((id) => ticked.includes(id));
}
