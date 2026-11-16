import type { Schema } from '../model/types';

const label = (s: string | null) => (s ?? '').toLowerCase();
const exact = (s: string | null) => label(s) === 'title' || label(s) === 'name';
const partial = (s: string | null) => label(s).includes('title') || label(s).includes('name');

export function pickTitleField(schema: Schema): string | null {
  const strings = schema.filter((f) => f.category === 'string');
  return (
    strings.find((f) => exact(f.name) || exact(f.alias))?.name ??
    strings.find((f) => partial(f.name) || partial(f.alias))?.name ??
    null
  );
}
