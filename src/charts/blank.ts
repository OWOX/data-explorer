// A blank (null) value is drawn like any other: its own bar, slice or bucket, placed first.
/** The key of the blank category in a chart (never a real value: it starts with a NUL). */
export const BLANK_KEY = '\u0000blank';
/** The key of the "Other" category (a real value "Other" never collides with it). */
export const OTHER_KEY = '\u0000other';
/** What the blank category reads as. */
export const BLANK_LABEL = '(blank)';
/** The blank category's colour in a stack or a pie: a light grey (see charts.css), so the series colours of real values do not shift. */
export const BLANK_COLOR = 'var(--dm-blank)';

/** The blank category's colour for thin marks: a line, a line's area, a Sankey ribbon. The light fill above vanishes at 2px or 0.4 opacity, so these take the muted grey. */
export const BLANK_STROKE = 'var(--muted-foreground)';
/** The colour a thin mark takes for a series colour: the blank colour becomes the stroke grey, any other colour stays. */
export const thinColor = (color: string): string => (color === BLANK_COLOR ? BLANK_STROKE : color);

/** The legend swatch's style for a colour: its fill, or for the blank colour the same diagonal hatch the marks use (see BlankPattern), with no border. */
export const swatchStyle = (color: string): { background: string } => (color === BLANK_COLOR ? { background: `repeating-linear-gradient(135deg, var(--dm-blank-hatch) 0 1px, ${BLANK_COLOR} 1px 4px)` } : { background: color });

/** A returned value as a category key: null (or missing) is the blank key, anything else its text. */
export const keyOf = (v: unknown): string => (v === null || v === undefined ? BLANK_KEY : String(v));
export const isBlankKey = (k: string): boolean => k === BLANK_KEY;
/** The text a category key shows. */
export const labelOf = (k: string): string => (k === BLANK_KEY ? BLANK_LABEL : k);
/** Keys in order with the blank one first: the order every chart draws a category axis in. */
export const blankFirst = (keys: string[]): string[] => [...keys.filter(isBlankKey), ...keys.filter((k) => !isBlankKey(k))];
