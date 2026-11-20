import type { Schema } from './types';

/** The columns a grid opens with: the first five fields that are not calculated. */
export function defaultColumns(schema: Schema): string[] {
  return schema.filter((f) => !f.isCalculated).slice(0, 5).map((f) => f.name);
}
