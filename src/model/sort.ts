export type SortDirection = 'asc' | 'desc';
/** One sorted column; the list's order is the order of precedence. */
export type SortKey = { field: string; direction: SortDirection };

/** none -> ascending -> descending -> none. A cycled column keeps its place; a removed one drops out. */
export function cycleSort(sorts: SortKey[], field: string): SortKey[] {
  const cur = sorts.find((s) => s.field === field);
  if (!cur) return [...sorts, { field, direction: 'asc' }];
  if (cur.direction === 'asc') return sorts.map((s) => (s.field === field ? { field, direction: 'desc' } : s));
  return sorts.filter((s) => s.field !== field);
}
