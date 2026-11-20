/** A plain JSON object: not null, not an array. */
export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The strings of a list, the rest dropped; an empty list when `v` is not one. */
export const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/** The value of an own property, or undefined: an inherited one (`constructor`, `__proto__`) is never read. */
export const own = (o: Record<string, unknown>, k: string): unknown => (Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined);
