// A blank (null) value is drawn like any other: its own bar, slice or bucket, placed first.
/** The key of the blank category in a chart (never a real value: it starts with a NUL). */
export const BLANK_KEY = '\u0000blank';
/** The key of the "Other" category (a real value "Other" never collides with it). */
export const OTHER_KEY = '\u0000other';
/** What the blank category reads as. */
export const BLANK_LABEL = '(blank)';
/** The blank category's colour in a stack or a pie: a light grey (see charts.css), so the series colours of real values do not shift. */
export const BLANK_COLOR = 'var(--dm-blank)';

/** A light blank fill alone is faint on white and next to "Other", so a mark or swatch in the blank colour gets the chart frame's 1px outline. */
export const blankOutline = (color: string): { stroke?: string; strokeWidth?: number } => (color === BLANK_COLOR ? { stroke: 'var(--dm-chart-frame)', strokeWidth: 1 } : {});
/** The legend swatch's style for a colour: its fill, with the same outline for the blank colour. */
export const swatchStyle = (color: string): { background: string; border?: string } => (color === BLANK_COLOR ? { background: color, border: '1px solid var(--dm-chart-frame)' } : { background: color });

/** A returned value as a category key: null (or missing) is the blank key, anything else its text. */
export const keyOf = (v: unknown): string => (v === null || v === undefined ? BLANK_KEY : String(v));
export const isBlankKey = (k: string): boolean => k === BLANK_KEY;
/** The text a category key shows. */
export const labelOf = (k: string): string => (k === BLANK_KEY ? BLANK_LABEL : k);
/** Keys in order with the blank one first: the order every chart draws a category axis in. */
export const blankFirst = (keys: string[]): string[] => [...keys.filter(isBlankKey), ...keys.filter((k) => !isBlankKey(k))];
