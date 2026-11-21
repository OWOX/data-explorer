import type { Schema } from './types';

/**
 * The columns a grid opens with: the first five fields that are not calculated.
 * A primary key is an identifier, not something to read, so it is left out while the mart has another text field to show.
 */
export function defaultColumns(schema: Schema): string[] {
  const fields = schema.filter((f) => !f.isCalculated);
  const readable = fields.some((f) => !f.isPrimaryKey && f.category === 'string') ? fields.filter((f) => !f.isPrimaryKey) : fields;
  return readable.slice(0, 5).map((f) => f.name);
}
