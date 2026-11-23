import { BLANK_COLOR } from '../blank';

/** The hatch a blank mark is filled with: hairline (1px) diagonal stripes in `--dm-blank-hatch` on a solid `--dm-blank` ground, so it reads in both themes. Defined once per chart; `id` must be unique per chart instance (useId). */
export function BlankDefs({ id, lines = false }: { id: string; /** Also define the stripes-only pattern (`blankLines`), for charts that lay it over a mark. */ lines?: boolean }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" fill={BLANK_COLOR} />
        <rect width="1" height="4" fill="var(--dm-blank-hatch)" />
      </pattern>
      {lines && <pattern id={`${id}-lines`} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="1" height="4" fill="var(--dm-blank-hatch)" />
      </pattern>}
    </defs>
  );
}

/** The hatch stripes alone, on a clear ground: laid over a mark that must keep its own colour (a heatmap cell's intensity). */
export const blankLines = (id: string): string => `url(#${id}-lines)`;

/** A mark's fill: the hatch for the blank colour, any other colour as is. */
export const blankFill = (color: string, id: string): string => (color === BLANK_COLOR ? `url(#${id})` : color);
