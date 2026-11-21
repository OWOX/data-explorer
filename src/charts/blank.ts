// A blank (null) value is drawn like any other: its own bar, slice or bucket, placed first.
/** The key of the blank category in a chart (never a real value: it starts with a NUL). */
export const BLANK_KEY = '\u0000blank';
/** What the blank category reads as. */
export const BLANK_LABEL = '(blank)';
/** The blank category's colour in a stack or a pie: neutral, so the series colours of real values do not shift. */
export const BLANK_COLOR = 'var(--muted-foreground)';

/** A returned value as a category key: null (or missing) is the blank key, anything else its text. */
export const keyOf = (v: unknown): string => (v === null || v === undefined ? BLANK_KEY : String(v));
export const isBlankKey = (k: string): boolean => k === BLANK_KEY;
/** The text a category key shows. */
export const labelOf = (k: string): string => (k === BLANK_KEY ? BLANK_LABEL : k);
/** Keys in order with the blank one first: the order every chart draws a category axis in. */
export const blankFirst = (keys: string[]): string[] => [...keys.filter(isBlankKey), ...keys.filter((k) => !isBlankKey(k))];
