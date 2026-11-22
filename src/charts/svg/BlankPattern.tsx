import { BLANK_COLOR } from '../blank';

/** The hatch a blank mark is filled with: thin diagonal stripes in the blank colour on a transparent ground, so it reads in both themes. Defined once per chart; `id` must be unique per chart instance (useId). */
export function BlankDefs({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="2" height="4" fill={BLANK_COLOR} />
      </pattern>
    </defs>
  );
}

/** A mark's fill: the hatch for the blank colour, any other colour as is. */
export const blankFill = (color: string, id: string): string => (color === BLANK_COLOR ? `url(#${id})` : color);
