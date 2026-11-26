import type { KeyboardEvent } from 'react';

/** What makes an SVG mark a button that filters: role, tab stop, name, pointer cursor, and a pick on click, Enter or Space. */
export const pickProps = (label: string, fn: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  'aria-label': label,
  style: { cursor: 'pointer' },
  onClick: fn,
  onKeyDown: (e: KeyboardEvent<SVGElement>) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(); } },
});
