/**
 * Where the arrow, Home and End keys move focus in a list of `length` items, from the item at `at`; null for any other key.
 * With `wrap`, Up from the first item lands on the last and Down from the last on the first. Without it, Down stops at
 * the last item and Up from the first returns -1, so the caller can hand focus to whatever sits above the list.
 */
export function rovingTarget(key: string, at: number, length: number, { wrap = true }: { wrap?: boolean } = {}): number | null {
  if (length <= 0) return null;
  let to: number;
  if (key === 'ArrowDown') to = at + 1;
  else if (key === 'ArrowUp') to = at - 1;
  else if (key === 'Home') to = 0;
  else if (key === 'End') to = length - 1;
  else return null;
  if (wrap) return (to + length) % length;
  return Math.min(to, length - 1);
}
