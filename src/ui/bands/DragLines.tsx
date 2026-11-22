import type { DragLine } from './canvas-drag';

/** The lines of a card in hand, the same in Grid and Graph: solid to the mart it is joined under now (`joined`), dashed to the others (`ghost`), the closest one stronger. */
export function DragLines({ lines }: { lines: DragLine[] }) {
  if (lines.length === 0) return null;
  return (
    <svg id="drag-line" aria-hidden>
      {lines.map((l) => <path key={l.target} d={l.d} data-target={l.target} className={[l.current ? 'joined' : 'ghost', l.closest ? 'closest' : ''].filter(Boolean).join(' ')} />)}
    </svg>
  );
}
